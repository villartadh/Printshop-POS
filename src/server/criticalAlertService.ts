import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { db, writeAuditLog } from './db.ts';
import {
  DEFAULT_CRITICAL_ALERT_CONFIG,
  evaluateOffHoursScheduleWindow,
  getCriticalThresholdValue,
  isItemInCriticalAlertState,
  normalizeCriticalAlertConfig,
} from '../shared/criticalAlertSchedule.ts';
import type {
  CriticalAlertEmailStatus,
  CriticalAlertEvent,
  CriticalAlertScheduleConfig,
  CriticalAlertScheduleStatus,
  CriticalAlertTriggerReason,
  InventoryItem,
} from '../shared/types.ts';

function genEventId(): string {
  return `calert_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function escapeHtml(raw: string): string {
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseJsonSafe<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_HOST.trim().length > 0);
}

export function getCriticalAlertConfig(): CriticalAlertScheduleConfig {
  const row = db
    .prepare('SELECT config_json FROM critical_alert_rules WHERE id = ?')
    .get('default') as { config_json: string } | undefined;
  if (!row) {
    return { ...DEFAULT_CRITICAL_ALERT_CONFIG, updatedAt: new Date().toISOString() };
  }
  const parsed = parseJsonSafe<Partial<CriticalAlertScheduleConfig>>(row.config_json, {});
  return normalizeCriticalAlertConfig(parsed);
}

export function saveCriticalAlertConfig(
  incoming: Partial<CriticalAlertScheduleConfig>,
): CriticalAlertScheduleConfig {
  const normalized = normalizeCriticalAlertConfig({
    ...incoming,
    updatedAt: new Date().toISOString(),
  });
  db.prepare(
    'INSERT OR REPLACE INTO critical_alert_rules (id, config_json, updated_at) VALUES (?, ?, ?)',
  ).run('default', JSON.stringify(normalized), normalized.updatedAt);
  return normalized;
}

function mapCriticalAlertEventRow(row: Record<string, unknown>): CriticalAlertEvent {
  return {
    id: String(row.id),
    inventoryItemId: String(row.inventory_item_id),
    itemName: String(row.item_name),
    sku: String(row.sku),
    unit: String(row.unit),
    quantityOnHand: Number(row.quantity_on_hand) || 0,
    criticalThreshold: Number(row.critical_threshold) || 0,
    channel: (String(row.channel || 'system') as CriticalAlertEvent['channel']),
    triggerReason: (String(row.trigger_reason || 'off_hours') as CriticalAlertTriggerReason),
    windowLabel: String(row.window_label || ''),
    recipients: parseJsonSafe<string[]>(row.recipients_json, []),
    emailStatus: (String(row.email_status || 'not_applicable') as CriticalAlertEmailStatus),
    emailStatusDetail: String(row.email_status_detail || ''),
    systemAlertStatus:
      row.system_alert_status === 'acknowledged' ? 'acknowledged' : 'active',
    acknowledgedBy: row.acknowledged_by ? String(row.acknowledged_by) : undefined,
    acknowledgedAt: row.acknowledged_at ? String(row.acknowledged_at) : undefined,
    triggeredAt: String(row.triggered_at),
  };
}

export function listCriticalAlertEvents(limit = 100): CriticalAlertEvent[] {
  const safeLimit = Math.min(250, Math.max(1, Math.round(limit)));
  const rows = db
    .prepare('SELECT * FROM critical_alert_events ORDER BY triggered_at DESC LIMIT ?')
    .all(safeLimit) as Array<Record<string, unknown>>;
  return rows.map(mapCriticalAlertEventRow);
}

export function acknowledgeCriticalAlertEvent(
  eventId: string,
  actorName: string,
): CriticalAlertEvent | null {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE critical_alert_events
       SET system_alert_status = 'acknowledged', acknowledged_by = ?, acknowledged_at = ?
       WHERE id = ?`,
    )
    .run(actorName, now, eventId);
  if (result.changes === 0) return null;
  const row = db
    .prepare('SELECT * FROM critical_alert_events WHERE id = ?')
    .get(eventId) as Record<string, unknown> | undefined;
  return row ? mapCriticalAlertEventRow(row) : null;
}

