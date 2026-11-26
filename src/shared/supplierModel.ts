import type {
  InventoryItem,
  PredictiveReorderForecast,
  StockMovement,
  SupplierRecord,
} from '../types/inventory.ts';
import {
  extractSupplierInfo,
  isBelowMinimumThreshold,
  isLowStockItem,
} from './inventoryModel.ts';

export interface SupplierHistoricalOrderLine {
  movementId: string;
  inventoryItemId: string;
  itemName: string;
  sku: string;
  unit: string;
  quantity: number;
  unitCost: number;
  lineTotal: number;
  baselineUnitCost: number | null;
  costVarianceAmount: number | null;
  costVariancePct: number | null;
}

export interface SupplierHistoricalOrder {
  id: string;
  reference: string;
  occurredAt: string;
  orderedAt?: string;
  expectedDeliveryAt?: string;
  isOnTime: boolean | null;
  daysLate: number | null;
  actualDeliveryDays: number | null;
  costVariancePct: number | null;
  performedBy: string;
  note: string;
  totalUnits: number;
  totalAmount: number;
  lines: SupplierHistoricalOrderLine[];
}

export interface SupplierProfile {
  key: string;
  record: SupplierRecord | null;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  paymentTerms: string;
  notes: string;
  defaultLeadTimeDays: number;
  minLeadTimeDays: number;
  maxLeadTimeDays: number;
  effectiveLeadTimeDays: number;
  items: InventoryItem[];
  totalStockValue: number;
  lowStockCount: number;
  belowMinimumCount: number;
  historicalOrders: SupplierHistoricalOrder[];
  totalOrderCount: number;
  totalOrderSpend: number;
  lastOrderDate: string | null;
  onTimeDeliveryRate: number | null;
  trackedDeliveryCount: number;
  onTimeDeliveryCount: number;
  lateDeliveryCount: number;
  avgActualDeliveryDays: number | null;
  avgCostVariancePct: number | null;
  avgCostVarianceAmount: number | null;
  costVarianceLineCount: number;
  forecasts: PredictiveReorderForecast[];
  urgentForecastCount: number;
  recommendedOrderSpend: number;
  earliestStockoutDays: number | null;
  leadTimeRiskCount: number;
}

function normalizeSupplierKey(name: string): string {
  return name.trim().toLowerCase();
}

function looksLikePhone(val: string): boolean {
  return /\d{5,}/.test(val.replace(/[\s\-+()]/g, ''));
}

function looksLikeEmail(val: string): boolean {
  return val.includes('@') && val.includes('.');
}

const DAY_MS = 86400000;

function toUtcDayMs(iso?: string): number | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
}

export function normalizeSupplierRecord(
  raw: Partial<SupplierRecord> & { id: string; name: string },
): SupplierRecord {
  const now = new Date().toISOString();
  return {
    id: raw.id,
    name: raw.name.trim(),
    contactPerson: (raw.contactPerson || '').trim(),
    phone: (raw.phone || '').trim(),
    email: (raw.email || '').trim(),
    address: (raw.address || '').trim(),
    defaultLeadTimeDays: Math.max(0, Math.round(Number(raw.defaultLeadTimeDays) || 0)),
    paymentTerms: (raw.paymentTerms || '').trim(),
    notes: (raw.notes || '').trim(),
    isDemo: Boolean(raw.isDemo),
    createdAt: raw.createdAt || raw.updatedAt || now,
    updatedAt: raw.updatedAt || now,
  };
}

