import type {
  InventoryAlertNotification,
  InventoryItem,
  InventoryStockFilter,
  InventorySupplierInfo,
  PredictiveReorderForecast,
  ReorderRequestItem,
  ReorderRequestScope,
  StockMovement,
  StockMovementReferenceType,
  StockMovementType,
  StockStatus,
  SupplyCategory,
} from '../types/inventory.ts';

export const STOCK_MOVEMENT_LABELS: Record<StockMovementType, string> = {
  initial_stock: 'Initial Stock',
  purchase: 'Purchase / Restock',
  sale_deduction: 'POS Sale Deduction',
  job_usage: 'Print Job Usage',
  adjustment: 'Manual Adjustment',
  wastage: 'Production Wastage',
  damaged: 'Damaged Stock',
  return: 'Stock Return',
};

export function getAvailableStock(
  item: Pick<InventoryItem, 'quantityOnHand' | 'reservedQuantity'>,
): number {
  const onHand = Number(item.quantityOnHand) || 0;
  const reserved = Math.max(0, Number(item.reservedQuantity) || 0);
  return Number(Math.max(0, onHand - reserved).toFixed(2));
}

export function getInventoryStockStatus(
  item: Pick<InventoryItem, 'quantityOnHand' | 'reorderLevel'>,
): StockStatus {
  const onHand = Number(item.quantityOnHand) || 0;
  const reorder = Number(item.reorderLevel) || 0;
  if (onHand <= 0) return 'out_of_stock';
  if (onHand <= reorder) return 'low_stock';
  return 'in_stock';
}

export function isLowStockItem(
  item: Pick<InventoryItem, 'quantityOnHand' | 'currentStock' | 'reorderLevel' | 'minimumThreshold'>,
): boolean {
  const onHand = Number(item.currentStock ?? item.quantityOnHand) || 0;
  const reorder = Number(item.reorderLevel) || 0;
  return onHand <= reorder || isBelowMinimumThreshold(item);
}

export function isBelowMinimumThreshold(
  item: Pick<InventoryItem, 'quantityOnHand' | 'currentStock' | 'minimumThreshold'>,
): boolean {
  const minThreshold = Math.max(0, Number(item.minimumThreshold) || 0);
  if (minThreshold <= 0) return false;
  const stockCount = Math.max(0, Number(item.currentStock ?? item.quantityOnHand) || 0);
  return stockCount < minThreshold;
}

export function getBelowMinimumItems(items: InventoryItem[]): InventoryItem[] {
  return items
    .filter((item) => isBelowMinimumThreshold(item))
    .sort((a, b) => {
      const stockA = Math.max(0, Number(a.currentStock ?? a.quantityOnHand) || 0);
      const stockB = Math.max(0, Number(b.currentStock ?? b.quantityOnHand) || 0);
      if ((stockA <= 0) !== (stockB <= 0)) {
        return stockA <= 0 ? -1 : 1;
      }
      const minA = Math.max(1, Number(a.minimumThreshold) || 1);
      const minB = Math.max(1, Number(b.minimumThreshold) || 1);
      const ratioA = stockA / minA;
      const ratioB = stockB / minB;
      if (Math.abs(ratioA - ratioB) > 0.001) {
        return ratioA - ratioB;
      }
      return a.name.localeCompare(b.name);
    });
}

