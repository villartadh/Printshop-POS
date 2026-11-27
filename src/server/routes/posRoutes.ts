import express from 'express';
import { db, writeAuditLog } from '../db.ts';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth.ts';
import { evaluateAndDispatchCriticalAlerts } from '../criticalAlertService.ts';
import {
  HttpError,
  optionalString,
  parseFiniteNumber,
  requireNonEmptyString,
  requirePlainObject,
} from '../httpUtils.ts';
import {
  genId,
  mapPrintJobRow,
  mapTransactionRow,
  parseJsonSafe,
  safeFinite,
} from '../mappers.ts';
import type {
  CartItem,
  Customer,
  ExpenseRecord,
  PrintJob,
  Transaction,
} from '../../shared/types.ts';

export const posRouter = express.Router();

const ALLOWED_TRANSACTION_TYPES = new Set(['sale', 'quotation', 'held']);
const ALLOWED_PAYMENT_STATUSES = new Set(['paid', 'partial', 'unpaid', 'voided', 'refunded']);

export function applyTransactionCreation(
  payload: Transaction,
  actorId: string,
  actorName: string,
): { transaction: Transaction; duplicate: boolean } {
  if (!payload || typeof payload !== 'object') {
    throw new HttpError(400, 'Transaction payload is required.');
  }
  const clientMutationId = requireNonEmptyString(payload.clientMutationId, 'clientMutationId', 120);
  if (!ALLOWED_TRANSACTION_TYPES.has(payload.type)) {
    throw new HttpError(400, 'Invalid transaction type.');
  }
  if (!ALLOWED_PAYMENT_STATUSES.has(payload.paymentStatus)) {
    throw new HttpError(400, 'Invalid payment status.');
  }
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw new HttpError(400, 'At least one transaction line item is required.');
  }

  const existing = db
    .prepare('SELECT * FROM transactions WHERE client_mutation_id = ?')
    .get(clientMutationId) as Record<string, unknown> | undefined;

  if (existing) {
    return { transaction: mapTransactionRow(existing), duplicate: true };
  }

  const subtotal = parseFiniteNumber(payload.subtotal, 'Subtotal', { min: 0, fallback: 0 });
  const itemDiscountsTotal = parseFiniteNumber(payload.itemDiscountsTotal, 'Item discounts total', {
    min: 0,
    fallback: 0,
  });
  const orderDiscountValue = parseFiniteNumber(payload.orderDiscountValue, 'Order discount value', {
    min: 0,
    fallback: 0,
  });
  const orderDiscountAmount = parseFiniteNumber(payload.orderDiscountAmount, 'Order discount amount', {
    min: 0,
    fallback: 0,
  });
  const taxAmount = parseFiniteNumber(payload.taxAmount, 'Tax amount', { min: 0, fallback: 0 });
  const totalAmount = parseFiniteNumber(payload.totalAmount, 'Total amount', { min: 0, fallback: 0 });
  const amountPaid = parseFiniteNumber(payload.amountPaid, 'Amount paid', { min: 0, fallback: 0 });
  const changeAmount = parseFiniteNumber(payload.changeAmount, 'Change amount', { min: 0, fallback: 0 });
  const balanceDue = parseFiniteNumber(payload.balanceDue, 'Balance due', { min: 0, fallback: 0 });

  const txId = (typeof payload.id === 'string' && payload.id.trim()) || genId('txn');
  const receiptNumber =
    (typeof payload.receiptNumber === 'string' && payload.receiptNumber.trim()) ||
    `${payload.type === 'quotation' ? 'QT' : payload.type === 'held' ? 'HLD' : 'OR'}-${new Date()
      .toISOString()
      .slice(2, 10)
      .replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
  const now = (typeof payload.createdAt === 'string' && payload.createdAt.trim()) || new Date().toISOString();
  const safePayments = Array.isArray(payload.payments) ? payload.payments : [];

  const runAtomic = db.transaction(() => {
    db.prepare(`
      INSERT INTO transactions (
        id, receipt_number, client_mutation_id, type, customer_id, customer_name, cashier_id,
        cashier_name, shift_id, items_json, subtotal, item_discounts_total, order_discount_type,
        order_discount_value, order_discount_amount, tax_amount, total_amount, amount_paid,
        change_amount, balance_due, payment_status, payments_json, notes, sync_status, is_demo, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', 0, ?)
    `).run(
      txId,
      receiptNumber,
      clientMutationId,
      payload.type,
      payload.customerId || null,
      optionalString(payload.customerName, 160, 'Walk-in Customer') || 'Walk-in Customer',
      payload.cashierId || actorId,
      optionalString(payload.cashierName, 120, actorName) || actorName,
      payload.shiftId || null,
      JSON.stringify(payload.items),
      subtotal,
      itemDiscountsTotal,
      payload.orderDiscountType || 'none',
      orderDiscountValue,
      orderDiscountAmount,
      taxAmount,
      totalAmount,
      amountPaid,
      changeAmount,
      balanceDue,
      payload.paymentStatus,
      JSON.stringify(safePayments),
      optionalString(payload.notes, 800, ''),
      now,
    );

    if (payload.type === 'sale') {
      const items = payload.items as CartItem[];

      const deductedInventoryIds = new Set<string>();
      for (const item of items) {
        if (!item) continue;
        const effectiveQty = Math.max(0, safeFinite(item.effectiveQuantity, 0));
        const consumables = Array.isArray(item.consumables) ? item.consumables : [];
        for (const binding of consumables) {
          if (!binding || typeof binding.inventoryItemId !== 'string') continue;
          const qtyPerUnit = Math.max(0, safeFinite(binding.quantityPerUnit, 0));
          const deductQty = Number((qtyPerUnit * effectiveQty).toFixed(2));
          if (!Number.isFinite(deductQty) || deductQty <= 0) continue;
          const invRow = db
            .prepare('SELECT id, name, quantity_on_hand, unit_cost FROM inventory_items WHERE id = ?')
            .get(binding.inventoryItemId) as
            | { id: string; name: string; quantity_on_hand: number; unit_cost: number }
            | undefined;
          if (invRow) {
            deductedInventoryIds.add(invRow.id);
            const qtyBefore = safeFinite(invRow.quantity_on_hand, 0);
            const nextQty = Math.max(0, Number((qtyBefore - deductQty).toFixed(2)));
            db.prepare('UPDATE inventory_items SET quantity_on_hand = ?, updated_at = ? WHERE id = ?').run(
              nextQty,
              now,
              invRow.id,
            );
            db.prepare(`
              INSERT INTO stock_movements (
                id, inventory_item_id, item_name, movement_type, quantity_before, quantity_delta,
                balance_after, unit_cost_at_movement, reference_type, reference, performed_by_id,
                performed_by, note, occurred_at, created_at
              ) VALUES (?, ?, ?, 'sale_deduction', ?, ?, ?, ?, 'sale', ?, ?, ?, ?, ?, ?)
            `).run(
              genId('mov'),
              invRow.id,
              invRow.name,
              qtyBefore,
              -deductQty,
              nextQty,
              Number(invRow.unit_cost) || 0,
              receiptNumber,
              actorId,
              actorName,
              `Auto-deducted for ${item.serviceName}`,
              now,
              now,
            );
          }
        }
      }
      if (deductedInventoryIds.size > 0) {
        void evaluateAndDispatchCriticalAlerts({
          targetItemIds: Array.from(deductedInventoryIds),
          actorId,
          actorName,
        }).catch(() => undefined);
      }

      const prodItems = items.filter((i) => i.requiresProductionJob);
      if (prodItems.length > 0) {
        const jobId = genId('job');
        const joNumber = `JO-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.floor(
          100 + Math.random() * 900,
        )}`;
        const custRow = payload.customerId
          ? (db.prepare('SELECT phone FROM customers WHERE id = ?').get(payload.customerId) as
              | { phone: string }
              | undefined)
          : undefined;
        const specs = prodItems.map((i) => `${i.serviceName} (${i.displaySummary})`).join('; ');
        db.prepare(`
          INSERT INTO print_jobs (
            id, job_order_number, transaction_id, customer_id, customer_name, customer_phone,
            title, specifications, attachment_names_json, instructions, assigned_operator,
            production_status, payment_status, total_amount, deposit_amount, remaining_balance,
            estimated_completion, deadline, history_json, is_demo, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, '', 'pending', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        `).run(
          jobId,
          joNumber,
          txId,
          payload.customerId || null,
          payload.customerName || 'Walk-in Customer',
          custRow?.phone || '',
          prodItems[0].serviceName + (prodItems.length > 1 ? ` +${prodItems.length - 1}` : ''),
          specs,
          payload.notes || '',
          payload.paymentStatus,
          Number(payload.totalAmount) || 0,
          Number(payload.amountPaid) || 0,
          Number(payload.balanceDue) || 0,
          new Date(Date.now() + 3600000 * 4).toISOString(),
          new Date(Date.now() + 3600000 * 24).toISOString(),
          JSON.stringify([
            {
              status: 'pending',
              changedBy: actorName,
              note: `Created from POS transaction ${receiptNumber}`,
              timestamp: now,
            },
          ]),
          now,
          now,
        );
      }

      if (payload.customerId) {
        const pointsEarned = Math.floor(amountPaid / 10);
        db.prepare(`
          UPDATE customers
          SET total_spent = total_spent + ?,
              loyalty_points = loyalty_points + ?,
              outstanding_balance = outstanding_balance + ?
          WHERE id = ?
        `).run(amountPaid, pointsEarned, balanceDue, payload.customerId);
      }

      if (payload.shiftId) {
        const cashPaid = safePayments
          .filter((p) => p && p.methodType === 'cash')
          .reduce((s, p) => s + Math.max(0, safeFinite(p.amount, 0)), 0);
        const netCashAdded = Math.max(0, cashPaid - changeAmount);
        const electronicPaid = safePayments
          .filter((p) => p && p.methodType !== 'cash' && p.methodType !== 'credit_balance')
          .reduce((s, p) => s + Math.max(0, safeFinite(p.amount, 0)), 0);

        db.prepare(`
          UPDATE cashier_shifts
          SET cash_sales = cash_sales + ?,
              electronic_sales = electronic_sales + ?,
              expected_cash = expected_cash + ?
          WHERE id = ? AND status = 'open'
        `).run(netCashAdded, electronicPaid, netCashAdded, payload.shiftId);
      }
    }

    writeAuditLog(
      actorId,
      actorName,
      `TXN_${payload.type.toUpperCase()}`,
      'transaction',
      txId,
      `${receiptNumber} · ${optionalString(payload.customerName, 120, 'Walk-in Customer')} · ${totalAmount}`,
    );
  });

  runAtomic();
  const saved = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId) as Record<string, unknown>;
  return { transaction: mapTransactionRow(saved), duplicate: false };
}

posRouter.post('/transactions', requireAuth, (req: AuthenticatedRequest, res) => {
  const payload = requirePlainObject(req.body, 'Transaction') as unknown as Transaction;
  if (!payload.clientMutationId || !Array.isArray(payload.items) || payload.items.length === 0) {
    return res.status(400).json({ error: 'Transaction items and clientMutationId are required.' });
  }
  const result = applyTransactionCreation(payload, req.authUser!.id, req.authUser!.fullName);
  return res.status(result.duplicate ? 200 : 201).json(result);
});

posRouter.delete('/transactions/:id/held', requireAuth, (req: AuthenticatedRequest, res) => {
  db.prepare("DELETE FROM transactions WHERE id = ? AND type = 'held'").run(String(req.params.id));
  res.json({ ok: true });
});

posRouter.post(
  '/transactions/:id/void',
  requireAuth,
  requireRole(['admin', 'manager']),
  (req: AuthenticatedRequest, res) => {
    const id = String(req.params.id);
    const { reason } = req.body || {};
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'A void reason is required.' });
    }
    const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) return res.status(404).json({ error: 'Transaction not found.' });

    db.prepare("UPDATE transactions SET payment_status = 'voided', void_reason = ? WHERE id = ?").run(
      String(reason).trim(),
      id,
    );
    writeAuditLog(
      req.authUser!.id,
      req.authUser!.fullName,
      'TXN_VOIDED',
      'transaction',
      id,
      `Voided ${existing.receipt_number}: ${reason}`,
    );
    const updated = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as Record<string, unknown>;
    return res.json(mapTransactionRow(updated));
  },
);

posRouter.post(
  '/transactions/:id/refund',
  requireAuth,
  requireRole(['admin', 'manager']),
  (req: AuthenticatedRequest, res) => {
    const id = String(req.params.id);
    const { reason } = req.body || {};
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'A refund reason is required.' });
    }
    const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) return res.status(404).json({ error: 'Transaction not found.' });

    db.prepare("UPDATE transactions SET payment_status = 'refunded', refund_reason = ? WHERE id = ?").run(
      String(reason).trim(),
      id,
    );
    if (existing.shift_id) {
      db.prepare(`
        UPDATE cashier_shifts
        SET refunds_total = refunds_total + ?,
            expected_cash = expected_cash - ?
        WHERE id = ? AND status = 'open'
      `).run(Number(existing.amount_paid) || 0, Number(existing.amount_paid) || 0, existing.shift_id);
    }
    writeAuditLog(
      req.authUser!.id,
      req.authUser!.fullName,
      'TXN_REFUNDED',
      'transaction',
      id,
      `Refunded ${existing.receipt_number}: ${reason}`,
    );
    const updated = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as Record<string, unknown>;
    return res.json(mapTransactionRow(updated));
  },
);

posRouter.post('/print-jobs', requireAuth, (req: AuthenticatedRequest, res) => {
  const j = requirePlainObject(req.body, 'Print job') as Partial<PrintJob>;
  const title = requireNonEmptyString(j.title, 'Job title', 160);
  const customerName = requireNonEmptyString(j.customerName, 'Customer name', 160);
  const id = genId('job');
  const joNumber =
    (typeof j.jobOrderNumber === 'string' && j.jobOrderNumber.trim()) ||
    `JO-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.floor(
      100 + Math.random() * 900,
    )}`;
  const now = new Date().toISOString();
  const total = parseFiniteNumber(j.totalAmount, 'Total amount', { min: 0, fallback: 0 });
  const deposit = parseFiniteNumber(j.depositAmount, 'Deposit amount', { min: 0, fallback: 0 });
  const remaining = Math.max(0, Number((total - deposit).toFixed(2)));
  const paymentStatus = deposit >= total && total > 0 ? 'paid' : deposit > 0 ? 'partial' : 'unpaid';

  db.prepare(`
    INSERT INTO print_jobs (
      id, job_order_number, transaction_id, customer_id, customer_name, customer_phone,
      title, specifications, attachment_names_json, instructions, assigned_operator,
      production_status, payment_status, total_amount, deposit_amount, remaining_balance,
      estimated_completion, deadline, history_json, is_demo, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    id,
    joNumber,
    j.transactionId || null,
    j.customerId || null,
    customerName,
    optionalString(j.customerPhone, 60),
    title,
    optionalString(j.specifications, 800),
    JSON.stringify(Array.isArray(j.attachmentNames) ? j.attachmentNames : []),
    optionalString(j.instructions, 800),
    optionalString(j.assignedOperator, 120, req.authUser!.fullName) || req.authUser!.fullName,
    j.productionStatus || 'pending',
    j.paymentStatus || paymentStatus,
    total,
    deposit,
    remaining,
    j.estimatedCompletion || new Date(Date.now() + 3600000 * 4).toISOString(),
    j.deadline || new Date(Date.now() + 3600000 * 24).toISOString(),
    JSON.stringify([
      {
        status: j.productionStatus || 'pending',
        changedBy: req.authUser!.fullName,
        note: 'Job order logged',
        timestamp: now,
      },
    ]),
    now,
    now,
  );
  const saved = db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(id) as Record<string, unknown>;
  return res.status(201).json(mapPrintJobRow(saved));
});