export function buildSupplierDirectory({
  suppliers,
  inventory,
  stockMovements,
  forecasts,
}: {
  suppliers: SupplierRecord[];
  inventory: InventoryItem[];
  stockMovements: StockMovement[];
  forecasts: PredictiveReorderForecast[];
}): SupplierProfile[] {
  const recordByKey = new Map<string, SupplierRecord>();
  const displayNameByKey = new Map<string, string>();

  for (const sup of suppliers) {
    const key = normalizeSupplierKey(sup.name);
    if (!key) continue;
    recordByKey.set(key, sup);
    displayNameByKey.set(key, sup.name.trim());
  }

  const itemsByKey = new Map<string, InventoryItem[]>();
  const itemLookup = new Map<string, InventoryItem>();

  for (const item of inventory) {
    itemLookup.set(item.id, item);
    const info = extractSupplierInfo(item);
    const name = info.name.trim();
    if (!name) continue;
    const key = normalizeSupplierKey(name);
    if (!displayNameByKey.has(key)) {
      displayNameByKey.set(key, name);
    }
    const list = itemsByKey.get(key) ?? [];
    list.push(item);
    itemsByKey.set(key, list);
  }

  const forecastsByKey = new Map<string, PredictiveReorderForecast[]>();
  for (const forecast of forecasts) {
    const item = itemLookup.get(forecast.inventoryItemId);
    const rawName = (item ? extractSupplierInfo(item).name : forecast.supplierName).trim();
    if (!rawName || rawName === 'Unassigned Supplier') continue;
    const key = normalizeSupplierKey(rawName);
    const list = forecastsByKey.get(key) ?? [];
    list.push(forecast);
    forecastsByKey.set(key, list);
  }

  // Chronologically compute prior unit cost baseline per inventory item
  const chronologicalMovements = [...stockMovements].sort((a, b) => {
    const aMs = Date.parse(a.occurredAt || a.createdAt || '') || 0;
    const bMs = Date.parse(b.occurredAt || b.createdAt || '') || 0;
    return aMs - bMs;
  });

  const lastBaselineCostByItem = new Map<string, number>();
  const varianceByMovementId = new Map<
    string,
    {
      baselineUnitCost: number | null;
      costVarianceAmount: number | null;
      costVariancePct: number | null;
    }
  >();

  for (const mov of chronologicalMovements) {
    const isCostBearing =
      mov.movementType === 'initial_stock' ||
      mov.movementType === 'purchase' ||
      mov.referenceType === 'purchase_order';
    if (!isCostBearing || (Number(mov.quantityDelta) || 0) <= 0) continue;

    const item = itemLookup.get(mov.inventoryItemId);
    const unitCost = Number(mov.unitCostAtMovement ?? item?.unitCost ?? 0);
    if (!Number.isFinite(unitCost) || unitCost <= 0) continue;

    const priorCost = lastBaselineCostByItem.get(mov.inventoryItemId);
    if (priorCost !== undefined && priorCost > 0) {
      const amount = Number((unitCost - priorCost).toFixed(4));
      const pct = Number((((unitCost - priorCost) / priorCost) * 100).toFixed(2));
      varianceByMovementId.set(mov.id, {
        baselineUnitCost: priorCost,
        costVarianceAmount: amount,
        costVariancePct: pct,
      });
    } else {
      varianceByMovementId.set(mov.id, {
        baselineUnitCost: null,
        costVarianceAmount: null,
        costVariancePct: null,
      });
    }
    lastBaselineCostByItem.set(mov.inventoryItemId, unitCost);
  }

  // Group purchase stock movements by supplier key + PO reference
  const ordersBySupplierKey = new Map<string, Map<string, SupplierHistoricalOrder>>();
  for (const mov of chronologicalMovements) {
    const isPurchase =
      mov.movementType === 'purchase' || mov.referenceType === 'purchase_order';
    if (!isPurchase || (Number(mov.quantityDelta) || 0) <= 0) continue;

    const item = itemLookup.get(mov.inventoryItemId);
    if (!item) continue;
    const supInfo = extractSupplierInfo(item);
    const supName = supInfo.name.trim();
    if (!supName) continue;
    const key = normalizeSupplierKey(supName);

    let supplierOrders = ordersBySupplierKey.get(key);
    if (!supplierOrders) {
      supplierOrders = new Map<string, SupplierHistoricalOrder>();
      ordersBySupplierKey.set(key, supplierOrders);
    }

    const refClean = (mov.reference || '').trim();
    const orderGroupKey = refClean ? `ref:${refClean.toLowerCase()}` : `mov:${mov.id}`;
    const qty = Math.max(0, Number(mov.quantityDelta) || 0);
    const unitCost = Math.max(
      0,
      Number(mov.unitCostAtMovement ?? item.unitCost) || 0,
    );
    const lineTotal = Number((qty * unitCost).toFixed(2));
    const occurredAt = mov.occurredAt || mov.createdAt;
    const variance = varianceByMovementId.get(mov.id);

    const line: SupplierHistoricalOrderLine = {
      movementId: mov.id,
      inventoryItemId: item.id,
      itemName: item.name || mov.itemName,
      sku: item.sku,
      unit: item.unit,
      quantity: qty,
      unitCost,
      lineTotal,
      baselineUnitCost: variance?.baselineUnitCost ?? null,
      costVarianceAmount: variance?.costVarianceAmount ?? null,
      costVariancePct: variance?.costVariancePct ?? null,
    };

    const existing = supplierOrders.get(orderGroupKey);
    if (existing) {
      existing.lines.push(line);
      existing.totalUnits = Number((existing.totalUnits + qty).toFixed(2));
      existing.totalAmount = Number((existing.totalAmount + lineTotal).toFixed(2));
      if (occurredAt > existing.occurredAt) {
        existing.occurredAt = occurredAt;
      }
      if (!existing.orderedAt && mov.orderedAt) {
        existing.orderedAt = mov.orderedAt;
      }
      if (!existing.expectedDeliveryAt && mov.expectedDeliveryAt) {
        existing.expectedDeliveryAt = mov.expectedDeliveryAt;
      }
      if (!existing.note && mov.note) {
        existing.note = mov.note;
      }
    } else {
      supplierOrders.set(orderGroupKey, {
        id: orderGroupKey,
        reference: refClean || `PO-${mov.id.slice(-6).toUpperCase()}`,
        occurredAt,
        orderedAt: mov.orderedAt,
        expectedDeliveryAt: mov.expectedDeliveryAt,
        isOnTime: null,
        daysLate: null,
        actualDeliveryDays: null,
        costVariancePct: null,
        performedBy: mov.performedBy || 'Staff',
        note: mov.note || '',
        totalUnits: qty,
        totalAmount: lineTotal,
        lines: [line],
      });
    }
  }

  const allKeys = Array.from(displayNameByKey.keys());

  const profiles: SupplierProfile[] = allKeys.map((key) => {
    const record = recordByKey.get(key) ?? null;
    const name = record?.name || displayNameByKey.get(key) || 'Unnamed Supplier';
    const items = [...(itemsByKey.get(key) ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    const itemContacts = items
      .map((i) => extractSupplierInfo(i).contact?.trim() || '')
      .filter(Boolean);
    const inferredPhone =
      record?.phone || itemContacts.find((c) => looksLikePhone(c)) || '';
    const inferredEmail =
      record?.email || itemContacts.find((c) => looksLikeEmail(c)) || '';
    const inferredContactPerson =
      record?.contactPerson ||
      itemContacts.find((c) => !looksLikePhone(c) && !looksLikeEmail(c)) ||
      '';

    const itemLeadTimes = items
      .map((i) => Math.max(0, Number(extractSupplierInfo(i).leadTimeDays) || 0))
      .filter((d) => d > 0);
    const defaultLeadTimeDays = record?.defaultLeadTimeDays ?? (itemLeadTimes[0] || 0);
    const allLeadTimes =
      defaultLeadTimeDays > 0
        ? [defaultLeadTimeDays, ...itemLeadTimes]
        : itemLeadTimes;
    const minLeadTimeDays = allLeadTimes.length > 0 ? Math.min(...allLeadTimes) : 0;
    const maxLeadTimeDays = allLeadTimes.length > 0 ? Math.max(...allLeadTimes) : 0;
    const effectiveLeadTimeDays =
      defaultLeadTimeDays > 0 ? defaultLeadTimeDays : maxLeadTimeDays || 3;

    const totalStockValue = Number(
      items
        .reduce(
          (sum, item) =>
            sum + Math.max(0, Number(item.quantityOnHand) || 0) * (Number(item.unitCost) || 0),
          0,
        )
        .toFixed(2),
    );
    const lowStockCount = items.filter((item) => isLowStockItem(item)).length;
    const belowMinimumCount = items.filter((item) => isBelowMinimumThreshold(item)).length;

    const historicalOrders = Array.from(
      ordersBySupplierKey.get(key)?.values() ?? [],
    )
      .map((order) => {
        const receivedDayMs = toUtcDayMs(order.occurredAt);
        const expectedDayMs = toUtcDayMs(order.expectedDeliveryAt);
        const orderedDayMs = toUtcDayMs(order.orderedAt);

        const daysLate =
          receivedDayMs !== null && expectedDayMs !== null
            ? Math.round((receivedDayMs - expectedDayMs) / DAY_MS)
            : null;
        const isOnTime = daysLate !== null ? daysLate <= 0 : null;
        const actualDeliveryDays =
          receivedDayMs !== null && orderedDayMs !== null
            ? Math.max(0, Math.round((receivedDayMs - orderedDayMs) / DAY_MS))
            : null;

        const varianceLines = order.lines.filter(
          (l): l is SupplierHistoricalOrderLine & { costVariancePct: number } =>
            l.costVariancePct !== null,
        );
        const orderCostVariancePct =
          varianceLines.length > 0
            ? Number(
                (
                  varianceLines.reduce((sum, l) => sum + l.costVariancePct, 0) /
                  varianceLines.length
                ).toFixed(2),
              )
            : null;

        return {
          ...order,
          isOnTime,
          daysLate,
          actualDeliveryDays,
          costVariancePct: orderCostVariancePct,
        };
      })
      .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

    const trackedOrders = historicalOrders.filter((o) => o.isOnTime !== null);
    const onTimeDeliveryCount = trackedOrders.filter((o) => o.isOnTime === true).length;
    const lateDeliveryCount = trackedOrders.filter((o) => o.isOnTime === false).length;
    const trackedDeliveryCount = trackedOrders.length;
    const onTimeDeliveryRate =
      trackedDeliveryCount > 0
        ? Number(((onTimeDeliveryCount / trackedDeliveryCount) * 100).toFixed(1))
        : null;

    const deliveryDaySamples = historicalOrders
      .map((o) => o.actualDeliveryDays)
      .filter((d): d is number => d !== null);
    const avgActualDeliveryDays =
      deliveryDaySamples.length > 0
        ? Number(
            (
              deliveryDaySamples.reduce((sum, d) => sum + d, 0) /
              deliveryDaySamples.length
            ).toFixed(1),
          )
        : null;

    const allVarianceLines = historicalOrders
      .flatMap((o) => o.lines)
      .filter(
        (
          l,
        ): l is SupplierHistoricalOrderLine & {
          costVariancePct: number;
          costVarianceAmount: number;
        } => l.costVariancePct !== null && l.costVarianceAmount !== null,
      );
    const costVarianceLineCount = allVarianceLines.length;
    const avgCostVariancePct =
      costVarianceLineCount > 0
        ? Number(
            (
              allVarianceLines.reduce((sum, l) => sum + l.costVariancePct, 0) /
              costVarianceLineCount
            ).toFixed(1),
          )
        : null;
    const avgCostVarianceAmount =
      costVarianceLineCount > 0
        ? Number(
            (
              allVarianceLines.reduce((sum, l) => sum + l.costVarianceAmount, 0) /
              costVarianceLineCount
            ).toFixed(2),
          )
        : null;

    const totalOrderSpend = Number(
      historicalOrders.reduce((sum, o) => sum + o.totalAmount, 0).toFixed(2),
    );
    const lastOrderDate =
      historicalOrders.length > 0 ? historicalOrders[0].occurredAt : null;

    const supplierForecasts = [...(forecastsByKey.get(key) ?? [])].sort(
      (a, b) => b.urgencyScore - a.urgencyScore,
    );
    const urgentForecasts = supplierForecasts.filter((f) => f.isNearingThreshold);
    const recommendedOrderSpend = Number(
      urgentForecasts.reduce((sum, f) => sum + f.estimatedOrderCost, 0).toFixed(2),
    );

    const stockoutCandidates = supplierForecasts
      .map((f) => f.daysUntilStockout)
      .filter((d): d is number => d !== null && Number.isFinite(d));
    const earliestStockoutDays =
      stockoutCandidates.length > 0 ? Math.min(...stockoutCandidates) : null;

    const leadTimeRiskCount = supplierForecasts.filter(
      (f) =>
        f.isBelowMinimum ||
        f.currentStock <= 0 ||
        (f.daysUntilStockout !== null && f.daysUntilStockout <= effectiveLeadTimeDays + 2),
    ).length;

    return {
      key,
      record,
      name,
      contactPerson: inferredContactPerson,
      phone: inferredPhone,
      email: inferredEmail,
      address: record?.address || '',
      paymentTerms: record?.paymentTerms || '',
      notes: record?.notes || '',
      defaultLeadTimeDays,
      minLeadTimeDays,
      maxLeadTimeDays,
      effectiveLeadTimeDays,
      items,
      totalStockValue,
      lowStockCount,
      belowMinimumCount,
      historicalOrders,
      totalOrderCount: historicalOrders.length,
      totalOrderSpend,
      lastOrderDate,
      onTimeDeliveryRate,
      trackedDeliveryCount,
      onTimeDeliveryCount,
      lateDeliveryCount,
      avgActualDeliveryDays,
      avgCostVariancePct,
      avgCostVarianceAmount,
      costVarianceLineCount,
      forecasts: supplierForecasts,
      urgentForecastCount: urgentForecasts.length,
      recommendedOrderSpend,
      earliestStockoutDays,
      leadTimeRiskCount,
    };
  });

  return profiles.sort((a, b) => {
    if (b.leadTimeRiskCount !== a.leadTimeRiskCount) {
      return b.leadTimeRiskCount - a.leadTimeRiskCount;
    }
    if (b.belowMinimumCount !== a.belowMinimumCount) {
      return b.belowMinimumCount - a.belowMinimumCount;
    }
    if (b.urgentForecastCount !== a.urgentForecastCount) {
      return b.urgentForecastCount - a.urgentForecastCount;
    }
    return a.name.localeCompare(b.name);
  });
}
