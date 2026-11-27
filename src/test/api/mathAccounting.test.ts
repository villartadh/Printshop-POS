// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

function buildSalePayload(options: {
  clientMutationId: string;
  shiftId: string;
  customerId?: string | null;
  inventoryItemId?: string;
  qty: number;
  unitPrice: number;
  payments: Array<{
    methodId: string;
    methodName: string;
    methodType: 'cash' | 'ewallet' | 'bank_transfer' | 'card';
    amount: number;
  }>;
  requiresProductionJob?: boolean;
}) {
  const totalAmount = Number((options.qty * options.unitPrice).toFixed(2));
  const tendered = Number(options.payments.reduce((s, p) => s + p.amount, 0).toFixed(2));
  const amountPaid = Math.min(totalAmount, tendered);
  const changeAmount = Math.max(0, Number((tendered - totalAmount).toFixed(2)));
  const balanceDue = Math.max(0, Number((totalAmount - amountPaid).toFixed(2)));

  return {
    type: 'sale',
    clientMutationId: options.clientMutationId,
    customerId: options.customerId ?? null,
    customerName: options.customerId ? 'Accounting Client' : 'Walk-in Customer',
    shiftId: options.shiftId,
    items: [
      {
        id: `ci-${options.clientMutationId}`,
        serviceId: 'srv-acct',
        sku: 'ACCT-01',
        serviceName: 'Accounting Test Banner',
        pricingMethod: 'per_piece',
        unitLabel: 'pc',
        unitPrice: options.unitPrice,
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
        lineSubtotal: totalAmount,
        lineDiscount: 0,
        lineTotal: totalAmount,
        costTotal: 30 * options.qty,
        requiresProductionJob: Boolean(options.requiresProductionJob),
        consumables: options.inventoryItemId
          ? [{ inventoryItemId: options.inventoryItemId, quantityPerUnit: 2 }]
          : [],
      },
    ],
    subtotal: totalAmount,
    itemDiscountsTotal: 0,
    orderDiscountType: 'none',
    orderDiscountValue: 0,
    orderDiscountAmount: 0,
    taxAmount: 0,
    totalAmount,
    amountPaid,
    changeAmount,
    balanceDue,
    paymentStatus: balanceDue <= 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid',
    payments: options.payments.map((p, idx) => ({
      id: `pay-${options.clientMutationId}-${idx}`,
      ...p,
      referenceNumber: p.methodType === 'cash' ? '' : `REF-${idx + 1}`,
      verificationStatus: 'verified',
      paidAt: new Date().toISOString(),
    })),
    notes: 'Accounting invariant test',
  };
}

