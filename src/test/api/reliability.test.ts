// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { mergeSettingsWithDefaults } from '../../context/AppStateContext.tsx';

function makeSalePayload(options: {
  clientMutationId: string;
  inventoryItemId: string;
  shiftId: string;
  qty: number;
  unitPrice?: number;
}) {
  const unitPrice = options.unitPrice ?? 100;
  const total = unitPrice * options.qty;
  return {
    type: 'sale',
    clientMutationId: options.clientMutationId,
    customerName: 'Reliability Test Client',
    shiftId: options.shiftId,
    items: [
      {
        id: `ci-${options.clientMutationId}`,
        serviceId: 'srv-rel',
        sku: 'REL-01',
        serviceName: 'Reliability Test Print',
        pricingMethod: 'per_piece',
        unitLabel: 'pc',
        unitPrice,
        effectiveQuantity: options.qty,
        displaySummary: `${options.qty} pcs`,
        config: {
          quantity: options.qty,
          pages: 1,
          copies: 1,
          width: 1,
          height: 1,
          dimensionUnit: 'ft',
          selectedAttributes: {},
          isRush: false,
          designFee: 0,
          laborFee: 0,
          notes: '',
        },
        discountType: 'none',
        discountValue: 0,
        lineSubtotal: total,
        lineDiscount: 0,
        lineTotal: total,
        costTotal: 20 * options.qty,
        requiresProductionJob: false,
        consumables: [{ inventoryItemId: options.inventoryItemId, quantityPerUnit: 1 }],
      },
    ],
    subtotal: total,
    itemDiscountsTotal: 0,
    orderDiscountType: 'none',
    orderDiscountValue: 0,
    orderDiscountAmount: 0,
    taxAmount: 0,
    totalAmount: total,
    amountPaid: total,
    changeAmount: 0,
    balanceDue: 0,
    paymentStatus: 'paid',
    payments: [
      {
        id: `pay-${options.clientMutationId}`,
        methodId: 'cash',
        methodName: 'Cash',
        methodType: 'cash',
        amount: total,
        referenceNumber: '',
        verificationStatus: 'verified',
        paidAt: new Date().toISOString(),
      },
    ],
    notes: 'Concurrency reliability verification',
  };
}