posRouter.patch('/print-jobs/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id);
  const existing = db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existing) return res.status(404).json({ error: 'Print job not found.' });

  const body = requirePlainObject(req.body, 'Print job update');
  const {
    productionStatus,
    paymentStatus,
    assignedOperator,
    instructions,
    depositAmount,
    note,
  } = body;

  const now = new Date().toISOString();
  const history = parseJsonSafe<Array<Record<string, unknown>>>(existing.history_json as string, []);
  if (typeof productionStatus === 'string' && productionStatus && productionStatus !== existing.production_status) {
    history.push({
      status: productionStatus,
      changedBy: req.authUser!.fullName,
      note: optionalString(note, 300) || `Moved to ${productionStatus.replace(/_/g, ' ')}`,
      timestamp: now,
    });
  }

  const total = safeFinite(existing.total_amount, 0);
  const nextDeposit =
    depositAmount !== undefined
      ? parseFiniteNumber(depositAmount, 'Deposit amount', { min: 0, max: 1_000_000_000 })
      : safeFinite(existing.deposit_amount, 0);
  const nextRemaining = Math.max(0, Number((total - nextDeposit).toFixed(2)));

  db.prepare(`
    UPDATE print_jobs
    SET production_status = ?, payment_status = ?, assigned_operator = ?, instructions = ?,
        deposit_amount = ?, remaining_balance = ?, history_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    productionStatus ?? existing.production_status,
    paymentStatus ?? existing.payment_status,
    assignedOperator ?? existing.assigned_operator,
    instructions ?? existing.instructions,
    nextDeposit,
    nextRemaining,
    JSON.stringify(history),
    now,
    id,
  );

  const updated = db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(id) as Record<string, unknown>;
  return res.json(mapPrintJobRow(updated));
});

posRouter.post('/customers', requireAuth, (req: AuthenticatedRequest, res) => {
  const c = requirePlainObject(req.body, 'Customer') as Partial<Customer>;
  const name = requireNonEmptyString(c.name, 'Customer name', 140);
  const discountPercent = parseFiniteNumber(c.discountPercent, 'Discount percent', {
    min: 0,
    max: 100,
    fallback: 0,
  });
  const loyaltyPoints = parseFiniteNumber(c.loyaltyPoints, 'Loyalty points', {
    min: 0,
    max: 1_000_000,
    integer: true,
    fallback: 0,
  });
  const id = genId('cust');
  const now = new Date().toISOString();
  const phone = optionalString(c.phone, 60);
  const email = optionalString(c.email, 140);
  const address = optionalString(c.address, 240);
  const group = c.group || 'regular';
  const notes = optionalString(c.notes, 600);

  db.prepare(`
    INSERT INTO customers (
      id, name, phone, email, address, customer_group, discount_percent, loyalty_points,
      outstanding_balance, total_spent, notes, is_demo, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 0, ?)
  `).run(
    id,
    name,
    phone,
    email,
    address,
    group,
    discountPercent,
    loyaltyPoints,
    notes,
    now,
  );
  return res.status(201).json({
    id,
    name,
    phone,
    email,
    address,
    group,
    discountPercent,
    loyaltyPoints,
    outstandingBalance: 0,
    totalSpent: 0,
    notes,
    isDemo: false,
    createdAt: now,
  });
});

posRouter.post('/customers/:id/pay-balance', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id);
  const amount = parseFiniteNumber(req.body?.amount, 'Payment amount', {
    min: 0.01,
    max: 1_000_000_000,
  });

  const cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!cust) return res.status(404).json({ error: 'Customer not found.' });

  const currentBal = safeFinite(cust.outstanding_balance, 0);
  const applied = Math.min(currentBal, amount);
  const nextBal = Math.max(0, Number((currentBal - applied).toFixed(2)));
  db.prepare('UPDATE customers SET outstanding_balance = ?, total_spent = total_spent + ? WHERE id = ?').run(
    nextBal,
    applied,
    id,
  );
  writeAuditLog(
    req.authUser!.id,
    req.authUser!.fullName,
    'CUSTOMER_BALANCE_PAYMENT',
    'customer',
    id,
    `Collected ${applied} toward balance of ${cust.name}`,
  );
  return res.json({ id, outstandingBalance: nextBal });
});

posRouter.post('/expenses', requireAuth, (req: AuthenticatedRequest, res) => {
  const e = requirePlainObject(req.body, 'Expense') as Partial<ExpenseRecord>;
  const description = requireNonEmptyString(e.description, 'Expense description', 300);
  const amount = parseFiniteNumber(e.amount, 'Expense amount', { min: 0.01, max: 1_000_000_000 });
  const id = genId('exp');
  const now = new Date().toISOString();
  const expenseDate = optionalString(e.expenseDate, 32, now.slice(0, 10)) || now.slice(0, 10);
  const category = e.category || 'other';
  const vendor = optionalString(e.vendor, 140);

  db.prepare(`
    INSERT INTO expenses (id, category, description, amount, vendor, recorded_by, expense_date, is_demo, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    id,
    category,
    description,
    amount,
    vendor,
    req.authUser!.fullName,
    expenseDate,
    now,
  );
  return res.status(201).json({
    id,
    category,
    description,
    amount,
    vendor,
    recordedBy: req.authUser!.fullName,
    expenseDate,
    isDemo: false,
    createdAt: now,
  });
});