export function buildReorderRequestList(
  items: InventoryItem[],
  scope: ReorderRequestScope = 'below_minimum',
  forecastsByItemId?: Map<string, PredictiveReorderForecast>,
): ReorderRequestItem[] {
  const targetItems =
    scope === 'below_minimum'
      ? getBelowMinimumItems(items)
      : scope === 'nearing_threshold'
        ? items
            .filter((item) => {
              const forecast = forecastsByItemId?.get(item.id);
              if (forecast) return forecast.isNearingThreshold;
              const stockCount = Math.max(0, Number(item.currentStock ?? item.quantityOnHand) || 0);
              const reorderLevel = Math.max(0, Number(item.reorderLevel) || 0);
              return (
                stockCount <= 0 ||
                stockCount <= reorderLevel ||
                isBelowMinimumThreshold(item)
              );
            })
            .sort((a, b) => {
              const fa = forecastsByItemId?.get(a.id);
              const fb = forecastsByItemId?.get(b.id);
              if (fa && fb && fa.urgencyScore !== fb.urgencyScore) {
                return fb.urgencyScore - fa.urgencyScore;
              }
              return a.name.localeCompare(b.name);
            })
        : items
            .filter((item) => {
              const stockCount = Math.max(0, Number(item.currentStock ?? item.quantityOnHand) || 0);
              const reorderLevel = Math.max(0, Number(item.reorderLevel) || 0);
              return (
                stockCount <= 0 ||
                stockCount <= reorderLevel ||
                isBelowMinimumThreshold(item)
              );
            })
            .sort((a, b) => {
              const belowA = isBelowMinimumThreshold(a);
              const belowB = isBelowMinimumThreshold(b);
              if (belowA !== belowB) return belowA ? -1 : 1;
              const stockA = Math.max(0, Number(a.currentStock ?? a.quantityOnHand) || 0);
              const stockB = Math.max(0, Number(b.currentStock ?? b.quantityOnHand) || 0);
              if ((stockA <= 0) !== (stockB <= 0)) return stockA <= 0 ? -1 : 1;
              return a.name.localeCompare(b.name);
            });

  return targetItems.map((item) => {
    const currentStock = Math.max(0, Number(item.currentStock ?? item.quantityOnHand) || 0);
    const minimumThreshold = Math.max(0, Number(item.minimumThreshold) || 0);
    const reorderLevel = Math.max(0, Number(item.reorderLevel) || 0);
    const targetBaseline = Math.max(minimumThreshold, reorderLevel);
    const shortfall = Math.max(
      0,
      Number(
        ((minimumThreshold > 0 ? minimumThreshold : reorderLevel) - currentStock).toFixed(2),
      ),
    );
    const forecast = forecastsByItemId?.get(item.id);
    const configuredOrderQty = Math.max(0, Number(item.reorderQuantity) || 0);
    const minimumRecoveryQty = Math.max(1, Math.ceil(targetBaseline * 2 - currentStock));
    const fallbackOrderQty =
      configuredOrderQty > 0
        ? Math.max(configuredOrderQty, Math.ceil(shortfall))
        : minimumRecoveryQty;

    const recommendedOrderQty =
      forecast && forecast.weightedDailyVelocity > 0 && forecast.suggestedOrderQty > 0
        ? forecast.suggestedOrderQty
        : fallbackOrderQty;

    const unitCost = Math.max(0, Number(item.unitCost) || 0);
    const sup = extractSupplierInfo(item);

    return {
      inventoryItemId: item.id,
      sku: item.sku,
      name: item.name,
      category: item.category,
      unit: item.unit,
      currentStock,
      minimumThreshold,
      reorderLevel,
      shortfall,
      recommendedOrderQty,
      unitCost,
      estimatedCost: Number((recommendedOrderQty * unitCost).toFixed(2)),
      supplierName: sup.name || 'Unassigned Supplier',
      supplierContact: sup.contact || '',
      supplierSku: sup.supplierSku || '',
      leadTimeDays: sup.leadTimeDays ?? 0,
      isBelowMinimum: isBelowMinimumThreshold(item),
      isOutOfStock: currentStock <= 0,
      dailyVelocity: forecast?.weightedDailyVelocity,
      daysUntilThreshold: forecast?.daysUntilThreshold,
      daysUntilStockout: forecast?.daysUntilStockout,
      confidence: forecast?.confidence,
      forecastRationale: forecast?.rationale,
    };
  });
}

