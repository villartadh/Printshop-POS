export type InventoryItemType = 'consumable' | 'finished_product';
export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';
export type InventorySortField =
  | 'name'
  | 'sku'
  | 'category'
  | 'quantityOnHand'
  | 'currentStock'
  | 'reorderLevel'
  | 'reorderThreshold'
  | 'minimumThreshold'
  | 'unitCost'
  | 'status'
  | 'sortOrder'
  | 'updatedAt';
export type InventorySortDirection = 'asc' | 'desc';

export interface InventorySortConfig {
  field: InventorySortField;
  direction: InventorySortDirection;
}

export interface InventorySupplierDetails {
  name: string;
  contact?: string;
  supplierSku?: string;
  leadTimeDays?: number;
}

export type InventorySupplierInfo = InventorySupplierDetails;

export interface SupplyCategory {
  id: string;
  name: string;
  description: string;
  /** Default unit of measurement for items in this category (e.g., sheet, roll, bottle) */
  defaultUnit: string;
  /** Display sort priority (lower numbers appear first) */
  sortOrder: number;
  isDemo?: boolean;
}

export interface InventoryItem {
  id: string;
  sku: string;
  barcode?: string;
  name: string;
  categoryId?: string;
  category: string;
  itemType: InventoryItemType;
  /** Unit of measurement (e.g., sheet, pc, sq ft, bottle, roll) */
  unit: string;
  /** Current physical stock count on hand (canonical DB-mapped field) */
  quantityOnHand: number;
  /** Alias for quantityOnHand representing current stock count */
  currentStock?: number;
  /** Stock reserved/allocated to active print jobs */
  reservedQuantity?: number;
  /** Reorder threshold at or below which low-stock warning triggers (canonical DB-mapped field) */
  reorderLevel: number;
  /** Alias for reorderLevel representing reorder threshold */
  reorderThreshold?: number;
  /** Critical minimum stock threshold; falling below triggers red alert highlighting */
  minimumThreshold?: number;
  /** Recommended restock quantity when ordering from supplier */
  reorderQuantity?: number;
  unitCost: number;
  /** Primary supplier display name (flat column-compatible field) */
  supplier: string;
  /** Optional phone, email, or account rep for supplier */
  supplierContact?: string;
  /** Supplier's own catalog SKU or part code */
  supplierSku?: string;
  leadTimeDays?: number;
  /** Structured supplier details mirrored from flat supplier fields */
  supplierDetails?: InventorySupplierDetails;
  /** Alias for supplierDetails for backward compatibility */
  supplierInfo?: InventorySupplierInfo;
  storageLocation?: string;
  /** Display/catalog sort priority (lower numbers appear first) */
  sortOrder?: number;
  lastRestockedAt?: string | null;
  isDemo?: boolean;
  createdAt?: string;
  updatedAt: string;
}

export type StockMovementType =
  | 'initial_stock'
  | 'purchase'
  | 'sale_deduction'
  | 'job_usage'
  | 'adjustment'
  | 'wastage'
  | 'damaged'
  | 'return';

export type StockMovementReferenceType =
  | 'sale'
  | 'print_job'
  | 'purchase_order'
  | 'manual'
  | 'return'
  | 'system';

export interface StockMovement {
  id: string;
  inventoryItemId: string;
  itemName: string;
  movementType: StockMovementType;
  /** Stock count immediately prior to this movement */
  quantityBefore?: number;
  /** Signed quantity change (+ for additions, - for deductions/usage/wastage) */
  quantityDelta: number;
  /** Stock count immediately after this movement */
  balanceAfter: number;
  unitCostAtMovement?: number;
  referenceType?: StockMovementReferenceType;
  reference: string;
  performedById?: string;
  performedBy: string;
  note: string;
  /** Effective date stamp when the stock event occurred */
  occurredAt?: string;
  /** Purchase order placement timestamp (used for delivery lead-time tracking) */
  orderedAt?: string;
  /** Promised/expected delivery date stamp for purchase orders */
  expectedDeliveryAt?: string;
  /** Record creation ISO date stamp */
  createdAt: string;
}

export interface StockAdjustmentPayload {
  movementType: StockMovementType;
  quantityDelta: number;
  unitCost?: number;
  note: string;
  reference?: string;
  referenceType?: StockMovementReferenceType;
  occurredAt?: string;
  orderedAt?: string;
  expectedDeliveryAt?: string;
}

export interface InventoryStockFilter {
  search?: string;
  categoryId?: string;
  stockStatus?: StockStatus | 'all';
  itemType?: InventoryItemType | 'all';
  sortBy?: InventorySortField;
  sortDir?: InventorySortDirection;
}

export interface BulkInventoryUpdatePayload {
  ids: string[];
  categoryId?: string;
  category?: string;
  supplier?: string;
  supplierContact?: string;
  supplierSku?: string;
  leadTimeDays?: number;
}

export type ReorderRequestScope =
  | 'below_minimum'
  | 'nearing_threshold'
  | 'all_low_stock';

export type PredictiveReorderVelocityConfidence = 'high' | 'medium' | 'baseline';

