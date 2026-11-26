import express from 'express';
import { db, writeAuditLog } from '../db.ts';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth.ts';
import { evaluateAndDispatchCriticalAlerts } from '../criticalAlertService.ts';
import {
  genId,
  mapPrintJobRow,
  mapTransactionRow,
  parseJsonSafe,
} from '../mappers.ts';
import type {
  CartItem,
  Customer,
  ExpenseRecord,
  PrintJob,
  Transaction,
} from '../../shared/types.ts';

export const posRouter = express.Router();

export function applyTransactionCreation(
  payload: Transaction,
  actorId: string,
  actorName: string,
): { transaction: Transaction; duplicate: boolean } {
  const existing = db
    .prepare('SELECT * FROM transactions WHERE client_mutation_id = ?')
    .get(payload.clientMutationId) as Record<string, unknown> | undefined;

  if (existing) {
    return { transaction: mapTransactionRow(existing), duplicate: true };
  }

  const txId = payload.id || genId('txn');
  const receiptNumber =
    payload.receiptNumber ||
    `${payload.type === 'quotation' ? 'QT' : payload.type === 'held' ? 'HLD' : 'OR'}-${new Date()
      .toISOString()
      .slice(2, 10)
      .replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
  const now = payload.createdAt || new Date().toISOString();

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
      payload.clientMutationId,
      payload.type,
      payload.customerId || null,
      payload.customerName || 'Walk-in Customer',
      payload.cashierId || actorId,
      payload.cashierName || actorName,
      payload.shiftId || null,
      JSON.stringify(payload.items || []),
      Number(payload.subtotal) || 0,
      Number(payload.itemDiscountsTotal) || 0,
      payload.orderDiscountType || 'none',
      Number(payload.orderDiscountValue) || 0,
      Number(payload.orderDiscountAmount) || 0,
      Number(payload.taxAmount) || 0,
      Number(payload.totalAmount) || 0,
      Number(payload.amountPaid) || 0,
      Number(payload.changeAmount) || 0,
      Number(payload.balanceDue) || 0,
      payload.paymentStatus,
      JSON.stringify(payload.payments || []),
      payload.notes || '',
      now,
    );

    if (payload.type === 'sale') {
      const items = (payload.items || []) as CartItem[];

      const deductedInventoryIds = new Set<string>();
      for (const item of items) {
        for (const binding of item.consumables || []) {
          const deductQty = Number((binding.quantityPerUnit * item.effectiveQuantity).toFixed(2));
          if (deductQty <= 0) continue;
          const invRow = db
            .prepare('SELECT id, name, quantity_on_hand, unit_cost FROM inventory_items WHERE id = ?')
            .get(binding.inventoryItemId) as
            | { id: string; name: string; quantity_on_hand: number; unit_cost: number }
            | undefined;
          if (invRow) {
            deductedInventoryIds.add(invRow.id);
            const qtyBefore = Number(invRow.quantity_on_hand) || 0;
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
        const pointsEarned = Math.floor(Number(payload.amountPaid) / 10);
        db.prepare(`
          UPDATE customers
          SET total_spent = total_spent + ?,
              loyalty_points = loyalty_points + ?,
              outstanding_balance = outstanding_balance + ?
          WHERE id = ?
        `).run(
          Number(payload.amountPaid) || 0,
          pointsEarned,
          Number(payload.balanceDue) || 0,
          payload.customerId,
        );
      }

      if (payload.shiftId) {
        const cashPaid = (payload.payments || [])
          .filter((p) => p.methodType === 'cash')
          .reduce((s, p) => s + Number(p.amount), 0);
        const netCashAdded = Math.max(0, cashPaid - (Number(payload.changeAmount) || 0));
        const electronicPaid = (payload.payments || [])
          .filter((p) => p.methodType !== 'cash' && p.methodType !== 'credit_balance')
          .reduce((s, p) => s + Number(p.amount), 0);

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
      `${receiptNumber} · ${payload.customerName} · ${payload.totalAmount}`,
    );
  });

  runAtomic();
  const saved = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId) as Record<string, unknown>;
  return { transaction: mapTransactionRow(saved), duplicate: false };
}

posRouter.post('/transactions', requireAuth, (req: AuthenticatedRequest, res) => {
  const payload = req.body as Transaction;
  if (!payload || !payload.clientMutationId || !Array.isArray(payload.items) || payload.items.length === 0) {
    return res.status(400).json({ error: 'Transaction items and clientMutationId are required.' });
  }
  const result = applyTransactionCreation(payload, req.authUser!.id, req.authUser!.fullName);
  res.status(result.duplicate ? 200 : 201).json(result);
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
    res.json(mapTransactionRow(updated));
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
    res.json(mapTransactionRow(updated));
  },
);

posRouter.post('/print-jobs', requireAuth, (req: AuthenticatedRequest, res) => {
  const j = req.body as Partial<PrintJob>;
  if (!j.title || !j.customerName) {
    return res.status(400).json({ error: 'Job title and customer name are required.' });
  }
  const id = genId('job');
  const joNumber =
    j.jobOrderNumber ||
    `JO-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.floor(
      100 + Math.random() * 900,
    )}`;
  const now = new Date().toISOString();
  const total = Number(j.totalAmount) || 0;
  const deposit = Number(j.depositAmount) || 0;
  const remaining = Math.max(0, total - deposit);
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
    j.customerName,
    j.customerPhone || '',
    j.title,
    j.specifications || '',
    JSON.stringify(j.attachmentNames || []),
    j.instructions || '',
    j.assignedOperator || req.authUser!.fullName,
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
  res.status(201).json(mapPrintJobRow(saved));
});

posRouter.patch('/print-jobs/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id);
  const existing = db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existing) return res.status(404).json({ error: 'Print job not found.' });

  const {
    productionStatus,
    paymentStatus,
    assignedOperator,
    instructions,
    depositAmount,
    note,
  } = req.body || {};

  const now = new Date().toISOString();
  const history = parseJsonSafe<Array<Record<string, unknown>>>(existing.history_json as string, []);
  if (productionStatus && productionStatus !== existing.production_status) {
    history.push({
      status: productionStatus,
      changedBy: req.authUser!.fullName,
      note: note || `Moved to ${String(productionStatus).replace(/_/g, ' ')}`,
      timestamp: now,
    });
  }

  const total = Number(existing.total_amount) || 0;
  const nextDeposit = depositAmount !== undefined ? Number(depositAmount) : Number(existing.deposit_amount);
  const nextRemaining = Math.max(0, total - nextDeposit);

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
  res.json(mapPrintJobRow(updated));
});

posRouter.post('/customers', requireAuth, (_req: AuthenticatedRequest, res) => {
  const c = _req.body as Partial<Customer>;
  if (!c.name || !String(c.name).trim()) {
    return res.status(400).json({ error: 'Customer name is required.' });
  }
  const id = genId('cust');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO customers (
      id, name, phone, email, address, customer_group, discount_percent, loyalty_points,
      outstanding_balance, total_spent, notes, is_demo, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 0, ?)
  `).run(
    id,
    String(c.name).trim(),
    c.phone || '',
    c.email || '',
    c.address || '',
    c.group || 'regular',
    Number(c.discountPercent) || 0,
    Number(c.loyaltyPoints) || 0,
    c.notes || '',
    now,
  );
  res.status(201).json({
    id,
    name: String(c.name).trim(),
    phone: c.phone || '',
    email: c.email || '',
    address: c.address || '',
    group: c.group || 'regular',
    discountPercent: Number(c.discountPercent) || 0,
    loyaltyPoints: Number(c.loyaltyPoints) || 0,
    outstandingBalance: 0,
    totalSpent: 0,
    notes: c.notes || '',
    isDemo: false,
    createdAt: now,
  });
});