export function buildInventoryAlertNotifications(
  items: InventoryItem[],
): {
  belowMinimumItems: InventoryItem[];
  hasSimultaneousBreach: boolean;
  breachSignature: string;
  notifications: InventoryAlertNotification[];
} {
  const belowMinimumItems = getBelowMinimumItems(items);
  const hasSimultaneousBreach = belowMinimumItems.length >= 2;
  const breachIds = belowMinimumItems.map((i) => i.id).sort();
  const breachSignature = hasSimultaneousBreach
    ? `multi-min:${breachIds.join(',')}`
    : '';

  const notifications: InventoryAlertNotification[] = [];

  if (hasSimultaneousBreach) {
    const latestTimestamp = belowMinimumItems.reduce((latest, item) => {
      const ts = item.updatedAt || '';
      return ts > latest ? ts : latest;
    }, new Date().toISOString());

    const previewNames = belowMinimumItems
      .slice(0, 3)
      .map((i) => i.name)
      .join(', ');
    const extraCount = Math.max(0, belowMinimumItems.length - 3);

    notifications.push({
      id: 'notif-simultaneous-min-breach',
      kind: 'simultaneous_minimum_breach',
      severity: 'critical',
      title: `${belowMinimumItems.length} Items Below Minimum Threshold`,
      message: `${previewNames}${extraCount > 0 ? ` +${extraCount} more` : ''} dropped below minimum stock simultaneously. Generate a reorder request list to replenish.`,
      affectedItemIds: breachIds,
      affectedItems: belowMinimumItems,
      timestamp: latestTimestamp,
      signature: breachSignature,
    });
  }

  for (const item of belowMinimumItems) {
    const stockCount = Math.max(0, Number(item.currentStock ?? item.quantityOnHand) || 0);
    const minThreshold = Math.max(0, Number(item.minimumThreshold) || 0);
    const isOut = stockCount <= 0;
    notifications.push({
      id: `notif-min-${item.id}`,
      kind: isOut ? 'out_of_stock' : 'below_minimum',
      severity: 'critical',
      title: isOut ? `${item.name} is out of stock` : `${item.name} is below minimum`,
      message: `${stockCount} ${item.unit} on hand (Min ${minThreshold} ${item.unit})${
        item.supplier ? ` · ${item.supplier}` : ''
      }`,
      affectedItemIds: [item.id],
      affectedItems: [item],
      timestamp: item.updatedAt || new Date().toISOString(),
      signature: `item-min:${item.id}:${minThreshold}:${stockCount <= 0 ? '0' : 'below'}`,
    });
  }

  const warningItems = items
    .filter((item) => {
      if (isBelowMinimumThreshold(item)) return false;
      const stockCount = Math.max(0, Number(item.currentStock ?? item.quantityOnHand) || 0);
      const reorder = Math.max(0, Number(item.reorderLevel) || 0);
      return stockCount <= 0 || stockCount <= reorder;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const item of warningItems) {
    const stockCount = Math.max(0, Number(item.currentStock ?? item.quantityOnHand) || 0);
    const reorder = Math.max(0, Number(item.reorderLevel) || 0);
    const isOut = stockCount <= 0;
    notifications.push({
      id: `notif-low-${item.id}`,
      kind: isOut ? 'out_of_stock' : 'low_stock',
      severity: isOut ? 'critical' : 'warning',
      title: isOut ? `${item.name} is out of stock` : `${item.name} reached reorder level`,
      message: `${stockCount} ${item.unit} on hand (Reorder at ${reorder} ${item.unit})`,
      affectedItemIds: [item.id],
      affectedItems: [item],
      timestamp: item.updatedAt || new Date().toISOString(),
      signature: `item-low:${item.id}:${reorder}:${isOut ? '0' : 'warn'}`,
    });
  }

  return {
    belowMinimumItems,
    hasSimultaneousBreach,
    breachSignature,
    notifications,
  };
}

export function getSuggestedRestockQuantity(
  item: Pick<InventoryItem, 'quantityOnHand' | 'reorderLevel' | 'reorderQuantity'>,
): number {
  const onHand = Number(item.quantityOnHand) || 0;
  const reorderLevel = Number(item.reorderLevel) || 0;
  if (onHand > reorderLevel) return 0;
  if (item.reorderQuantity && item.reorderQuantity > 0) {
    return item.reorderQuantity;
  }
  return Math.max(1, Number((reorderLevel * 2 - onHand).toFixed(2)));
}

export function extractSupplierInfo(item: InventoryItem): InventorySupplierInfo {
  const details = item.supplierDetails ?? item.supplierInfo;
  if (details && details.name) {
    return {
      name: details.name,
      contact: details.contact ?? item.supplierContact ?? '',
      supplierSku: details.supplierSku ?? item.supplierSku ?? '',
      leadTimeDays: details.leadTimeDays ?? item.leadTimeDays ?? 0,
    };
  }
  return {
    name: item.supplier || '',
    contact: item.supplierContact || '',
    supplierSku: item.supplierSku || '',
    leadTimeDays: item.leadTimeDays ?? 0,
  };
}

export function calculateInventoryValuation(items: InventoryItem[]): number {
  return Number(
    items
      .reduce(
        (sum, item) =>
          sum + Math.max(0, Number(item.quantityOnHand) || 0) * (Number(item.unitCost) || 0),
        0,
      )
      .toFixed(2),
  );
}

export function computeSignedStockDelta(
  movementType: StockMovementType,
  rawDelta: number,
): number {
  const num = Number(rawDelta) || 0;
  if (
    movementType === 'wastage' ||
    movementType === 'damaged' ||
    movementType === 'sale_deduction' ||
    movementType === 'job_usage'
  ) {
    return -Math.abs(num);
  }
  if (
    movementType === 'purchase' ||
    movementType === 'initial_stock' ||
    movementType === 'return'
  ) {
    return Math.abs(num);
  }
  return num;
}

export function inferReferenceType(
  movementType: StockMovementType,
): StockMovementReferenceType {
  switch (movementType) {
    case 'sale_deduction':
      return 'sale';
    case 'job_usage':
      return 'print_job';
    case 'purchase':
      return 'purchase_order';
    case 'return':
      return 'return';
    case 'initial_stock':
      return 'system';
    default:
      return 'manual';
  }
}

export function resolveSupplyCategory(
  categories: SupplyCategory[],
  categoryIdOrName?: string,
): SupplyCategory | undefined {
  if (!categoryIdOrName) return undefined;
  const target = categoryIdOrName.trim().toLowerCase();
  return categories.find(
    (c) => c.id.toLowerCase() === target || c.name.toLowerCase() === target,
  );
}

export function filterInventoryItems(
  items: InventoryItem[],
  filter: InventoryStockFilter,
  categories: SupplyCategory[] = [],
): InventoryItem[] {
  const q = (filter.search || '').trim().toLowerCase();
  const targetCat = filter.categoryId && filter.categoryId !== 'all'
    ? resolveSupplyCategory(categories, filter.categoryId)
    : undefined;

  return items.filter((item) => {
    if (filter.stockStatus && filter.stockStatus !== 'all') {
      if (getInventoryStockStatus(item) !== filter.stockStatus) return false;
    }
    if (filter.itemType && filter.itemType !== 'all') {
      if (item.itemType !== filter.itemType) return false;
    }
    if (filter.categoryId && filter.categoryId !== 'all') {
      const matchesId = item.categoryId === filter.categoryId;
      const matchesName =
        targetCat && item.category.toLowerCase() === targetCat.name.toLowerCase();
      const matchesRaw = item.category.toLowerCase() === filter.categoryId.toLowerCase();
      if (!matchesId && !matchesName && !matchesRaw) return false;
    }
    if (q) {
      const supplierName = (item.supplierInfo?.name || item.supplier || '').toLowerCase();
      const hit =
        item.name.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        supplierName.includes(q) ||
        (item.storageLocation || '').toLowerCase().includes(q);
      if (!hit) return false;
    }
    return true;
  });
}

const SUPPLY_CATEGORY_SKU_CODES: Record<string, string> = {
  'sup-cat-paper': 'PAP',
  paper: 'PAP',
  'sup-cat-photo': 'PHO',
  'photo paper': 'PHO',
  'sup-cat-finishing': 'FIN',
  finishing: 'FIN',
  'sup-cat-large-format': 'LRG',
  'large format': 'LRG',
  'sup-cat-id-merch': 'IDM',
  'id & merch': 'IDM',
  'sup-cat-ink-toner': 'INK',
  'ink & toner': 'INK',
};

const SUPPLIER_STOP_WORDS = new Set([
  'supply',
  'supplies',
  'supplier',
  'suppliers',
  'inc',
  'corp',
  'corporation',
  'co',
  'company',
  'ltd',
  'llc',
  'the',
  'and',
  'of',
  'trading',
  'enterprise',
  'enterprises',
  'hub',
  'store',
  'shop',
  'center',
  'centre',
]);

function abbreviateTokens(tokens: string[], fallback: string): string {
  if (tokens.length === 0) return fallback;
  if (tokens.length === 1) {
    return tokens[0].slice(0, 3).toUpperCase();
  }
  if (tokens.length === 2) {
    const [w1, w2] = tokens;
    if (w1.length === 1) {
      return (w1 + w2).slice(0, 3).toUpperCase();
    }
    return (w1.slice(0, 2) + w2[0]).toUpperCase();
  }
  return (tokens[0][0] + tokens[1][0] + tokens[2][0]).toUpperCase();
}

export function deriveCategorySkuCode(
  categoryName?: string,
  categoryId?: string,
): string {
  const idKey = (categoryId || '').trim().toLowerCase();
  if (idKey && SUPPLY_CATEGORY_SKU_CODES[idKey]) {
    return SUPPLY_CATEGORY_SKU_CODES[idKey];
  }
  const nameKey = (categoryName || '').trim().toLowerCase();
  if (nameKey && SUPPLY_CATEGORY_SKU_CODES[nameKey]) {
    return SUPPLY_CATEGORY_SKU_CODES[nameKey];
  }
  const tokens = (categoryName || '').match(/[A-Za-z0-9]+/g) ?? [];
  return abbreviateTokens(tokens, 'SUP');
}

export function deriveSupplierSkuCode(supplierName?: string): string {
  const rawTokens = (supplierName || '').match(/[A-Za-z0-9]+/g) ?? [];
  if (rawTokens.length === 0) return 'GEN';
  const meaningful = rawTokens.filter(
    (token) => !SUPPLIER_STOP_WORDS.has(token.toLowerCase()),
  );
  return abbreviateTokens(meaningful.length > 0 ? meaningful : rawTokens, 'GEN');
}

export function findDuplicateSkuItem<T extends Pick<InventoryItem, 'id' | 'sku' | 'name'>>(
  candidateSku: string,
  existingItems: T[],
  excludeItemId?: string,
): T | undefined {
  const normalized = candidateSku.trim().toUpperCase();
  if (!normalized) return undefined;
  return existingItems.find(
    (item) =>
      (!excludeItemId || item.id !== excludeItemId) &&
      (item.sku || '').trim().toUpperCase() === normalized,
  );
}

export interface GenerateInventorySkuInput {
  categoryId?: string;
  categoryName?: string;
  supplier?: string;
  existingSkus?: string[];
  existingItems?: Array<Pick<InventoryItem, 'id' | 'sku'>>;
  excludeItemId?: string;
}

export interface GeneratedInventorySkuResult {
  sku: string;
  categoryCode: string;
  supplierCode: string;
  prefix: string;
  sequence: number;
}

export function generateUniqueInventorySku({
  categoryId,
  categoryName,
  supplier,
  existingSkus = [],
  existingItems = [],
  excludeItemId,
}: GenerateInventorySkuInput): GeneratedInventorySkuResult {
  const usedSet = new Set<string>();
  for (const rawSku of existingSkus) {
    const clean = (rawSku || '').trim().toUpperCase();
    if (clean) usedSet.add(clean);
  }
  for (const item of existingItems) {
    if (excludeItemId && item.id === excludeItemId) continue;
    const clean = (item.sku || '').trim().toUpperCase();
    if (clean) usedSet.add(clean);
  }

  const categoryCode = deriveCategorySkuCode(categoryName, categoryId);
  const supplierCode = deriveSupplierSkuCode(supplier);
  const prefix = `${categoryCode}-${supplierCode}`;

  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const seqRegex = new RegExp(`^${escapedPrefix}-(\\d+)$`);
  let maxSeq = 0;
  for (const existing of usedSet) {
    const match = seqRegex.exec(existing);
    if (match) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed > maxSeq) {
        maxSeq = parsed;
      }
    }
  }

  let seq = maxSeq + 1;
  let candidate = `${prefix}-${String(seq).padStart(3, '0')}`;
  while (usedSet.has(candidate)) {
    seq += 1;
    candidate = `${prefix}-${String(seq).padStart(3, '0')}`;
  }

  return {
    sku: candidate,
    categoryCode,
    supplierCode,
    prefix,
    sequence: seq,
  };
}

