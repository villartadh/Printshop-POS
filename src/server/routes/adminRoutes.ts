import express from 'express';
import { clearDemoDataset, db, seedDemoDataset, writeAuditLog } from '../db.ts';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth.ts';
import { applyInventoryAdjustment } from './inventoryRoutes.ts';
import { applyTransactionCreation } from './posRoutes.ts';
import {
  acknowledgeAllCriticalAlertEvents,
  acknowledgeCriticalAlertEvent,
  evaluateAndDispatchCriticalAlerts,
  getCriticalAlertConfig,
  isSmtpConfigured,
  listCriticalAlertEvents,
  saveCriticalAlertConfig,
} from '../criticalAlertService.ts';
import { parseJsonSafe } from '../mappers.ts';
import { DEFAULT_SETTINGS } from '../../shared/defaults.ts';
import {
  evaluateOffHoursScheduleWindow,
  validateCriticalAlertConfig,
} from '../../shared/criticalAlertSchedule.ts';
import type { StockMovement, StockMovementType, Transaction } from '../../shared/types.ts';

export const adminRouter = express.Router();

adminRouter.post('/sync/batch', requireAuth, (req: AuthenticatedRequest, res) => {
  const mutations = Array.isArray(req.body?.mutations) ? req.body.mutations : [];
  const results: Array<{ clientMutationId: string; status: string; error?: string }> = [];

  for (const mut of mutations) {
    try {
      if (mut.type === 'CREATE_TRANSACTION') {
        const out = applyTransactionCreation(
          mut.payload as Transaction,
          req.authUser!.id,
          req.authUser!.fullName,
        );
        results.push({
          clientMutationId: mut.clientMutationId,
          status: out.duplicate ? 'duplicate' : 'applied',
        });
      } else if (mut.type === 'ADJUST_INVENTORY') {
        const adj = mut.payload as {
          inventoryItemId: string;
          movementType?: StockMovementType;
          quantityDelta?: number;
          note?: string;
          reference?: string;
          referenceType?: StockMovement['referenceType'];
          occurredAt?: string;
        };
        applyInventoryAdjustment(
          adj.inventoryItemId,
          adj,
          req.authUser!.id,
          req.authUser!.fullName,
        );
        results.push({
          clientMutationId: mut.clientMutationId,
          status: 'applied',
        });
      } else {
        results.push({
          clientMutationId: mut.clientMutationId,
          status: 'applied',
        });
      }
    } catch (err) {
      results.push({
        clientMutationId: mut.clientMutationId,
        status: 'error',
        error: err instanceof Error ? err.message : 'Sync failed',
      });
    }
  }

  res.json({ results, syncedAt: new Date().toISOString() });
});

adminRouter.post(
  '/demo/seed',
  requireAuth,
  requireRole(['admin', 'manager']),
  (req: AuthenticatedRequest, res) => {
    seedDemoDataset();
    writeAuditLog(
      req.authUser!.id,
      req.authUser!.fullName,
      'DEMO_SEEDED',
      'system',
      'demo',
      'Loaded demonstration catalog and sample records',
    );
    res.json({ ok: true });
  },
);

adminRouter.post(
  '/demo/clear',
  requireAuth,
  requireRole(['admin', 'manager']),
  (req: AuthenticatedRequest, res) => {
    clearDemoDataset();
    writeAuditLog(
      req.authUser!.id,
      req.authUser!.fullName,
      'DEMO_CLEARED',
      'system',
      'demo',
      'Cleared isolated demonstration records',
    );
    res.json({ ok: true });
  },
);