posRouter.delete(
  '/expenses/:id',
  requireAuth,
  requireRole(['admin', 'manager']),
  (req: AuthenticatedRequest, res) => {
    db.prepare('DELETE FROM expenses WHERE id = ?').run(String(req.params.id));
    res.json({ ok: true });
  },
);

posRouter.post('/shifts/start', requireAuth, (req: AuthenticatedRequest, res) => {
  const openingCash = parseFiniteNumber(req.body?.openingCash, 'Opening cash', {
    min: 0,
    max: 1_000_000_000,
    fallback: 0,
  });
  const openShift = db
    .prepare("SELECT id FROM cashier_shifts WHERE cashier_id = ? AND status = 'open'")
    .get(req.authUser!.id);
  if (openShift) {
    return res.status(409).json({ error: 'You already have an open cashier shift.' });
  }
  const id = genId('shf');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO cashier_shifts (
      id, cashier_id, cashier_name, status, opening_cash, cash_sales, electronic_sales,
      refunds_total, cash_movements_json, expected_cash, started_at
    ) VALUES (?, ?, ?, 'open', ?, 0, 0, 0, '[]', ?, ?)
  `).run(id, req.authUser!.id, req.authUser!.fullName, openingCash, openingCash, now);

  writeAuditLog(
    req.authUser!.id,
    req.authUser!.fullName,
    'SHIFT_STARTED',
    'shift',
    id,
    `Started shift with opening cash ${openingCash}`,
  );
  return res.status(201).json({
    id,
    cashierId: req.authUser!.id,
    cashierName: req.authUser!.fullName,
    status: 'open',
    openingCash,
    cashSales: 0,
    electronicSales: 0,
    refundsTotal: 0,
    cashMovements: [],
    expectedCash: openingCash,
    actualCash: null,
    discrepancy: null,
    reconciliationNote: '',
    startedAt: now,
    endedAt: null,
  });
});

posRouter.post('/shifts/:id/movement', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id);
  const body = requirePlainObject(req.body, 'Cash movement');
  const type = body.type;
  if (type !== 'cash_in' && type !== 'cash_out') {
    return res.status(400).json({ error: 'Movement type must be cash_in or cash_out.' });
  }
  const val = parseFiniteNumber(body.amount, 'Amount', { min: 0.01, max: 1_000_000_000 });
  const reason = requireNonEmptyString(body.reason, 'Movement reason', 300);

  const shift = db.prepare("SELECT * FROM cashier_shifts WHERE id = ? AND status = 'open'").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!shift) return res.status(404).json({ error: 'Open shift not found.' });

  const movements = parseJsonSafe<Array<Record<string, unknown>>>(shift.cash_movements_json as string, []);
  movements.push({
    id: genId('cm'),
    type,
    amount: val,
    reason,
    timestamp: new Date().toISOString(),
  });
  const delta = type === 'cash_in' ? val : -val;
  const expected = Math.max(0, Number((safeFinite(shift.expected_cash, 0) + delta).toFixed(2)));

  db.prepare('UPDATE cashier_shifts SET cash_movements_json = ?, expected_cash = ? WHERE id = ?').run(
    JSON.stringify(movements),
    expected,
    id,
  );
  return res.json({ id, cashMovements: movements, expectedCash: expected });
});

posRouter.post('/shifts/:id/close', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id);
  const actualCash = parseFiniteNumber(req.body?.actualCash, 'Actual cash count', {
    min: 0,
    max: 1_000_000_000,
  });
  const reconciliationNote = optionalString(req.body?.reconciliationNote, 500);
  const shift = db.prepare("SELECT * FROM cashier_shifts WHERE id = ? AND status = 'open'").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!shift) return res.status(404).json({ error: 'Open shift not found.' });

  const expected = Number(shift.expected_cash) || 0;
  const discrepancy = Number((actualCash - expected).toFixed(2));
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE cashier_shifts
    SET status = 'closed', actual_cash = ?, discrepancy = ?, reconciliation_note = ?, ended_at = ?
    WHERE id = ?
  `).run(actualCash, discrepancy, reconciliationNote, now, id);

  writeAuditLog(
    req.authUser!.id,
    req.authUser!.fullName,
    'SHIFT_CLOSED',
    'shift',
    id,
    `Closed shift. Expected ${expected}, Actual ${actualCash}, Discrepancy ${discrepancy}`,
  );
  return res.json({ id, status: 'closed', actualCash, discrepancy, endedAt: now });
});