export function normalizeInventoryItem(
  raw: Partial<InventoryItem> & { id: string },
): InventoryItem {
  const now = new Date().toISOString();
  const quantityOnHand = Math.max(0, Number(raw.quantityOnHand ?? raw.currentStock) || 0);
  const reorderLevel = Math.max(0, Number(raw.reorderLevel ?? raw.reorderThreshold) || 0);
  const minimumThreshold = Math.max(0, Number(raw.minimumThreshold) || 0);
  const details = raw.supplierDetails ?? raw.supplierInfo;
  const supplierName = (raw.supplier ?? details?.name ?? '').trim();
  const supplierContact = (raw.supplierContact ?? details?.contact ?? '').trim();
  const supplierSku = (raw.supplierSku ?? details?.supplierSku ?? '').trim();
  const leadTimeDays = Math.max(0, Number(raw.leadTimeDays ?? details?.leadTimeDays) || 0);
  const supplierPayload = supplierName
    ? {
        name: supplierName,
        contact: supplierContact,
        supplierSku,
        leadTimeDays,
      }
    : undefined;

  const fallbackSku = generateUniqueInventorySku({
    categoryId: raw.categoryId ? String(raw.categoryId).trim() : undefined,
    categoryName: (raw.category || 'Supplies').trim(),
    supplier: supplierName,
  }).sku;

  return {
    id: raw.id,
    sku: (raw.sku || '').trim() || fallbackSku,
    barcode: raw.barcode ? String(raw.barcode).trim() : '',
    name: (raw.name || '').trim(),
    categoryId: raw.categoryId ? String(raw.categoryId).trim() : undefined,
    category: (raw.category || 'Supplies').trim(),
    itemType: raw.itemType === 'finished_product' ? 'finished_product' : 'consumable',
    unit: (raw.unit || 'pc').trim(),
    quantityOnHand,
    currentStock: quantityOnHand,
    reservedQuantity: Math.max(0, Number(raw.reservedQuantity) || 0),
    reorderLevel,
    reorderThreshold: reorderLevel,
    minimumThreshold,
    reorderQuantity:
      raw.reorderQuantity !== undefined
        ? Math.max(0, Number(raw.reorderQuantity) || 0)
        : Math.max(reorderLevel * 2, 0),
    unitCost: Math.max(0, Number(raw.unitCost) || 0),
    supplier: supplierName,
    supplierContact,
    supplierSku,
    leadTimeDays,
    supplierDetails: supplierPayload,
    supplierInfo: supplierPayload,
    storageLocation: (raw.storageLocation || '').trim(),
    sortOrder: raw.sortOrder !== undefined ? Number(raw.sortOrder) || 0 : undefined,
    lastRestockedAt: raw.lastRestockedAt ?? null,
    isDemo: Boolean(raw.isDemo),
    createdAt: raw.createdAt || raw.updatedAt || now,
    updatedAt: raw.updatedAt || now,
  };
}

