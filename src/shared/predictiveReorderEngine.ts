import type {
  InventoryItem,
  PredictiveReorderForecast,
  PredictiveReorderVelocityConfidence,
  StockMovement,
} from '../types/inventory.ts';
import type {
  MaterialConsumptionBinding,
  PrintService,
  Transaction,
} from './types.ts';
import {
  extractSupplierInfo,
  isBelowMinimumThreshold,
} from './inventoryModel.ts';

const DAY_MS = 86400000;

export interface PredictiveReorderOptions {
  inventory: InventoryItem[];
  transactions: Transaction[];
  services: PrintService[];
  stockMovements: StockMovement[];
  lookbackDays?: number;
  targetCoverageDays?: number;
  nowMs?: number;
}

interface ConsumptionAccumulator {
  salesWindow: number;
  salesRecent7d: number;
  otherUsageWindow: number;
  otherUsageRecent7d: number;
  salesEvents: number;
  movementEvents: number;
  earliestMs: number | null;
}

function getOrCreateAcc(
  map: Map<string, ConsumptionAccumulator>,
  itemId: string,
): ConsumptionAccumulator {
  let acc = map.get(itemId);
  if (!acc) {
    acc = {
      salesWindow: 0,
      salesRecent7d: 0,
      otherUsageWindow: 0,
      otherUsageRecent7d: 0,
      salesEvents: 0,
      movementEvents: 0,
      earliestMs: null,
    };
    map.set(itemId, acc);
  }
  return acc;
}

function recordEarliest(acc: ConsumptionAccumulator, tsMs: number) {
  if (acc.earliestMs === null || tsMs < acc.earliestMs) {
    acc.earliestMs = tsMs;
  }
}

/**
 * Predictive Analytics Engine:
 * Computes historical sales velocity (from POS transactions mapped via service
 * material bindings + non-duplicated outbound stock movements) to project
 * threshold/stockout runway and recommend target-coverage reorder quantities.
 */
