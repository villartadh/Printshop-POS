import express from 'express';
import { db, writeAuditLog } from '../db.ts';
import { requireAuth, requireRole, sanitizeUser, type AuthenticatedRequest } from '../auth.ts';
import {
  genId,
  mapInventoryItemRow,
  mapPrintJobRow,
  mapServiceRow,
  mapStockMovementRow,
  mapSupplierDocumentRow,
  mapSupplierRow,
  mapTransactionRow,
  parseJsonSafe,
} from '../mappers.ts';
import { DEFAULT_SETTINGS } from '../../shared/defaults.ts';
import {
  getCriticalAlertConfig,
  isSmtpConfigured,
  listCriticalAlertEvents,
} from '../criticalAlertService.ts';
import type {
  AppSettings,
  Customer,
  ExpenseRecord,
  PrintService,
  ServiceCategory,
  SupplyCategory,
} from '../../shared/types.ts';

export const catalogRouter = express.Router();

catalogRouter.get('/bootstrap', requireAuth, (_req, res) => {
  const settingsRow = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get('app_settings') as
    | { value_json: string }
    | undefined;
  const settings: AppSettings = settingsRow
    ? parseJsonSafe(settingsRow.value_json, DEFAULT_SETTINGS)
    : DEFAULT_SETTINGS;

  const categories = (
    db.prepare('SELECT * FROM categories ORDER BY sort_order ASC, name ASC').all() as Array<
      Record<string, unknown>
    >
  ).map((c) => ({
    id: String(c.id),
    name: String(c.name),
    sortOrder: Number(c.sort_order) || 0,
    isDemo: c.is_demo === 1,
  }));

  const services = (
    db.prepare('SELECT * FROM services ORDER BY is_favorite DESC, name ASC').all() as Array<
      Record<string, unknown>
    >
  ).map(mapServiceRow);

  const supplyCategories: SupplyCategory[] = (
    db.prepare('SELECT * FROM supply_categories ORDER BY sort_order ASC, name ASC').all() as Array<
      Record<string, unknown>
    >
  ).map((sc) => ({
    id: String(sc.id),
    name: String(sc.name),
    description: String(sc.description || ''),
    defaultUnit: String(sc.default_unit || 'pc'),
    sortOrder: Number(sc.sort_order) || 0,
    isDemo: sc.is_demo === 1,
  }));

  const inventory = (
    db.prepare('SELECT * FROM inventory_items ORDER BY name ASC').all() as Array<
      Record<string, unknown>
    >
  ).map(mapInventoryItemRow);

  const suppliers = (
    db.prepare('SELECT * FROM suppliers ORDER BY name ASC').all() as Array<Record<string, unknown>>
  ).map(mapSupplierRow);

  const stockMovements = (
    db.prepare('SELECT * FROM stock_movements ORDER BY created_at DESC LIMIT 200').all() as Array<
      Record<string, unknown>
    >
  ).map(mapStockMovementRow);

  const customers = (
    db.prepare('SELECT * FROM customers ORDER BY name ASC').all() as Array<Record<string, unknown>>
  ).map((c) => ({
    id: String(c.id),
    name: String(c.name),
    phone: String(c.phone || ''),
    email: String(c.email || ''),
    address: String(c.address || ''),
    group: c.customer_group as Customer['group'],
    discountPercent: Number(c.discount_percent) || 0,
    loyaltyPoints: Number(c.loyalty_points) || 0,
    outstandingBalance: Number(c.outstanding_balance) || 0,
    totalSpent: Number(c.total_spent) || 0,
    notes: String(c.notes || ''),
    isDemo: c.is_demo === 1,
    createdAt: String(c.created_at),
  }));

  const transactions = (
    db.prepare('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 300').all() as Array<
      Record<string, unknown>
    >
  ).map(mapTransactionRow);

  const printJobs = (
    db.prepare('SELECT * FROM print_jobs ORDER BY created_at DESC LIMIT 200').all() as Array<
      Record<string, unknown>
    >
  ).map(mapPrintJobRow);

  const expenses = (
    db.prepare('SELECT * FROM expenses ORDER BY expense_date DESC, created_at DESC LIMIT 200').all() as Array<
      Record<string, unknown>
    >
  ).map((e) => ({
    id: String(e.id),
    category: e.category as ExpenseRecord['category'],
    description: String(e.description),
    amount: Number(e.amount) || 0,
    vendor: String(e.vendor || ''),
    recordedBy: String(e.recorded_by),
    expenseDate: String(e.expense_date),
    isDemo: e.is_demo === 1,
    createdAt: String(e.created_at),
  }));

  const shifts = (
    db.prepare('SELECT * FROM cashier_shifts ORDER BY started_at DESC LIMIT 50').all() as Array<
      Record<string, unknown>
    >
  ).map((s) => ({
    id: String(s.id),
    cashierId: String(s.cashier_id),
    cashierName: String(s.cashier_name),
    status: s.status as 'open' | 'closed',
    openingCash: Number(s.opening_cash) || 0,
    cashSales: Number(s.cash_sales) || 0,
    electronicSales: Number(s.electronic_sales) || 0,
    refundsTotal: Number(s.refunds_total) || 0,
    cashMovements: parseJsonSafe(s.cash_movements_json as string, []),
    expectedCash: Number(s.expected_cash) || 0,
    actualCash: s.actual_cash !== null ? Number(s.actual_cash) : null,
    discrepancy: s.discrepancy !== null ? Number(s.discrepancy) : null,
    reconciliationNote: String(s.reconciliation_note || ''),
    startedAt: String(s.started_at),
    endedAt: s.ended_at ? String(s.ended_at) : null,
  }));

  const users = (
    db.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as Array<never>
  ).map(sanitizeUser);

  const auditLogs = (
    db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100').all() as Array<
      Record<string, unknown>
    >
  ).map((a) => ({
    id: String(a.id),
    actorId: String(a.actor_id),
    actorName: String(a.actor_name),
    action: String(a.action),
    entityType: String(a.entity_type),
    entityId: String(a.entity_id),
    summary: String(a.summary),
    createdAt: String(a.created_at),
  }));

  const criticalAlertConfig = getCriticalAlertConfig();
  const criticalAlertEvents = listCriticalAlertEvents(100);
  const criticalAlertSmtpConfigured = isSmtpConfigured();
  const supplierDocuments = (
    db.prepare('SELECT * FROM supplier_documents ORDER BY created_at DESC').all() as Array<
      Record<string, unknown>
    >
  ).map(mapSupplierDocumentRow);

  res.json({
    settings,
    categories,
    supplyCategories,
    services,
    inventory,
    suppliers,
    supplierDocuments,
    stockMovements,
    customers,
    transactions,
    printJobs,
    expenses,
    shifts,
    users,
    auditLogs,
    criticalAlertConfig,
    criticalAlertEvents,
    criticalAlertSmtpConfigured,
    serverTime: new Date().toISOString(),
  });
});