export function normalizeStockMovement(
  raw: Partial<StockMovement> & { id: string; inventoryItemId: string; itemName: string },
): StockMovement {
  const now = new Date().toISOString();
  const movementType: StockMovementType = raw.movementType || 'adjustment';
  const quantityDelta = Number(raw.quantityDelta) || 0;
  const balanceAfter = Math.max(0, Number(raw.balanceAfter) || 0);
  const quantityBefore =
    raw.quantityBefore !== undefined
      ? Math.max(0, Number(raw.quantityBefore) || 0)
      : Math.max(0, Number((balanceAfter - quantityDelta).toFixed(2)));
  const createdAt = raw.createdAt || now;

  return {
    id: raw.id,
    inventoryItemId: raw.inventoryItemId,
    itemName: raw.itemName,
    movementType,
    quantityBefore,
    quantityDelta,
    balanceAfter,
    unitCostAtMovement: Math.max(0, Number(raw.unitCostAtMovement) || 0),
    referenceType: raw.referenceType || inferReferenceType(movementType),
    reference: (raw.reference || '').trim(),
    performedById: raw.performedById || '',
    performedBy: raw.performedBy || 'System',
    note: (raw.note || '').trim(),
    occurredAt: raw.occurredAt || createdAt,
    orderedAt: raw.orderedAt || undefined,
    expectedDeliveryAt: raw.expectedDeliveryAt || undefined,
    createdAt,
  };
}

