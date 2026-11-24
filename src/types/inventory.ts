export type InventoryItemType = 'consumable' | 'finished_product';
export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';

export interface InventorySupplierInfo {
  name: string;
  contact?: string;
  supplierSku?: string;
  leadTimeDays?: number;
}

export interface SupplyCategory {
  id: string;
  name: string;
  description: string;
  defaultUnit: string;
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
  unit: string;
  /** Physical stock currently in storage */
  quantityOnHand: number;
  /** Stock reserved/allocated to active print jobs */
  reservedQuantity?: number;
  /** Threshold at or below which low-stock warning triggers */
  reorderLevel: number;
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
  /** Optional structured supplier object mirrored from flat supplier fields */
  supplierInfo?: InventorySupplierInfo;
  storageLocation?: string;
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
  /** Record creation ISO date stamp */
  createdAt: string;
}

export interface StockAdjustmentPayload {
  movementType: StockMovementType;
  quantityDelta: number;
  note: string;
  reference?: string;
  referenceType?: StockMovementReferenceType;
  occurredAt?: string;
}

export interface InventoryStockFilter {
  search?: string;
  categoryId?: string;
  stockStatus?: StockStatus | 'all';
  itemType?: InventoryItemType | 'all';
}