catalogRouter.put(
  '/settings',
  requireAuth,
  requireRole(['admin', 'manager']),
  (req: AuthenticatedRequest, res) => {
    const incoming = req.body as AppSettings;
    if (!incoming || !incoming.branding || !incoming.tokens) {
      return res.status(400).json({ error: 'Invalid settings payload.' });
    }
    const updated: AppSettings = {
      ...incoming,
      updatedAt: new Date().toISOString(),
    };
    db.prepare(
      'INSERT OR REPLACE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)',
    ).run('app_settings', JSON.stringify(updated), updated.updatedAt);

    writeAuditLog(
      req.authUser!.id,
      req.authUser!.fullName,
      'SETTINGS_UPDATED',
      'app_settings',
      'app_settings',
      'Updated business branding, layout, and system settings',
    );
    res.json(updated);
  },
);

catalogRouter.post(
  '/categories',
  requireAuth,
  requireRole(['admin', 'manager']),
  (req: AuthenticatedRequest, res) => {
    const { name, sortOrder } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Category name is required.' });
    }
    const cat: ServiceCategory = {
      id: genId('cat'),
      name: String(name).trim(),
      sortOrder: Number(sortOrder) || 10,
      isDemo: false,
    };
    db.prepare('INSERT INTO categories (id, name, sort_order, is_demo) VALUES (?, ?, ?, 0)').run(
      cat.id,
      cat.name,
      cat.sortOrder,
    );
    res.status(201).json(cat);
  },
);

catalogRouter.delete(
  '/categories/:id',
  requireAuth,
  requireRole(['admin', 'manager']),
  (req: AuthenticatedRequest, res) => {
    db.prepare('DELETE FROM categories WHERE id = ?').run(String(req.params.id));
    res.json({ ok: true });
  },
);