describe('Server Financial & Accounting Math Consistency', () => {
  let tmpDataDir: string;
  let app: Express;
  let closeDatabaseFn: () => void;
  let adminToken = '';
  let shiftId = '';
  let customerId = '';
  let inventoryItemId = '';

  beforeAll(async () => {
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-math-acct-'));
    process.env.PRINTSHOP_DATA_DIR = tmpDataDir;

    const dbModule = await import('../../server/db.ts');
    dbModule.initDatabase();
    closeDatabaseFn = dbModule.closeDatabase;

    const appModule = await import('../../server/app.ts');
    app = appModule.createApiApp();

    const setupRes = await request(app).post('/api/auth/setup-admin').send({
      username: 'acct_admin',
      fullName: 'Accounting Admin',
      password: 'accounting-password-123',
      pin: '2468',
    });
    if (setupRes.status !== 201) {
      throw new Error(`Setup admin failed with status ${setupRes.status}`);
    }
    adminToken = setupRes.body.token as string;

    const shiftRes = await request(app)
      .post('/api/shifts/start')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingCash: 1000 });
    if (shiftRes.status !== 201) {
      throw new Error(`Shift start failed with status ${shiftRes.status}`);
    }
    shiftId = shiftRes.body.id as string;

    const custRes = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Accounting Client', group: 'regular' });
    if (custRes.status !== 201) {
      throw new Error(`Customer create failed with status ${custRes.status}`);
    }
    customerId = custRes.body.id as string;

    const invRes = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Tarpaulin Roll',
        sku: 'LRG-ACCT-001',
        category: 'Large Format',
        itemType: 'consumable',
        unit: 'ft',
        quantityOnHand: 100,
        reorderLevel: 20,
        minimumThreshold: 10,
        unitCost: 30,
      });
    if (invRes.status !== 201) {
      throw new Error(`Inventory create failed with status ${invRes.status}`);
    }
    inventoryItemId = invRes.body.id as string;
  });

  afterAll(() => {
    closeDatabaseFn?.();
    if (tmpDataDir && fs.existsSync(tmpDataDir)) {
      fs.rmSync(tmpDataDir, { recursive: true, force: true });
    }
    delete process.env.PRINTSHOP_DATA_DIR;
  });

  it('reconciles split tender, cash change, credit balances, and pay-balance clamping', async () => {
    // 1. Split payment: total 600, GCash 200 + Cash 500 = 700 -> net cash 400, change 100
    const splitRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(
        buildSalePayload({
          clientMutationId: 'acct-split-1',
          shiftId,
          customerId,
          inventoryItemId,
          qty: 3, // consumes 3 * 2 = 6 ft -> stock 94
          unitPrice: 200,
          payments: [
            { methodId: 'gcash', methodName: 'GCash', methodType: 'ewallet', amount: 200 },
            { methodId: 'cash', methodName: 'Cash', methodType: 'cash', amount: 500 },
          ],
        }),
      );
    expect(splitRes.status).toBe(201);
    expect(splitRes.body.transaction.amountPaid).toBe(600);
    expect(splitRes.body.transaction.changeAmount).toBe(100);
    expect(splitRes.body.transaction.balanceDue).toBe(0);

    // 2. Partial credit sale: total 500, Cash 150 -> amountPaid = 150, balanceDue = 350
    const partialRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(
        buildSalePayload({
          clientMutationId: 'acct-partial-1',
          shiftId,
          customerId,
          qty: 5,
          unitPrice: 100,
          payments: [
            { methodId: 'cash', methodName: 'Cash', methodType: 'cash', amount: 150 },
          ],
        }),
      );
    expect(partialRes.status).toBe(201);
    expect(partialRes.body.transaction.paymentStatus).toBe('partial');
    expect(partialRes.body.transaction.balanceDue).toBe(350);

    // 3. Pay customer balance with overpayment (500 tendered on 350 due -> clamps at 350)
    const payBalRes = await request(app)
      .post(`/api/customers/${customerId}/pay-balance`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 500 });
    expect(payBalRes.status).toBe(200);
    expect(payBalRes.body.outstandingBalance).toBe(0);

    const bootstrapRes = await request(app)
      .get('/api/bootstrap')
      .set('Authorization', `Bearer ${adminToken}`);
    const cust = (
      bootstrapRes.body.customers as Array<{
        id: string;
        totalSpent: number;
        outstandingBalance: number;
        loyaltyPoints: number;
      }>
    ).find((c) => c.id === customerId)!;
    // Total spent: 600 + 150 + 350 = 1100; outstandingBalance = 0; points = 60 + 15 = 75
    expect(cust.totalSpent).toBe(1100);
    expect(cust.outstandingBalance).toBe(0);
    expect(cust.loyaltyPoints).toBe(75);

    const shift = (
      bootstrapRes.body.shifts as Array<{
        id: string;
        cashSales: number;
        electronicSales: number;
        expectedCash: number;
      }>
    ).find((s) => s.id === shiftId)!;
    // cashSales = 400 (split) + 150 (partial) = 550; electronic = 200; expectedCash = 1000 + 550 = 1550
    expect(shift.cashSales).toBe(550);
    expect(shift.electronicSales).toBe(200);
    expect(shift.expectedCash).toBe(1550);
  });

  it('reverses inventory, customer balances, print jobs, and shift drawer on void and blocks double-void', async () => {
    const saleRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(
        buildSalePayload({
          clientMutationId: 'acct-void-target',
          shiftId,
          customerId,
          inventoryItemId,
          qty: 4, // consumes 8 ft -> stock 94 - 8 = 86
          unitPrice: 125, // total 500
          requiresProductionJob: true,
          payments: [
            { methodId: 'cash', methodName: 'Cash', methodType: 'cash', amount: 300 },
          ],
        }),
      );
    expect(saleRes.status).toBe(201);
    const txId = saleRes.body.transaction.id as string;

    const voidRes = await request(app)
      .post(`/api/transactions/${txId}/void`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Customer withdrew job order' });
    expect(voidRes.status).toBe(200);
    expect(voidRes.body.paymentStatus).toBe('voided');

    // Second void and refund-after-void must both return 409 Conflict
    const secondVoid = await request(app)
      .post(`/api/transactions/${txId}/void`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Duplicate void attempt' });
    expect(secondVoid.status).toBe(409);

    const refundVoided = await request(app)
      .post(`/api/transactions/${txId}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Refund after void' });
    expect(refundVoided.status).toBe(409);

    const bootstrapRes = await request(app)
      .get('/api/bootstrap')
      .set('Authorization', `Bearer ${adminToken}`);
    const inv = (bootstrapRes.body.inventory as Array<{ id: string; quantityOnHand: number }>).find(
      (i) => i.id === inventoryItemId,
    )!;
    // Stock restored back from 86 to 94
    expect(inv.quantityOnHand).toBe(94);

    const cust = (
      bootstrapRes.body.customers as Array<{
        id: string;
        totalSpent: number;
        outstandingBalance: number;
        loyaltyPoints: number;
      }>
    ).find((c) => c.id === customerId)!;
    expect(cust.totalSpent).toBe(1100);
    expect(cust.outstandingBalance).toBe(0);
    expect(cust.loyaltyPoints).toBe(75);

    const shift = (
      bootstrapRes.body.shifts as Array<{
        id: string;
        cashSales: number;
        expectedCash: number;
      }>
    ).find((s) => s.id === shiftId)!;
    expect(shift.cashSales).toBe(550);
    expect(shift.expectedCash).toBe(1550);

    const job = (
      bootstrapRes.body.printJobs as Array<{ transactionId: string | null; paymentStatus: string }>
    ).find((j) => j.transactionId === txId)!;
    expect(job.paymentStatus).toBe('voided');
  });

  it('keeps shift expectedCash invariant when refunding electronic payments, blocks double-refund, and reconciles shift close', async () => {
    // Electronic GCash sale of 400 -> expectedCash stays 1550
    const gcashSaleRes = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(
        buildSalePayload({
          clientMutationId: 'acct-gcash-refund',
          shiftId,
          qty: 2,
          unitPrice: 200,
          payments: [
            { methodId: 'gcash', methodName: 'GCash', methodType: 'ewallet', amount: 400 },
          ],
        }),
      );
    expect(gcashSaleRes.status).toBe(201);
    const gcashTxId = gcashSaleRes.body.transaction.id as string;

    // Refund GCash sale -> refundsTotal becomes 400, expectedCash MUST remain 1550 (not 1150!)
    const gcashRefundRes = await request(app)
      .post(`/api/transactions/${gcashTxId}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'GCash duplicate transfer reversed' });
    expect(gcashRefundRes.status).toBe(200);
    expect(gcashRefundRes.body.paymentStatus).toBe('refunded');

    // Second refund attempt must fail with 409
    const doubleRefund = await request(app)
      .post(`/api/transactions/${gcashTxId}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Duplicate refund' });
    expect(doubleRefund.status).toBe(409);

    // Cash-in +250, Cash-out -100 -> expectedCash = 1550 + 250 - 100 = 1700
    const cashInRes = await request(app)
      .post(`/api/shifts/${shiftId}/movement`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'cash_in', amount: 250, reason: 'Extra change coins' });
    expect(cashInRes.status).toBe(200);
    expect(cashInRes.body.expectedCash).toBe(1800);

    const cashOutRes = await request(app)
      .post(`/api/shifts/${shiftId}/movement`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'cash_out', amount: 100, reason: 'Messenger fare' });
    expect(cashOutRes.status).toBe(200);
    expect(cashOutRes.body.expectedCash).toBe(1700);

    // Close shift with actualCash = 1692.5 -> discrepancy = -7.5
    const closeRes = await request(app)
      .post(`/api/shifts/${shiftId}/close`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ actualCash: 1692.5, reconciliationNote: 'Short by 7.50 coin' });
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.discrepancy).toBe(-7.5);
  });
});