adminRouter.get(
  '/backup/export',
  requireAuth,
  requireRole(['admin']),
  (req: AuthenticatedRequest, res) => {
    const settingsRow = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get('app_settings') as
      | { value_json: string }
      | undefined;
    const backup = {
      exportedAt: new Date().toISOString(),
      schemaVersion: '1.0.0',
      exportedBy: req.authUser!.username,
      settings: settingsRow ? parseJsonSafe(settingsRow.value_json, DEFAULT_SETTINGS) : DEFAULT_SETTINGS,
      categories: db.prepare('SELECT * FROM categories').all(),
      services: db.prepare('SELECT * FROM services').all(),
      suppliers: db.prepare('SELECT * FROM suppliers').all(),
      inventory_items: db.prepare('SELECT * FROM inventory_items').all(),
      customers: db.prepare('SELECT * FROM customers').all(),
      transactions: db.prepare('SELECT * FROM transactions').all(),
      print_jobs: db.prepare('SELECT * FROM print_jobs').all(),
      expenses: db.prepare('SELECT * FROM expenses').all(),
    };
    writeAuditLog(
      req.authUser!.id,
      req.authUser!.fullName,
      'BACKUP_EXPORTED',
      'system',
      'backup',
      'Exported business configuration and ledger backup',
    );
    res.json(backup);
  },
);

adminRouter.get('/alerts/critical-config', requireAuth, (_req, res) => {
  const config = getCriticalAlertConfig();
  res.json({
    config,
    smtpConfigured: isSmtpConfigured(),
    scheduleStatus: evaluateOffHoursScheduleWindow(config),
    serverTime: new Date().toISOString(),
  });
});

adminRouter.put(
  '/alerts/critical-config',
  requireAuth,
  requireRole(['admin', 'manager']),
  (req: AuthenticatedRequest, res) => {
    const incoming = req.body || {};
    const validation = validateCriticalAlertConfig(incoming);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    const saved = saveCriticalAlertConfig(incoming);
    writeAuditLog(
      req.authUser!.id,
      req.authUser!.fullName,
      'CRITICAL_ALERT_CONFIG_UPDATED',
      'critical_alert_rules',
      'default',
      `Updated off-hours/weekend alert schedule (${saved.enabled ? 'enabled' : 'paused'}, channel: ${saved.channel})`,
    );
    return res.json({
      config: saved,
      smtpConfigured: isSmtpConfigured(),
      scheduleStatus: evaluateOffHoursScheduleWindow(saved),
      serverTime: new Date().toISOString(),
    });
  },
);

adminRouter.get('/alerts/critical-events', requireAuth, (req, res) => {
  const limit = Number(req.query.limit) || 100;
  const events = listCriticalAlertEvents(limit);
  const config = getCriticalAlertConfig();
  res.json({
    events,
    activeCount: events.filter((e) => e.systemAlertStatus === 'active').length,
    scheduleStatus: evaluateOffHoursScheduleWindow(config),
    smtpConfigured: isSmtpConfigured(),
    serverTime: new Date().toISOString(),
  });
});

adminRouter.post(
  '/alerts/critical-events/test',
  requireAuth,
  requireRole(['admin', 'manager']),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const simulateOffHours = req.body?.simulateOffHours !== false;
      const result = await evaluateAndDispatchCriticalAlerts({
        forceManualTest: simulateOffHours,
        actorId: req.authUser!.id,
        actorName: req.authUser!.fullName,
      });
      const events = listCriticalAlertEvents(100);
      res.json({
        triggeredEvents: result.triggeredEvents,
        skippedReason: result.skippedReason,
        scheduleStatus: result.scheduleStatus,
        events,
        smtpConfigured: isSmtpConfigured(),
      });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/alerts/critical-events/acknowledge-all',
  requireAuth,
  (req: AuthenticatedRequest, res) => {
    const count = acknowledgeAllCriticalAlertEvents(req.authUser!.fullName);
    const events = listCriticalAlertEvents(100);
    res.json({ ok: true, acknowledgedCount: count, events });
  },
);

adminRouter.post(
  '/alerts/critical-events/:id/acknowledge',
  requireAuth,
  (req: AuthenticatedRequest, res) => {
    const updated = acknowledgeCriticalAlertEvent(
      String(req.params.id),
      req.authUser!.fullName,
    );
    if (!updated) {
      return res.status(404).json({ error: 'Critical alert event not found.' });
    }
    return res.json({ event: updated });
  },
);