export function acknowledgeAllCriticalAlertEvents(actorName: string): number {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE critical_alert_events
       SET system_alert_status = 'acknowledged', acknowledged_by = ?, acknowledged_at = ?
       WHERE system_alert_status = 'active'`,
    )
    .run(actorName, now);
  return result.changes;
}

function loadInventoryForAlerts(targetItemIds?: string[]): InventoryItem[] {
  const rows = db
    .prepare('SELECT * FROM inventory_items ORDER BY name ASC')
    .all() as Array<Record<string, unknown>>;

  const mapped: InventoryItem[] = rows.map((i) => ({
    id: String(i.id),
    sku: String(i.sku),
    barcode: String(i.barcode || ''),
    name: String(i.name),
    categoryId: i.category_id ? String(i.category_id) : undefined,
    category: String(i.category),
    itemType: i.item_type as InventoryItem['itemType'],
    unit: String(i.unit),
    quantityOnHand: Number(i.quantity_on_hand) || 0,
    currentStock: Number(i.quantity_on_hand) || 0,
    reservedQuantity: Number(i.reserved_quantity) || 0,
    reorderLevel: Number(i.reorder_level) || 0,
    minimumThreshold: Number(i.minimum_threshold) || 0,
    reorderQuantity: Number(i.reorder_quantity) || 0,
    unitCost: Number(i.unit_cost) || 0,
    supplier: String(i.supplier || ''),
    supplierContact: String(i.supplier_contact || ''),
    supplierSku: String(i.supplier_sku || ''),
    leadTimeDays: Number(i.lead_time_days) || 0,
    storageLocation: String(i.storage_location || ''),
    lastRestockedAt: i.last_restocked_at ? String(i.last_restocked_at) : null,
    isDemo: i.is_demo === 1,
    createdAt: String(i.created_at || i.updated_at),
    updatedAt: String(i.updated_at),
  }));

  if (!targetItemIds || targetItemIds.length === 0) return mapped;
  const targetSet = new Set(targetItemIds);
  return mapped.filter((item) => targetSet.has(item.id));
}

async function sendCriticalDigestEmail(
  recipients: string[],
  items: Array<{
    item: InventoryItem;
    criticalThreshold: number;
  }>,
  windowLabel: string,
  triggerReason: CriticalAlertTriggerReason,
  storeName: string,
): Promise<{ status: CriticalAlertEmailStatus; detail: string }> {
  if (!isSmtpConfigured()) {
    return {
      status: 'logged_preview',
      detail: `Email digest prepared for ${recipients.join(', ')} (configure SMTP_HOST in server environment to enable live external email delivery).`,
    };
  }

  const host = String(process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT) || 587;
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '');
  const fromAddress = String(process.env.SMTP_FROM || user || 'alerts@printshop-pos.local').trim();

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass } : undefined,
      connectionTimeout: 8000,
      greetingTimeout: 8000,
    });

    const subjectPrefix = triggerReason === 'manual_test' ? '[TEST ALERT]' : '[CRITICAL STOCK]';
    const subject = `${subjectPrefix} ${items.length} item${items.length === 1 ? '' : 's'} below critical threshold · ${storeName}`;

    const plainLines = [
      `${storeName} — Automated Off-Hours & Weekend Inventory Alert`,
      `Window: ${windowLabel}`,
      `Triggered at: ${new Date().toISOString()}`,
      '',
      ...items.map(
        ({ item, criticalThreshold }) =>
          `- ${item.name} (${item.sku}): ${item.quantityOnHand} ${item.unit} on hand (critical threshold: ${criticalThreshold} ${item.unit})`,
      ),
    ];

    const htmlRows = items
      .map(
        ({ item, criticalThreshold }) => `
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-weight:600;">${escapeHtml(item.name)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-family:monospace;">${escapeHtml(item.sku)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;color:#dc2626;font-weight:700;text-align:right;">${escapeHtml(String(item.quantityOnHand))} ${escapeHtml(item.unit)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${escapeHtml(String(criticalThreshold))} ${escapeHtml(item.unit)}</td>
        </tr>`,
      )
      .join('');

    const htmlBody = `
      <div style="font-family:system-ui,-apple-system,sans-serif;color:#0f172a;max-width:640px;">
        <h2 style="margin:0 0 8px;color:#dc2626;">Critical Inventory Alert</h2>
        <p style="margin:0 0 12px;font-size:13px;color:#475569;">
          <strong>${escapeHtml(storeName)}</strong> · ${escapeHtml(windowLabel)}
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e2e8f0;">
          <thead>
            <tr style="background:#f8fafc;text-align:left;">
              <th style="padding:8px 10px;border-bottom:1px solid #e2e8f0;">Item</th>
              <th style="padding:8px 10px;border-bottom:1px solid #e2e8f0;">SKU</th>
              <th style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">On Hand</th>
              <th style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">Critical Threshold</th>
            </tr>
          </thead>
          <tbody>${htmlRows}</tbody>
        </table>
      </div>`;

    await transporter.sendMail({
      from: fromAddress,
      to: recipients.join(', '),
      subject,
      text: plainLines.join('\n'),
      html: htmlBody,
    });

    return {
      status: 'sent',
      detail: `Email sent via SMTP to ${recipients.join(', ')}`,
    };
  } catch (err) {
    return {
      status: 'failed',
      detail: err instanceof Error ? err.message : 'SMTP delivery failed.',
    };
  }
}

export async function evaluateAndDispatchCriticalAlerts(options?: {
  targetItemIds?: string[];
  forceManualTest?: boolean;
  actorId?: string;
  actorName?: string;
}): Promise<{
  triggeredEvents: CriticalAlertEvent[];
  scheduleStatus: CriticalAlertScheduleStatus;
  skippedReason?: string;
}> {
  const config = getCriticalAlertConfig();
  const now = new Date();
  const scheduleStatus = evaluateOffHoursScheduleWindow(config, now);
  const forceManualTest = Boolean(options?.forceManualTest);

  if (!forceManualTest && !config.enabled) {
    return {
      triggeredEvents: [],
      scheduleStatus,
      skippedReason: 'Off-hours & weekend monitoring is currently paused.',
    };
  }

  if (!forceManualTest && !scheduleStatus.isOffHoursOrWeekend) {
    return {
      triggeredEvents: [],
      scheduleStatus,
      skippedReason: `Currently inside regular operating hours (${scheduleStatus.windowLabel}).`,
    };
  }

  const candidates = loadInventoryForAlerts(options?.targetItemIds).filter((item) =>
    isItemInCriticalAlertState(item, config.triggerMode),
  );

  if (candidates.length === 0) {
    return {
      triggeredEvents: [],
      scheduleStatus,
      skippedReason: 'No inventory items are currently below their critical threshold.',
    };
  }

  const cooldownCutoffMs = now.getTime() - config.cooldownMinutes * 60 * 1000;
  const recentCheckStmt = db.prepare(`
    SELECT quantity_on_hand, triggered_at
    FROM critical_alert_events
    WHERE inventory_item_id = ?
      AND trigger_reason != 'manual_test'
    ORDER BY triggered_at DESC
    LIMIT 1
  `);

  const itemsToAlert: Array<{ item: InventoryItem; criticalThreshold: number }> = [];
  for (const item of candidates) {
    const threshold = getCriticalThresholdValue(item);
    if (!forceManualTest) {
      const lastEvent = recentCheckStmt.get(item.id) as
        | { quantity_on_hand: number; triggered_at: string }
        | undefined;
      if (lastEvent) {
        const lastMs = Date.parse(lastEvent.triggered_at) || 0;
        const stockDroppedFurther = item.quantityOnHand < Number(lastEvent.quantity_on_hand);
        if (lastMs >= cooldownCutoffMs && !stockDroppedFurther) {
          continue;
        }
      }
    }
    itemsToAlert.push({ item, criticalThreshold: threshold });
  }

  if (itemsToAlert.length === 0) {
    return {
      triggeredEvents: [],
      scheduleStatus,
      skippedReason: `All critical items were already alerted within the ${config.cooldownMinutes}-minute cooldown window.`,
    };
  }

  const settingsRow = db
    .prepare('SELECT value_json FROM app_settings WHERE key = ?')
    .get('app_settings') as { value_json: string } | undefined;
  const parsedSettings = parseJsonSafe<{ branding?: { businessName?: string } }>(
    settingsRow?.value_json,
    {},
  );
  const storeName = parsedSettings.branding?.businessName || 'Printshop POS';

  const triggerReason: CriticalAlertTriggerReason = forceManualTest
    ? 'manual_test'
    : scheduleStatus.triggerReason || 'off_hours';
  const windowLabel = forceManualTest
    ? `Simulated Off-Hours Check (${scheduleStatus.localTimeSummary})`
    : scheduleStatus.windowLabel;

  const shouldEmail =
    (config.channel === 'email' || config.channel === 'both') &&
    config.recipientEmails.length > 0;

  const emailResult = shouldEmail
    ? await sendCriticalDigestEmail(
        config.recipientEmails,
        itemsToAlert,
        windowLabel,
        triggerReason,
        storeName,
      )
    : {
        status: 'not_applicable' as CriticalAlertEmailStatus,
        detail:
          config.channel === 'system'
            ? 'System alert only channel selected'
            : 'No recipient emails configured',
      };

  const triggeredAt = now.toISOString();
  const insertStmt = db.prepare(`
    INSERT INTO critical_alert_events (
      id, inventory_item_id, item_name, sku, unit, quantity_on_hand, critical_threshold,
      channel, trigger_reason, window_label, recipients_json, email_status,
      email_status_detail, system_alert_status, acknowledged_by, acknowledged_at, triggered_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?)
  `);

  const createdEvents: CriticalAlertEvent[] = [];
  const systemStatus =
    config.channel === 'email' ? 'acknowledged' : 'active';

  const insertTx = db.transaction(() => {
    for (const { item, criticalThreshold } of itemsToAlert) {
      const id = genEventId();
      const recipientsJson = JSON.stringify(shouldEmail ? config.recipientEmails : []);
      insertStmt.run(
        id,
        item.id,
        item.name,
        item.sku,
        item.unit,
        item.quantityOnHand,
        criticalThreshold,
        config.channel,
        triggerReason,
        windowLabel,
        recipientsJson,
        emailResult.status,
        emailResult.detail,
        systemStatus,
        triggeredAt,
      );
      createdEvents.push({
        id,
        inventoryItemId: item.id,
        itemName: item.name,
        sku: item.sku,
        unit: item.unit,
        quantityOnHand: item.quantityOnHand,
        criticalThreshold,
        channel: config.channel,
        triggerReason,
        windowLabel,
        recipients: shouldEmail ? config.recipientEmails : [],
        emailStatus: emailResult.status,
        emailStatusDetail: emailResult.detail,
        systemAlertStatus: systemStatus,
        triggeredAt,
      });
    }
  });
  insertTx();

  writeAuditLog(
    options?.actorId || 'system-monitor',
    options?.actorName || 'Off-Hours Alert Monitor',
    forceManualTest ? 'CRITICAL_ALERT_TEST' : 'CRITICAL_ALERT_TRIGGERED',
    'inventory',
    createdEvents.map((e) => e.sku).join(',').slice(0, 120),
    `Triggered ${createdEvents.length} off-hours/weekend critical stock alert(s) via ${config.channel} (${windowLabel})`,
  );

  return {
    triggeredEvents: createdEvents,
    scheduleStatus,
  };
}