describe('System Reliability, Concurrency & Persistence', () => {
  let tmpDataDir: string;
  let app: Express;
  let initDatabaseFn: () => void;
  let closeDatabaseFn: () => void;
  let createApiAppFn: () => Express;
  let adminToken = '';
  let shiftId = '';
  let stockItemId = '';

  beforeAll(async () => {
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-reliability-'));
    process.env.PRINTSHOP_DATA_DIR = tmpDataDir;

    const dbModule = await import('../../server/db.ts');
    initDatabaseFn = dbModule.initDatabase;
    closeDatabaseFn = dbModule.closeDatabase;
    initDatabaseFn();

    const appModule = await import('../../server/app.ts');
    createApiAppFn = appModule.createApiApp;
    app = createApiAppFn();

    const setupRes = await request(app).post('/api/auth/setup-admin').send({
      username: 'rel_admin',
      fullName: 'Reliability Admin',
      email: 'rel@printshop.local',
      password: 'reliable-password-123',
      pin: '5678',
    });
    if (setupRes.status !== 201) {
      throw new Error(`Setup admin failed with status ${setupRes.status}`);
    }
    adminToken = setupRes.body.token as string;

    const shiftRes = await request(app)
      .post('/api/shifts/start')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingCash: 2000 });
    if (shiftRes.status !== 201) {
      throw new Error(`Start shift failed with status ${shiftRes.status}`);
    }
    shiftId = shiftRes.body.id as string;

    const invRes = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Reliability Test Vinyl Sheet',
        sku: 'REL-VINYL-50',
        category: 'Signage & Tarpaulin',
        itemType: 'consumable',
        unit: 'sheet',
        quantityOnHand: 50,
        reorderLevel: 10,
        minimumThreshold: 5,
        unitCost: 20,
      });
    if (invRes.status !== 201) {
      throw new Error(`Inventory setup failed with status ${invRes.status}`);
    }
    stockItemId = invRes.body.id as string;
  });

  afterAll(() => {
    closeDatabaseFn?.();
    if (tmpDataDir && fs.existsSync(tmpDataDir)) {
      fs.rmSync(tmpDataDir, { recursive: true, force: true });
    }
    delete process.env.PRINTSHOP_DATA_DIR;
  });

  it('prevents duplicate open cashier shifts under sequential or concurrent requests', async () => {
    const secondShift = await request(app)
      .post('/api/shifts/start')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingCash: 500 });
    expect(secondShift.status).toBe(409);
    expect(String(secondShift.body.error || '')).toMatch(/already have an open/i);
  });

  it('guarantees idempotent single stock deduction under 5 concurrent identical mutations', async () => {
    const payload = makeSalePayload({
      clientMutationId: 'concurrent-idempotent-mut-1',
      inventoryItemId: stockItemId,
      shiftId,
      qty: 5,
    });

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post('/api/transactions')
          .set('Authorization', `Bearer ${adminToken}`)
          .send(payload),
      ),
    );

    const createdCount = responses.filter((r) => r.status === 201 && r.body.duplicate === false).length;
    const dupCount = responses.filter((r) => r.status === 200 && r.body.duplicate === true).length;
    expect(createdCount).toBe(1);
    expect(dupCount).toBe(4);

    const invCheck = await request(app)
      .get('/api/inventory')
      .set('Authorization', `Bearer ${adminToken}`);
    const item = (invCheck.body.items as Array<{ id: string; quantityOnHand: number }>).find(
      (i) => i.id === stockItemId,
    )!;
    expect(item.quantityOnHand).toBe(45);
  });

  it('maintains exact stock & shift balance under concurrent distinct checkout transactions', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, idx) =>
        request(app)
          .post('/api/transactions')
          .set('Authorization', `Bearer ${adminToken}`)
          .send(
            makeSalePayload({
              clientMutationId: `concurrent-distinct-mut-${idx + 1}`,
              inventoryItemId: stockItemId,
              shiftId,
              qty: 2,
            }),
          ),
      ),
    );

    for (const res of responses) {
      expect(res.status).toBe(201);
      expect(res.body.duplicate).toBe(false);
    }

    const bootstrapRes = await request(app)
      .get('/api/bootstrap')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(bootstrapRes.status).toBe(200);

    const item = (bootstrapRes.body.inventory as Array<{ id: string; quantityOnHand: number }>).find(
      (i) => i.id === stockItemId,
    )!;
    // 45 - (5 * 2) = 35
    expect(item.quantityOnHand).toBe(35);

    const activeShift = (bootstrapRes.body.shifts as Array<{ id: string; expectedCash: number }>).find(
      (s) => s.id === shiftId,
    )!;
    // Opening 2000 + 500 (from first sale) + 5 * 200 (from 5 concurrent sales) = 3500
    expect(activeShift.expectedCash).toBe(3500);
  });

  it('persists transactions, inventory balances, and auth credentials across database restart', async () => {
    // Shut down database and clear module cache to simulate full process restart
    closeDatabaseFn();
    vi.resetModules();

    const reopenedDb = await import('../../server/db.ts');
    initDatabaseFn = reopenedDb.initDatabase;
    closeDatabaseFn = reopenedDb.closeDatabase;
    initDatabaseFn();

    const reopenedAppModule = await import('../../server/app.ts');
    createApiAppFn = reopenedAppModule.createApiApp;
    const restartedApp = createApiAppFn();

    const loginRes = await request(restartedApp).post('/api/auth/login').send({
      username: 'rel_admin',
      password: 'reliable-password-123',
    });
    expect(loginRes.status).toBe(200);
    const freshToken = loginRes.body.token as string;

    const bootstrapRes = await request(restartedApp)
      .get('/api/bootstrap')
      .set('Authorization', `Bearer ${freshToken}`);
    expect(bootstrapRes.status).toBe(200);

    const persistedItem = (
      bootstrapRes.body.inventory as Array<{ id: string; quantityOnHand: number }>
    ).find((i) => i.id === stockItemId)!;
    expect(persistedItem.quantityOnHand).toBe(35);
    expect((bootstrapRes.body.transactions as Array<unknown>).length).toBeGreaterThanOrEqual(6);

    // Keep reference updated so afterAll closes active DB handle cleanly
    app = restartedApp;
  });

  it('sanitizes malformed or out-of-range settings cleanly via mergeSettingsWithDefaults', () => {
    const merged = mergeSettingsWithDefaults({
      themeMode: 'invalid-mode' as never,
      density: 'huge' as never,
      tokens: {
        borderRadiusPx: 999,
        fontSizeScale: 0.2,
        sidebarWidthPx: 50,
      } as never,
      branding: {
        appName: '',
      } as never,
    });

    expect(merged.themeMode).toBe('light');
    expect(merged.density).toBe('comfortable');
    expect(merged.tokens.borderRadiusPx).toBeLessThanOrEqual(24);
    expect(merged.tokens.fontSizeScale).toBeGreaterThanOrEqual(0.85);
    expect(merged.tokens.sidebarWidthPx).toBeGreaterThanOrEqual(200);
    expect(merged.branding.appName.length).toBeGreaterThan(0);
  });
});