export interface PredictiveReorderForecast {
  inventoryItemId: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  currentStock: number;
  minimumThreshold: number;
  reorderLevel: number;
  thresholdBaseline: number;
  leadTimeDays: number;
  lookbackDays: number;
  targetCoverageDays: number;
  salesConsumedUnits: number;
  otherUsageUnits: number;
  totalConsumedUnits: number;
  recent7dDailyVelocity: number;
  windowDailyVelocity: number;
  weightedDailyVelocity: number;
  weeklyDemand: number;
  daysUntilThreshold: number | null;
  daysUntilStockout: number | null;
  projectedStockoutDate: string | null;
  isBelowMinimum: boolean;
  isAtReorder: boolean;
  isNearingThreshold: boolean;
  urgencyScore: number;
  suggestedOrderQty: number;
  configuredOrderQty: number;
  unitCost: number;
  estimatedOrderCost: number;
  supplierName: string;
  supplierContact: string;
  supplierSku: string;
  confidence: PredictiveReorderVelocityConfidence;
  rationale: string;
}

export interface ReorderRequestItem {
  inventoryItemId: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  currentStock: number;
  minimumThreshold: number;
  reorderLevel: number;
  shortfall: number;
  recommendedOrderQty: number;
  unitCost: number;
  estimatedCost: number;
  supplierName: string;
  supplierContact: string;
  supplierSku: string;
  leadTimeDays: number;
  isBelowMinimum: boolean;
  isOutOfStock: boolean;
  dailyVelocity?: number;
  daysUntilThreshold?: number | null;
  daysUntilStockout?: number | null;
  confidence?: PredictiveReorderVelocityConfidence;
  forecastRationale?: string;
}

export type InventoryNotificationKind =
  | 'simultaneous_minimum_breach'
  | 'below_minimum'
  | 'out_of_stock'
  | 'low_stock';

export interface InventoryAlertNotification {
  id: string;
  kind: InventoryNotificationKind;
  severity: 'critical' | 'warning';
  title: string;
  message: string;
  affectedItemIds: string[];
  affectedItems: InventoryItem[];
  timestamp: string;
  signature: string;
}

export type SupplierCsvMatchMethod =
  | 'exact_sku'
  | 'supplier_sku'
  | 'supplier_name'
  | 'manual'
  | 'unmatched';

export interface SupplierCsvMappingItem {
  inventoryItemId: string;
  supplier?: string;
  supplierContact?: string;
  supplierSku?: string;
  leadTimeDays?: number;
  unitCost?: number;
  matchMethod?: SupplierCsvMatchMethod;
}

export interface SupplierCsvImportPayload {
  mappings: SupplierCsvMappingItem[];
  sourceFilename?: string;
}

export interface SupplierRecord {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  defaultLeadTimeDays: number;
  paymentTerms?: string;
  notes?: string;
  isDemo?: boolean;
  createdAt?: string;
  updatedAt: string;
}

export interface SupplierSavePayload {
  id?: string;
  name: string;
  previousName?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  defaultLeadTimeDays: number;
  paymentTerms?: string;
  notes?: string;
  syncToLinkedItems?: boolean;
}

export interface RecordSupplierOrderPayload {
  supplierName: string;
  reference: string;
  orderedAt?: string;
  expectedDeliveryAt?: string;
  occurredAt?: string;
  note?: string;
  items: Array<{
    inventoryItemId: string;
    quantity: number;
    unitCost?: number;
  }>;
}

export type OffHoursAlertChannel = 'system' | 'email' | 'both';
export type CriticalThresholdTriggerMode = 'below_minimum' | 'at_or_below_minimum';
export type CriticalAlertTriggerReason = 'weekend' | 'off_hours' | 'manual_test';
export type CriticalAlertEmailStatus =
  | 'sent'
  | 'logged_preview'
  | 'not_applicable'
  | 'failed';

export interface CriticalAlertScheduleConfig {
  enabled: boolean;
  channel: OffHoursAlertChannel;
  recipientEmails: string[];
  monitorWeekends: boolean;
  monitorOffHoursWeekdays: boolean;
  businessHoursStart: string; // HH:mm 24h
  businessHoursEnd: string; // HH:mm 24h
  timezone: string; // IANA timezone e.g. Asia/Manila
  triggerMode: CriticalThresholdTriggerMode;
  cooldownMinutes: number;
  updatedAt: string;
}

export interface CriticalAlertScheduleStatus {
  isOffHoursOrWeekend: boolean;
  triggerReason: 'weekend' | 'off_hours' | null;
  windowLabel: string;
  localTimeSummary: string;
}

export interface CriticalAlertEvent {
  id: string;
  inventoryItemId: string;
  itemName: string;
  sku: string;
  unit: string;
  quantityOnHand: number;
  criticalThreshold: number;
  channel: OffHoursAlertChannel;
  triggerReason: CriticalAlertTriggerReason;
  windowLabel: string;
  recipients: string[];
  emailStatus: CriticalAlertEmailStatus;
  emailStatusDetail: string;
  systemAlertStatus: 'active' | 'acknowledged';
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  triggeredAt: string;
}

