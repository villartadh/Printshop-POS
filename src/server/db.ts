import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import {
  DEFAULT_SETTINGS,
  DEMO_CATEGORIES,
  DEMO_CUSTOMERS,
  DEMO_EXPENSES,
  DEMO_INVENTORY,
  DEMO_PRINT_JOBS,
  DEMO_SERVICES,
  DEMO_TRANSACTIONS,
} from '../shared/defaults.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'printshop-pos.db');
export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK(role IN ('admin', 'manager', 'cashier', 'operator')),
      password_hash TEXT NOT NULL,
      pin_hash TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      preferred_landing_module TEXT DEFAULT 'pos',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_demo INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      sku TEXT NOT NULL,
      name TEXT NOT NULL,
      category_id TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon_name TEXT NOT NULL DEFAULT 'Printer',
      pricing_method TEXT NOT NULL,
      base_price REAL NOT NULL DEFAULT 0,
      unit_label TEXT NOT NULL DEFAULT 'pc',
      cost_estimate REAL NOT NULL DEFAULT 0,
      requires_configuration INTEGER NOT NULL DEFAULT 1,
      requires_production_job INTEGER NOT NULL DEFAULT 0,
      allow_custom_dimensions INTEGER NOT NULL DEFAULT 0,
      allow_pages_and_copies INTEGER NOT NULL DEFAULT 0,
      allow_rush_fee INTEGER NOT NULL DEFAULT 0,
      rush_fee_percent REAL NOT NULL DEFAULT 25,
      default_design_fee REAL NOT NULL DEFAULT 0,
      bulk_tiers_json TEXT NOT NULL DEFAULT '[]',
      formula_expression TEXT NOT NULL DEFAULT '',
      attribute_groups_json TEXT NOT NULL DEFAULT '[]',
      consumables_json TEXT NOT NULL DEFAULT '[]',
      is_favorite INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      is_demo INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_items (
      id TEXT PRIMARY KEY,
      sku TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      item_type TEXT NOT NULL CHECK(item_type IN ('consumable', 'finished_product')),
      unit TEXT NOT NULL,
      quantity_on_hand REAL NOT NULL DEFAULT 0,
      reorder_level REAL NOT NULL DEFAULT 0,
      unit_cost REAL NOT NULL DEFAULT 0,
      supplier TEXT NOT NULL DEFAULT '',
      is_demo INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY,
      inventory_item_id TEXT NOT NULL,
      item_name TEXT NOT NULL,
      movement_type TEXT NOT NULL,
      quantity_delta REAL NOT NULL,
      balance_after REAL NOT NULL,
      reference TEXT NOT NULL DEFAULT '',
      performed_by TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      customer_group TEXT NOT NULL DEFAULT 'regular',
      discount_percent REAL NOT NULL DEFAULT 0,
      loyalty_points INTEGER NOT NULL DEFAULT 0,
      outstanding_balance REAL NOT NULL DEFAULT 0,
      total_spent REAL NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      receipt_number TEXT NOT NULL,
      client_mutation_id TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('sale', 'quotation', 'held')),
      customer_id TEXT,
      customer_name TEXT NOT NULL DEFAULT 'Walk-in Customer',
      cashier_id TEXT NOT NULL,
      cashier_name TEXT NOT NULL,
      shift_id TEXT,
      items_json TEXT NOT NULL,
      subtotal REAL NOT NULL,
      item_discounts_total REAL NOT NULL DEFAULT 0,
      order_discount_type TEXT NOT NULL DEFAULT 'none',
      order_discount_value REAL NOT NULL DEFAULT 0,
      order_discount_amount REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL,
      amount_paid REAL NOT NULL DEFAULT 0,
      change_amount REAL NOT NULL DEFAULT 0,
      balance_due REAL NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL,
      payments_json TEXT NOT NULL DEFAULT '[]',
      notes TEXT NOT NULL DEFAULT '',
      sync_status TEXT NOT NULL DEFAULT 'synced',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      void_reason TEXT,
      refund_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS print_jobs (
      id TEXT PRIMARY KEY,
      job_order_number TEXT NOT NULL,
      transaction_id TEXT,
      customer_id TEXT,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      specifications TEXT NOT NULL DEFAULT '',
      attachment_names_json TEXT NOT NULL DEFAULT '[]',
      instructions TEXT NOT NULL DEFAULT '',
      assigned_operator TEXT NOT NULL DEFAULT '',
      production_status TEXT NOT NULL,
      payment_status TEXT NOT NULL,
      total_amount REAL NOT NULL DEFAULT 0,
      deposit_amount REAL NOT NULL DEFAULT 0,
      remaining_balance REAL NOT NULL DEFAULT 0,
      estimated_completion TEXT NOT NULL,
      deadline TEXT NOT NULL,
      history_json TEXT NOT NULL DEFAULT '[]',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      vendor TEXT NOT NULL DEFAULT '',
      recorded_by TEXT NOT NULL,
      expense_date TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cashier_shifts (
      id TEXT PRIMARY KEY,
      cashier_id TEXT NOT NULL,
      cashier_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('open', 'closed')),
      opening_cash REAL NOT NULL DEFAULT 0,
      cash_sales REAL NOT NULL DEFAULT 0,
      electronic_sales REAL NOT NULL DEFAULT 0,
      refunds_total REAL NOT NULL DEFAULT 0,
      cash_movements_json TEXT NOT NULL DEFAULT '[]',
      expected_cash REAL NOT NULL DEFAULT 0,
      actual_cash REAL,
      discrepancy REAL,
      reconciliation_note TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      ended_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Ensure default settings exist
  const settingsRow = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get('app_settings') as
    | { value_json: string }
    | undefined;
  if (!settingsRow) {
    db.prepare('INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)').run(
      'app_settings',
      JSON.stringify(DEFAULT_SETTINGS),
      new Date().toISOString(),
    );
  }

  // Seed initial demonstration dataset only if catalog is empty on first boot
  const serviceCount = (db.prepare('SELECT COUNT(*) as count FROM services').get() as { count: number }).count;
  if (serviceCount === 0) {
    seedDemoDataset();
  }
}