export function validateInventoryItemInput(
  input: Partial<InventoryItem>,
): { valid: true } | { valid: false; error: string } {
  if (!input.name || !input.name.trim()) {
    return { valid: false, error: 'Item name is required.' };
  }
  if (!input.unit || !input.unit.trim()) {
    return { valid: false, error: 'Stock unit (e.g., sheet, pc, sq ft) is required.' };
  }
  const stockVal = input.quantityOnHand ?? input.currentStock;
  if (stockVal !== undefined && Number(stockVal) < 0) {
    return { valid: false, error: 'Quantity on hand cannot be negative.' };
  }
  const thresholdVal = input.reorderLevel ?? input.reorderThreshold;
  if (thresholdVal !== undefined && Number(thresholdVal) < 0) {
    return { valid: false, error: 'Reorder level cannot be negative.' };
  }
  if (input.minimumThreshold !== undefined && Number(input.minimumThreshold) < 0) {
    return { valid: false, error: 'Minimum threshold cannot be negative.' };
  }
  if (input.unitCost !== undefined && Number(input.unitCost) < 0) {
    return { valid: false, error: 'Unit cost cannot be negative.' };
  }
  return { valid: true };
}

export function validateStockMovementInput(input: {
  movementType?: StockMovementType;
  quantityDelta?: number;
}): { valid: true } | { valid: false; error: string } {
  const delta = Number(input.quantityDelta) || 0;
  if (delta === 0) {
    return { valid: false, error: 'Stock quantity change must be non-zero.' };
  }
  return { valid: true };
}