catalogRouter.post(
  '/services',
  requireAuth,
  requireRole(['admin', 'manager']),
  (req: AuthenticatedRequest, res) => {
    const s = req.body as Partial<PrintService>;
    if (!s.name || !s.categoryId || !s.pricingMethod) {
      return res.status(400).json({ error: 'Service name, category, and pricing method are required.' });
    }
    const id = s.id || genId('srv');
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO services (
        id, sku, name, category_id, description, icon_name, pricing_method, base_price, unit_label,
        cost_estimate, requires_configuration, requires_production_job, allow_custom_dimensions,
        allow_pages_and_copies, allow_rush_fee, rush_fee_percent, default_design_fee,
        bulk_tiers_json, formula_expression, attribute_groups_json, consumables_json,
        is_favorite, is_archived, is_demo, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      id,
      s.sku || `SRV-${Date.now().toString().slice(-4)}`,
      String(s.name).trim(),
      s.categoryId,
      s.description || '',
      s.iconName || 'Printer',
      s.pricingMethod,
      Number(s.basePrice) || 0,
      s.unitLabel || 'pc',
      Number(s.costEstimate) || 0,
      s.requiresConfiguration ? 1 : 0,
      s.requiresProductionJob ? 1 : 0,
      s.allowCustomDimensions ? 1 : 0,
      s.allowPagesAndCopies ? 1 : 0,
      s.allowRushFee ? 1 : 0,
      Number(s.rushFeePercent) || 25,
      Number(s.defaultDesignFee) || 0,
      JSON.stringify(s.bulkTiers || []),
      s.formulaExpression || '',
      JSON.stringify(s.attributeGroups || []),
      JSON.stringify(s.consumables || []),
      s.isFavorite ? 1 : 0,
      s.isArchived ? 1 : 0,
      now,
    );
    writeAuditLog(
      req.authUser!.id,
      req.authUser!.fullName,
      'SERVICE_CREATED',
      'service',
      id,
      `Created printing service ${s.name}`,
    );
    const created = db.prepare('SELECT * FROM services WHERE id = ?').get(id) as Record<string, unknown>;
    res.status(201).json(mapServiceRow(created));
  },
);

catalogRouter.put(
  '/services/:id',
  requireAuth,
  requireRole(['admin', 'manager']),
  (req: AuthenticatedRequest, res) => {
    const id = String(req.params.id);
    const s = req.body as Partial<PrintService>;
    const existing = db.prepare('SELECT id FROM services WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Service not found.' });

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE services SET
        sku = ?, name = ?, category_id = ?, description = ?, icon_name = ?, pricing_method = ?,
        base_price = ?, unit_label = ?, cost_estimate = ?, requires_configuration = ?,
        requires_production_job = ?, allow_custom_dimensions = ?, allow_pages_and_copies = ?,
        allow_rush_fee = ?, rush_fee_percent = ?, default_design_fee = ?, bulk_tiers_json = ?,
        formula_expression = ?, attribute_groups_json = ?, consumables_json = ?, is_favorite = ?,
        is_archived = ?, updated_at = ?
      WHERE id = ?
    `).run(
      s.sku || 'SRV',
      String(s.name || '').trim(),
      s.categoryId || 'cat-print',
      s.description || '',
      s.iconName || 'Printer',
      s.pricingMethod || 'fixed',
      Number(s.basePrice) || 0,
      s.unitLabel || 'pc',
      Number(s.costEstimate) || 0,
      s.requiresConfiguration ? 1 : 0,
      s.requiresProductionJob ? 1 : 0,
      s.allowCustomDimensions ? 1 : 0,
      s.allowPagesAndCopies ? 1 : 0,
      s.allowRushFee ? 1 : 0,
      Number(s.rushFeePercent) || 25,
      Number(s.defaultDesignFee) || 0,
      JSON.stringify(s.bulkTiers || []),
      s.formulaExpression || '',
      JSON.stringify(s.attributeGroups || []),
      JSON.stringify(s.consumables || []),
      s.isFavorite ? 1 : 0,
      s.isArchived ? 1 : 0,
      now,
      id,
    );
    const updated = db.prepare('SELECT * FROM services WHERE id = ?').get(id) as Record<string, unknown>;
    res.json(mapServiceRow(updated));
  },
);

catalogRouter.delete(
  '/services/:id',
  requireAuth,
  requireRole(['admin', 'manager']),
  (req: AuthenticatedRequest, res) => {
    const id = String(req.params.id);
    db.prepare('DELETE FROM services WHERE id = ?').run(id);
    writeAuditLog(
      req.authUser!.id,
      req.authUser!.fullName,
      'SERVICE_DELETED',
      'service',
      id,
      `Deleted service ${id}`,
    );
    res.json({ ok: true });
  },
);