export function seedDemoDataset() {
  const tx = db.transaction(() => {
    const insertCat = db.prepare(
      'INSERT OR IGNORE INTO categories (id, name, sort_order, is_demo) VALUES (?, ?, ?, 1)',
    );
    for (const c of DEMO_CATEGORIES) {
      insertCat.run(c.id, c.name, c.sortOrder);
    }

    const insertInv = db.prepare(`
      INSERT OR IGNORE INTO inventory_items (
        id, sku, name, category, item_type, unit, quantity_on_hand, reorder_level, unit_cost, supplier, is_demo, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);
    for (const inv of DEMO_INVENTORY) {
      insertInv.run(
        inv.id,
        inv.sku,
        inv.name,
        inv.category,
        inv.itemType,
        inv.unit,
        inv.quantityOnHand,
        inv.reorderLevel,
        inv.unitCost,
        inv.supplier,
        inv.updatedAt,
      );
    }

    const insertSrv = db.prepare(`
      INSERT OR IGNORE INTO services (
        id, sku, name, category_id, description, icon_name, pricing_method, base_price, unit_label,
        cost_estimate, requires_configuration, requires_production_job, allow_custom_dimensions,
        allow_pages_and_copies, allow_rush_fee, rush_fee_percent, default_design_fee,
        bulk_tiers_json, formula_expression, attribute_groups_json, consumables_json,
        is_favorite, is_archived, is_demo, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);
    for (const s of DEMO_SERVICES) {
      insertSrv.run(
        s.id,
        s.sku,
        s.name,
        s.categoryId,
        s.description,
        s.iconName,
        s.pricingMethod,
        s.basePrice,
        s.unitLabel,
        s.costEstimate,
        s.requiresConfiguration ? 1 : 0,
        s.requiresProductionJob ? 1 : 0,
        s.allowCustomDimensions ? 1 : 0,
        s.allowPagesAndCopies ? 1 : 0,
        s.allowRushFee ? 1 : 0,
        s.rushFeePercent,
        s.defaultDesignFee,
        JSON.stringify(s.bulkTiers),
        s.formulaExpression || '',
        JSON.stringify(s.attributeGroups),
        JSON.stringify(s.consumables),
        s.isFavorite ? 1 : 0,
        s.isArchived ? 1 : 0,
        s.updatedAt,
      );
    }

    const insertCust = db.prepare(`
      INSERT OR IGNORE INTO customers (
        id, name, phone, email, address, customer_group, discount_percent, loyalty_points,
        outstanding_balance, total_spent, notes, is_demo, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);
    for (const cust of DEMO_CUSTOMERS) {
      insertCust.run(
        cust.id,
        cust.name,
        cust.phone,
        cust.email,
        cust.address,
        cust.group,
        cust.discountPercent,
        cust.loyaltyPoints,
        cust.outstandingBalance,
        cust.totalSpent,
        cust.notes,
        cust.createdAt,
      );
    }

    const insertTxn = db.prepare(`
      INSERT OR IGNORE INTO transactions (
        id, receipt_number, client_mutation_id, type, customer_id, customer_name, cashier_id,
        cashier_name, shift_id, items_json, subtotal, item_discounts_total, order_discount_type,
        order_discount_value, order_discount_amount, tax_amount, total_amount, amount_paid,
        change_amount, balance_due, payment_status, payments_json, notes, sync_status, is_demo, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);
    for (const t of DEMO_TRANSACTIONS) {
      insertTxn.run(
        t.id,
        t.receiptNumber,
        t.clientMutationId,
        t.type,
        t.customerId,
        t.customerName,
        t.cashierId,
        t.cashierName,
        t.shiftId,
        JSON.stringify(t.items),
        t.subtotal,
        t.itemDiscountsTotal,
        t.orderDiscountType,
        t.orderDiscountValue,
        t.orderDiscountAmount,
        t.taxAmount,
        t.totalAmount,
        t.amountPaid,
        t.changeAmount,
        t.balanceDue,
        t.paymentStatus,
        JSON.stringify(t.payments),
        t.notes,
        t.syncStatus,
        t.createdAt,
      );
    }

    const insertJob = db.prepare(`
      INSERT OR IGNORE INTO print_jobs (
        id, job_order_number, transaction_id, customer_id, customer_name, customer_phone,
        title, specifications, attachment_names_json, instructions, assigned_operator,
        production_status, payment_status, total_amount, deposit_amount, remaining_balance,
        estimated_completion, deadline, history_json, is_demo, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    for (const j of DEMO_PRINT_JOBS) {
      insertJob.run(
        j.id,
        j.jobOrderNumber,
        j.transactionId,
        j.customerId,
        j.customerName,
        j.customerPhone,
        j.title,
        j.specifications,
        JSON.stringify(j.attachmentNames),
        j.instructions,
        j.assignedOperator,
        j.productionStatus,
        j.paymentStatus,
        j.totalAmount,
        j.depositAmount,
        j.remainingBalance,
        j.estimatedCompletion,
        j.deadline,
        JSON.stringify(j.history),
        j.createdAt,
        j.updatedAt,
      );
    }

    const insertExp = db.prepare(`
      INSERT OR IGNORE INTO expenses (
        id, category, description, amount, vendor, recorded_by, expense_date, is_demo, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);
    for (const e of DEMO_EXPENSES) {
      insertExp.run(
        e.id,
        e.category,
        e.description,
        e.amount,
        e.vendor,
        e.recordedBy,
        e.expenseDate,
        e.createdAt,
      );
    }
  });
  tx();
}

export function clearDemoDataset() {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM print_jobs WHERE is_demo = 1').run();
    db.prepare('DELETE FROM transactions WHERE is_demo = 1').run();
    db.prepare('DELETE FROM expenses WHERE is_demo = 1').run();
    db.prepare('DELETE FROM customers WHERE is_demo = 1').run();
    db.prepare('DELETE FROM services WHERE is_demo = 1').run();
    db.prepare('DELETE FROM inventory_items WHERE is_demo = 1').run();
    db.prepare('DELETE FROM categories WHERE is_demo = 1').run();
  });
  tx();
}

export function writeAuditLog(
  actorId: string,
  actorName: string,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
) {
  db.prepare(`
    INSERT INTO audit_logs (id, actor_id, actor_name, action, entity_type, entity_id, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `aud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    actorId,
    actorName,
    action,
    entityType,
    entityId,
    summary,
    new Date().toISOString(),
  );
}