export function computePredictiveReorderForecasts({
  inventory,
  transactions,
  services,
  stockMovements,
  lookbackDays = 30,
  targetCoverageDays = 30,
  nowMs = Date.now(),
}: PredictiveReorderOptions): PredictiveReorderForecast[] {
  const safeLookback = Math.max(7, Math.round(lookbackDays));
  const safeCoverage = Math.max(7, Math.round(targetCoverageDays));
  const windowStartMs = nowMs - safeLookback * DAY_MS;
  const recent7dStartMs = nowMs - 7 * DAY_MS;

  const serviceBindings = new Map<string, MaterialConsumptionBinding[]>();
  for (const srv of services) {
    if (Array.isArray(srv.consumables) && srv.consumables.length > 0) {
      serviceBindings.set(srv.id, srv.consumables);
    }
  }

  const accMap = new Map<string, ConsumptionAccumulator>();
  const recordedSaleKeys = new Set<string>();

  for (const txn of transactions) {
    if (
      txn.type !== 'sale' ||
      txn.paymentStatus === 'voided' ||
      txn.paymentStatus === 'refunded'
    ) {
      continue;
    }

    const tsMs = Date.parse(txn.createdAt);
    if (!Number.isFinite(tsMs) || tsMs < windowStartMs || tsMs > nowMs + DAY_MS) {
      continue;
    }

    const isRecent7d = tsMs >= recent7dStartMs;

    for (const line of txn.items) {
      const bindings =
        Array.isArray(line.consumables) && line.consumables.length > 0
          ? line.consumables
          : serviceBindings.get(line.serviceId) ?? [];

      if (bindings.length === 0) continue;

      const qtyMultiplier = Math.max(0, Number(line.effectiveQuantity) || 0);
      if (qtyMultiplier <= 0) continue;

      for (const binding of bindings) {
        const consumed = qtyMultiplier * Math.max(0, Number(binding.quantityPerUnit) || 0);
        if (consumed <= 0) continue;

        const acc = getOrCreateAcc(accMap, binding.inventoryItemId);
        acc.salesWindow += consumed;
        if (isRecent7d) acc.salesRecent7d += consumed;
        acc.salesEvents += 1;
        recordEarliest(acc, tsMs);

        if (txn.receiptNumber) {
          recordedSaleKeys.add(`${txn.receiptNumber.trim()}::${binding.inventoryItemId}`);
        }
      }
    }
  }

  for (const mov of stockMovements) {
    const delta = Number(mov.quantityDelta) || 0;
    if (delta >= 0) continue;

    if (
      mov.movementType !== 'sale_deduction' &&
      mov.movementType !== 'job_usage' &&
      mov.movementType !== 'wastage' &&
      mov.movementType !== 'damaged'
    ) {
      continue;
    }

    const tsMs = Date.parse(mov.occurredAt || mov.createdAt);
    if (!Number.isFinite(tsMs) || tsMs < windowStartMs || tsMs > nowMs + DAY_MS) {
      continue;
    }

    const refKey = mov.reference
      ? `${mov.reference.trim()}::${mov.inventoryItemId}`
      : '';
    if (
      mov.movementType === 'sale_deduction' &&
      refKey &&
      recordedSaleKeys.has(refKey)
    ) {
      // Already attributed via POS transaction line items; avoid double counting
      continue;
    }

    const units = Math.abs(delta);
    const isRecent7d = tsMs >= recent7dStartMs;
    const acc = getOrCreateAcc(accMap, mov.inventoryItemId);

    if (mov.movementType === 'sale_deduction') {
      acc.salesWindow += units;
      if (isRecent7d) acc.salesRecent7d += units;
      acc.salesEvents += 1;
    } else {
      acc.otherUsageWindow += units;
      if (isRecent7d) acc.otherUsageRecent7d += units;
      acc.movementEvents += 1;
    }
    recordEarliest(acc, tsMs);
  }

  const forecasts: PredictiveReorderForecast[] = inventory.map((item) => {
    const currentStock = Math.max(0, Number(item.currentStock ?? item.quantityOnHand) || 0);
    const minimumThreshold = Math.max(0, Number(item.minimumThreshold) || 0);
    const reorderLevel = Math.max(0, Number(item.reorderLevel ?? item.reorderThreshold) || 0);
    const thresholdBaseline = Math.max(minimumThreshold, reorderLevel);
    const configuredOrderQty = Math.max(0, Number(item.reorderQuantity) || 0);
    const unitCost = Math.max(0, Number(item.unitCost) || 0);
    const sup = extractSupplierInfo(item);
    const leadTimeDays = Math.max(1, Math.round(Number(sup.leadTimeDays) || 3));

    const acc = accMap.get(item.id);
    const salesConsumedUnits = Number((acc?.salesWindow ?? 0).toFixed(2));
    const otherUsageUnits = Number((acc?.otherUsageWindow ?? 0).toFixed(2));
    const totalConsumedUnits = Number(
      (salesConsumedUnits + otherUsageUnits).toFixed(2),
    );

    const activeSpanDays =
      acc?.earliestMs !== null && acc?.earliestMs !== undefined
        ? Math.max(7, Math.min(safeLookback, Math.ceil((nowMs - acc.earliestMs) / DAY_MS)))
        : safeLookback;

    const recent7dTotal = (acc?.salesRecent7d ?? 0) + (acc?.otherUsageRecent7d ?? 0);
    const recent7dDailyVelocity = Number((recent7dTotal / 7).toFixed(2));
    const windowDailyVelocity = Number(
      (totalConsumedUnits / activeSpanDays).toFixed(2),
    );

    // Blend 7-day recent momentum (60%) with full lookback baseline (40%)
    const weightedDailyVelocity =
      totalConsumedUnits > 0
        ? Number((0.6 * recent7dDailyVelocity + 0.4 * windowDailyVelocity).toFixed(2))
        : 0;
    const weeklyDemand = Number((weightedDailyVelocity * 7).toFixed(1));

    const isBelowMinimum = isBelowMinimumThreshold(item);
    const isAtReorder = currentStock <= reorderLevel;

    const daysUntilThreshold =
      weightedDailyVelocity > 0
        ? currentStock <= thresholdBaseline
          ? 0
          : Number(
              ((currentStock - thresholdBaseline) / weightedDailyVelocity).toFixed(1),
            )
        : null;

    const daysUntilStockout =
      weightedDailyVelocity > 0
        ? currentStock <= 0
          ? 0
          : Number((currentStock / weightedDailyVelocity).toFixed(1))
        : null;

    const projectedStockoutDate =
      daysUntilStockout !== null
        ? new Date(nowMs + daysUntilStockout * DAY_MS).toISOString()
        : null;

    const nearingRunwayWindow = Math.max(leadTimeDays + 7, 14);
    const isWithinThresholdBuffer =
      thresholdBaseline > 0 && currentStock <= thresholdBaseline * 1.25;

    const isNearingThreshold =
      currentStock <= 0 ||
      isBelowMinimum ||
      isAtReorder ||
      (daysUntilThreshold !== null && daysUntilThreshold <= nearingRunwayWindow) ||
      isWithinThresholdBuffer;

    let confidence: PredictiveReorderVelocityConfidence = 'baseline';
    if (acc && (acc.salesEvents >= 2 || (acc.salesEvents >= 1 && acc.movementEvents >= 1))) {
      confidence = 'high';
    } else if (totalConsumedUnits > 0) {
      confidence = 'medium';
    }

    let suggestedOrderQty = 0;
    let rationale = '';

    if (weightedDailyVelocity > 0) {
      const safetyDays = Math.max(3, Math.ceil(leadTimeDays * 0.5));
      const demandForHorizon = weightedDailyVelocity * (safeCoverage + leadTimeDays);
      const safetyBuffer = Math.max(
        minimumThreshold,
        weightedDailyVelocity * safetyDays,
      );
      const targetStock = Math.max(
        thresholdBaseline + Math.ceil(weightedDailyVelocity * safetyDays),
        Math.ceil(demandForHorizon + safetyBuffer),
      );
      const rawNeed = Math.ceil(targetStock - currentStock);
      suggestedOrderQty = isNearingThreshold
        ? Math.max(1, rawNeed)
        : Math.max(0, rawNeed);
      rationale = `${weightedDailyVelocity}/day velocity · ${safeCoverage}d cover + ${leadTimeDays}d lead`;
    } else if (isNearingThreshold) {
      const fallbackTarget = Math.max(
        configuredOrderQty,
        Math.ceil(thresholdBaseline * 2 - currentStock),
        1,
      );
      suggestedOrderQty = fallbackTarget;
      rationale =
        configuredOrderQty > 0
          ? 'No recent sales · uses configured reorder qty'
          : 'No recent sales · restores 2× threshold buffer';
    } else {
      suggestedOrderQty = 0;
      rationale = 'Stock healthy with no immediate reorder needed';
    }

    // Higher score = higher urgency
    let urgencyScore = 0;
    if (currentStock <= 0) {
      urgencyScore = 1000;
    } else if (isBelowMinimum) {
      urgencyScore = 800 + Math.max(0, 100 - (currentStock / Math.max(1, minimumThreshold)) * 100);
    } else if (isAtReorder) {
      urgencyScore = 600 + Math.max(0, 100 - (currentStock / Math.max(1, reorderLevel)) * 100);
    } else if (daysUntilThreshold !== null && daysUntilThreshold <= nearingRunwayWindow) {
      urgencyScore = 400 + Math.max(0, (nearingRunwayWindow - daysUntilThreshold) * 10);
    } else if (isWithinThresholdBuffer) {
      urgencyScore = 250;
    } else if (daysUntilStockout !== null) {
      urgencyScore = Math.max(1, Math.round(100 - Math.min(99, daysUntilStockout)));
    }

    return {
      inventoryItemId: item.id,
      sku: item.sku,
      name: item.name,
      category: item.category,
      unit: item.unit,
      currentStock,
      minimumThreshold,
      reorderLevel,
      thresholdBaseline,
      leadTimeDays,
      lookbackDays: safeLookback,
      targetCoverageDays: safeCoverage,
      salesConsumedUnits,
      otherUsageUnits,
      totalConsumedUnits,
      recent7dDailyVelocity,
      windowDailyVelocity,
      weightedDailyVelocity,
      weeklyDemand,
      daysUntilThreshold,
      daysUntilStockout,
      projectedStockoutDate,
      isBelowMinimum,
      isAtReorder,
      isNearingThreshold,
      urgencyScore,
      suggestedOrderQty,
      configuredOrderQty,
      unitCost,
      estimatedOrderCost: Number((suggestedOrderQty * unitCost).toFixed(2)),
      supplierName: sup.name || 'Unassigned Supplier',
      supplierContact: sup.contact || '',
      supplierSku: sup.supplierSku || '',
      confidence,
      rationale,
    };
  });

  return forecasts.sort((a, b) => {
    if (b.urgencyScore !== a.urgencyScore) return b.urgencyScore - a.urgencyScore;
    if (b.weightedDailyVelocity !== a.weightedDailyVelocity) {
      return b.weightedDailyVelocity - a.weightedDailyVelocity;
    }
    return a.name.localeCompare(b.name);
  });
}