posRouter.post('/customers/:id/pay-balance', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id);
  const amount = Number(req.body?.amount) || 0;
  if (amount <= 0) return res.status(400).json({ error: 'Payment amount must be positive.' });

  const cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!cust) return res.status(404).json({ error: 'Customer not found.' });

  const currentBal = Number(cust.outstanding_balance) || 0;
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
  res.json({ id, outstandingBalance: nextBal });
});

posRouter.post('/expenses', requireAuth, (req: AuthenticatedRequest, res) => {
  const e = req.body as Partial<ExpenseRecord>;
  if (!e.description || !(Number(e.amount) > 0)) {
    return res.status(400).json({ error: 'Description and positive amount are required.' });
  }
  const id = genId('exp');
  const now = new Date().toISOString();
  const expenseDate = e.expenseDate || now.slice(0, 10);
  db.prepare(`
    INSERT INTO expenses (id, category, description, amount, vendor, recorded_by, expense_date, is_demo, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    id,
    e.category || 'other',
    e.description,
    Number(e.amount),
    e.vendor || '',
    req.authUser!.fullName,
    expenseDate,
    now,
  );
  res.status(201).json({
    id,
    category: e.category || 'other',
    description: e.description,
    amount: Number(e.amount),
    vendor: e.vendor || '',
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
  const openingCash = Number(req.body?.openingCash) || 0;
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
  res.status(201).json({
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
  const { type, amount, reason } = req.body || {};
  const val = Number(amount) || 0;
  if (!['cash_in', 'cash_out'].includes(type) || val <= 0 || !reason) {
    return res.status(400).json({ error: 'Valid movement type, positive amount, and reason required.' });
  }
  const shift = db.prepare("SELECT * FROM cashier_shifts WHERE id = ? AND status = 'open'").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!shift) return res.status(404).json({ error: 'Open shift not found.' });

  const movements = parseJsonSafe<Array<Record<string, unknown>>>(shift.cash_movements_json as string, []);
  movements.push({
    id: genId('cm'),
    type,
    amount: val,
    reason: String(reason),
    timestamp: new Date().toISOString(),
  });
  const delta = type === 'cash_in' ? val : -val;
  const expected = Math.max(0, (Number(shift.expected_cash) || 0) + delta);

  db.prepare('UPDATE cashier_shifts SET cash_movements_json = ?, expected_cash = ? WHERE id = ?').run(
    JSON.stringify(movements),
    expected,
    id,
  );
  res.json({ id, cashMovements: movements, expectedCash: expected });
});

posRouter.post('/shifts/:id/close', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id);
  const actualCash = Number(req.body?.actualCash);
  const reconciliationNote = String(req.body?.reconciliationNote || '');
  if (!Number.isFinite(actualCash) || actualCash < 0) {
    return res.status(400).json({ error: 'Actual cash count is required.' });
  }
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
  res.json({ id, status: 'closed', actualCash, discrepancy, endedAt: now });
});
