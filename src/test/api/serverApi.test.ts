// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import type { Express } from 'express';

describe('Printshop POS API integration', () => {
  let tmpDataDir: string;
  let app: Express;
  let closeDatabaseFn: () => void;
  let adminToken = '';
  let cashierToken = '';

  beforeAll(async () => {
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-api-test-'));
    process.env.PRINTSHOP_DATA_DIR = tmpDataDir;

    const dbModule = await import('../../server/db.ts');
    dbModule.initDatabase();
    closeDatabaseFn = dbModule.closeDatabase;

    const appModule = await import('../../server/app.ts');
    app = appModule.createApiApp();
  });

  afterAll(() => {
    closeDatabaseFn?.();
    if (tmpDataDir && fs.existsSync(tmpDataDir)) {
      fs.rmSync(tmpDataDir, { recursive: true, force: true });
    }
    delete process.env.PRINTSHOP_DATA_DIR;
  });

  it('serves health check, 404 JSON fallback, and 400 malformed JSON error responses', async () => {
    const healthRes = await request(app).get('/api/health');
    expect(healthRes.status).toBe(200);
    expect(healthRes.body.status).toBe('ok');

    const notFoundRes = await request(app).get('/api/non-existent-endpoint');
    expect(notFoundRes.status).toBe(404);
    expect(notFoundRes.body).toHaveProperty('error');

    const badJsonRes = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"invalid":');
    expect(badJsonRes.status).toBe(400);
    expect(badJsonRes.body.error).toMatch(/malformed json/i);
  });

  it('handles initial admin setup, auth login, user creation, and RBAC guards', async () => {
    const unauthBootstrap = await request(app).get('/api/bootstrap');
    expect(unauthBootstrap.status).toBe(401);

    const statusBefore = await request(app).get('/api/auth/status');
    expect(statusBefore.status).toBe(200);
    expect(statusBefore.body.needsSetup).toBe(true);

    const setupRes = await request(app).post('/api/auth/setup-admin').send({
      username: 'owner',
      fullName: 'Studio Owner',
      email: 'owner@printshop.local',
      password: 'password123',
      pin: '1234',
    });
    expect(setupRes.status).toBe(201);
    expect(setupRes.body.token).toBeTruthy();
    expect(setupRes.body.user.role).toBe('admin');
    adminToken = setupRes.body.token;

    // Duplicate admin setup must return 409
    const dupSetup = await request(app).post('/api/auth/setup-admin').send({
      username: 'owner2',
      fullName: 'Second Owner',
      password: 'password123',
    });
    expect(dupSetup.status).toBe(409);

    // Create a cashier account and sign in as cashier
    const createCashier = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: 'cashier1',
        fullName: 'Front Counter Cashier',
        role: 'cashier',
        password: 'password123',
        pin: '4321',
      });
    expect(createCashier.status).toBe(201);

    const loginRes = await request(app).post('/api/auth/login').send({
      username: 'cashier1',
      password: 'password123',
    });
    expect(loginRes.status).toBe(200);
    cashierToken = loginRes.body.token;

    // Cashier is blocked from manager/admin-only endpoints
    const forbiddenInv = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ name: 'Paper', unit: 'sheet' });
    expect(forbiddenInv.status).toBe(403);

    const forbiddenSup = await request(app)
      .post('/api/suppliers')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ name: 'Blocked Supplier' });
    expect(forbiddenSup.status).toBe(403);

    const forbiddenDoc = await request(app)
      .post('/api/suppliers/documents')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ supplierName: 'Test', title: 'Test' });
    expect(forbiddenDoc.status).toBe(403);
  });

  it('creates inventory items, prevents duplicate SKUs, and records signed stock adjustments', async () => {
    const createdRes = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Sublimation Mug Blank',
        sku: 'MUG-WHT-001',
        barcode: '480999000111',
        category: 'ID & Merch',
        itemType: 'consumable',
        unit: 'pc',
        quantityOnHand: 50,
        reorderLevel: 15,
        minimumThreshold: 10,
        unitCost: 45,
        supplier: 'Alpha Merch',
      });
    expect(createdRes.status).toBe(201);
    const itemId = createdRes.body.id as string;
    expect(createdRes.body.sku).toBe('MUG-WHT-001');

    // Duplicate SKU must return 400
    const dupSkuRes = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Duplicate Mug',
        sku: 'mug-wht-001',
        unit: 'pc',
      });
    expect(dupSkuRes.status).toBe(400);

    // Positive purchase restock
    const purchaseRes = await request(app)
      .post(`/api/inventory/${itemId}/adjust`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        movementType: 'purchase',
        quantityDelta: 20,
        unitCost: 42,
        reference: 'PO-TEST-01',
      });
    expect(purchaseRes.status).toBe(200);
    expect(purchaseRes.body.quantityOnHand).toBe(70);
    expect(purchaseRes.body.item.unitCost).toBe(42);
    expect(purchaseRes.body.movement.quantityDelta).toBe(20);

    // Wastage deduction clamps cleanly at 0 if excessive
    const wastageRes = await request(app)
      .post(`/api/inventory/${itemId}/adjust`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        movementType: 'wastage',
        quantityDelta: 100,
        note: 'Damaged crate',
      });
    expect(wastageRes.status).toBe(200);
    expect(wastageRes.body.quantityOnHand).toBe(0);
    expect(wastageRes.body.movement.quantityDelta).toBe(-100);
    expect(wastageRes.body.movement.balanceAfter).toBe(0);
  });

  it('manages supplier profiles, PO recording, and secured document uploads/renames/deletions', async () => {
    const supRes = await request(app)
      .post('/api/suppliers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Alpha Merch',
        contactPerson: 'Nina Cruz',
        phone: '+63 917 000 2222',
        email: 'orders@alphamerch.local',
        defaultLeadTimeDays: 3,
        paymentTerms: 'Net 15',
        syncToLinkedItems: true,
      });
    expect(supRes.status).toBe(201);
    expect(supRes.body.syncedItemsCount).toBeGreaterThanOrEqual(1);
    const supplierId = supRes.body.supplier.id as string;

    // Fetch inventory id created above
    const invListRes = await request(app)
      .get('/api/inventory')
      .set('Authorization', `Bearer ${adminToken}`);
    const mugItem = (invListRes.body.items as Array<{ id: string; sku: string }>).find(
      (i) => i.sku === 'MUG-WHT-001',
    )!;

    // Record supplier PO atomically
    const poRes = await request(app)
      .post('/api/suppliers/record-order')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        supplierName: 'Alpha Merch',
        reference: 'PO-ALPHA-009',
        items: [{ inventoryItemId: mugItem.id, quantity: 30, unitCost: 40 }],
      });
    expect(poRes.status).toBe(201);
    expect(poRes.body.items[0].quantityOnHand).toBe(30);
    expect(poRes.body.items[0].unitCost).toBe(40);

    // Reject disallowed SVG upload to protect against stored XSS
    const svgBase64 = Buffer.from('<svg onload="alert(1)"></svg>').toString('base64');
    const badMimeRes = await request(app)
      .post('/api/suppliers/documents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        supplierId,
        supplierName: 'Alpha Merch',
        docType: 'contract',
        title: 'Bad Upload',
        fileName: 'evil.svg',
        mimeType: 'image/svg+xml',
        dataBase64: svgBase64,
      });
    expect(badMimeRes.status).toBe(400);

    // Upload valid TXT/PDF document
    const txtContent = 'Master Agreement: Net 15 terms, fixed rate PHP 40/mug.';
    const txtBase64 = Buffer.from(txtContent).toString('base64');
    const uploadRes = await request(app)
      .post('/api/suppliers/documents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        supplierId,
        supplierName: 'Alpha Merch',
        docType: 'contract',
        title: '2026 Master SLA',
        referenceNumber: 'SLA-2026-01',
        fileName: 'master_sla.txt',
        mimeType: 'text/plain',
        dataBase64: txtBase64,
      });
    expect(uploadRes.status).toBe(201);
    const docId = uploadRes.body.document.id as string;

    // Authenticated download returns nosniff header and exact content
    const fileRes = await request(app)
      .get(`/api/supplier-documents/${docId}/file`)
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers['x-content-type-options']).toBe('nosniff');
    expect(fileRes.text).toBe(txtContent);

    // Rename supplier and confirm document supplierName cascades
    const renameRes = await request(app)
      .patch(`/api/suppliers/${supplierId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Alpha Merch Group', syncToLinkedItems: true });
    expect(renameRes.status).toBe(200);

    const docsAfterRename = await request(app)
      .get('/api/suppliers/documents')
      .set('Authorization', `Bearer ${adminToken}`);
    const renamedDoc = (docsAfterRename.body.documents as Array<{ id: string; supplierName: string }>).find(
      (d) => d.id === docId,
    );
    expect(renamedDoc?.supplierName).toBe('Alpha Merch Group');

    // Delete document
    const delDocRes = await request(app)
      .delete(`/api/suppliers/documents/${docId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(delDocRes.status).toBe(200);
    expect(delDocRes.body.ok).toBe(true);
  });

  it('processes POS transactions atomically with inventory deduction, shift/customer updates, idempotency, and voiding', async () => {
    const custRes = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ name: 'Walk-In VIP', group: 'vip', phone: '09171112222' });
    expect(custRes.status).toBe(201);
    const customerId = custRes.body.id as string;

    const shiftRes = await request(app)
      .post('/api/shifts/start')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ openingCash: 1000 });
    expect(shiftRes.status).toBe(201);
    const shiftId = shiftRes.body.id as string;

    const invBefore = await request(app)
      .get('/api/inventory')
      .set('Authorization', `Bearer ${cashierToken}`);
    const mugItem = (invBefore.body.items as Array<{ id: string; sku: string; quantityOnHand: number }>).find(
      (i) => i.sku === 'MUG-WHT-001',
    )!;
    const startStock = mugItem.quantityOnHand; // 30

    const txPayload = {
      type: 'sale',
      clientMutationId: 'mut-pos-idempotent-1',
      customerId,
      customerName: 'Walk-In VIP',
      shiftId,
      items: [
        {
          id: 'ci-mug-1',
          serviceId: 'srv-mug',
          sku: 'MRC-MUG-01',
          serviceName: 'Printed Mug',
          pricingMethod: 'per_piece',
          unitLabel: 'pc',
          unitPrice: 150,
          effectiveQuantity: 4,
          displaySummary: '4 pcs',
          config: {
            quantity: 4,
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
          lineSubtotal: 600,
          lineDiscount: 0,
          lineTotal: 600,
          costTotal: 160,
          requiresProductionJob: false,
          consumables: [{ inventoryItemId: mugItem.id, quantityPerUnit: 1 }],
        },
      ],
      subtotal: 600,
      itemDiscountsTotal: 0,
      orderDiscountType: 'none',
      orderDiscountValue: 0,
      orderDiscountAmount: 0,
      taxAmount: 0,
      totalAmount: 600,
      amountPaid: 400,
      changeAmount: 0,
      balanceDue: 200,
      paymentStatus: 'partial',
      payments: [
        {
          id: 'p1',
          methodId: 'cash',
          methodName: 'Cash',
          methodType: 'cash',
          amount: 400,
          referenceNumber: '',
          verificationStatus: 'verified',
          paidAt: new Date().toISOString(),
        },
      ],
      notes: 'Mug batch order',
    };

    const saleRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send(txPayload);
    expect(saleRes.status).toBe(201);
    expect(saleRes.body.duplicate).toBe(false);
    const txId = saleRes.body.transaction.id as string;

    // Retry with same clientMutationId -> 200 duplicate without second stock deduction
    const dupRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send(txPayload);
    expect(dupRes.status).toBe(200);
    expect(dupRes.body.duplicate).toBe(true);

    const bootstrapRes = await request(app)
      .get('/api/bootstrap')
      .set('Authorization', `Bearer ${cashierToken}`);
    const updatedMug = (bootstrapRes.body.inventory as Array<{ id: string; quantityOnHand: number }>).find(
      (i) => i.id === mugItem.id,
    )!;
    expect(updatedMug.quantityOnHand).toBe(startStock - 4);

    const updatedCustomer = (
      bootstrapRes.body.customers as Array<{ id: string; totalSpent: number; outstandingBalance: number }>
    ).find((c) => c.id === customerId)!;
    expect(updatedCustomer.totalSpent).toBe(400);
    expect(updatedCustomer.outstandingBalance).toBe(200);

    const updatedShift = (
      bootstrapRes.body.shifts as Array<{ id: string; cashSales: number; expectedCash: number }>
    ).find((s) => s.id === shiftId)!;
    expect(updatedShift.cashSales).toBe(400);
    expect(updatedShift.expectedCash).toBe(1400);

    // Void requires reason (400), succeeds with reason (200)
    const voidMissingReason = await request(app)
      .post(`/api/transactions/${txId}/void`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: '   ' });
    expect(voidMissingReason.status).toBe(400);

    const voidOk = await request(app)
      .post(`/api/transactions/${txId}/void`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Customer cancelled order' });
    expect(voidOk.status).toBe(200);
    expect(voidOk.body.paymentStatus).toBe('voided');
  });

  it('configures off-hours critical alert schedules, fires manual checks, and acknowledges events', async () => {
    // Reduce mug stock below minimumThreshold (10) -> 3 < 10
    const invRes = await request(app)
      .get('/api/inventory')
      .set('Authorization', `Bearer ${adminToken}`);
    const mugItem = (invRes.body.items as Array<{ id: string; sku: string; quantityOnHand: number }>).find(
      (i) => i.sku === 'MUG-WHT-001',
    )!;

    await request(app)
      .post(`/api/inventory/${mugItem.id}/adjust`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        movementType: 'wastage',
        quantityDelta: mugItem.quantityOnHand - 3,
      });

    const saveCfgRes = await request(app)
      .put('/api/alerts/critical-config')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        enabled: true,
        channel: 'system',
        recipientEmails: [],
        monitorWeekends: true,
        monitorOffHoursWeekdays: true,
        businessHoursStart: '08:00',
        businessHoursEnd: '18:00',
        timezone: 'UTC',
        triggerMode: 'below_minimum',
        cooldownMinutes: 5,
      });
    expect(saveCfgRes.status).toBe(200);
    expect(saveCfgRes.body.config.timezone).toBe('UTC');

    const testRunRes = await request(app)
      .post('/api/alerts/critical-events/test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ simulateOffHours: true });
    expect(testRunRes.status).toBe(200);
    expect(testRunRes.body.triggeredEvents.length).toBeGreaterThanOrEqual(1);
    const eventId = testRunRes.body.triggeredEvents[0].id as string;

    const ackRes = await request(app)
      .post(`/api/alerts/critical-events/${eventId}/acknowledge`)
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(ackRes.status).toBe(200);
    expect(ackRes.body.event.systemAlertStatus).toBe('acknowledged');
  });

  it('rejects invalid numeric, base64, and malformed payloads cleanly with 400 status', async () => {
    const invRes = await request(app)
      .get('/api/inventory')
      .set('Authorization', `Bearer ${adminToken}`);
    const mugItem = (invRes.body.items as Array<{ id: string; sku: string }>).find(
      (i) => i.sku === 'MUG-WHT-001',
    )!;

    const badDelta = await request(app)
      .post(`/api/inventory/${mugItem.id}/adjust`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ movementType: 'purchase', quantityDelta: 'not-a-number' });
    expect(badDelta.status).toBe(400);

    const badUnitCost = await request(app)
      .post(`/api/inventory/${mugItem.id}/adjust`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ movementType: 'purchase', quantityDelta: 5, unitCost: -10 });
    expect(badUnitCost.status).toBe(400);

    const badPatch = await request(app)
      .patch(`/api/inventory/${mugItem.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ unitCost: 'NaN' });
    expect(badPatch.status).toBe(400);

    const badBase64 = await request(app)
      .post('/api/suppliers/documents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        supplierName: 'Alpha Merch Group',
        docType: 'contract',
        title: 'Corrupt File',
        fileName: 'bad.txt',
        mimeType: 'text/plain',
        dataBase64: '!!!not-valid-base64!!!',
      });
    expect(badBase64.status).toBe(400);

    const badPayBal = await request(app)
      .post('/api/customers/cust-missing/pay-balance')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ amount: -50 });
    expect(badPayBal.status).toBe(400);
  });
});
