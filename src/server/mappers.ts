import crypto from 'crypto';
import path from 'path';
import { SUPPLIER_DOCS_DIR } from './db.ts';
import { inferReferenceType } from '../shared/inventoryModel.ts';
import type {
  InventoryItem,
  PrintJob,
  PrintService,
  ProductionStatus,
  StockMovement,
  StockMovementType,
  SupplierDocument,
  SupplierDocumentType,
  SupplierRecord,
  Transaction,
} from '../shared/types.ts';

export const MAX_SUPPLIER_DOC_BYTES = 3 * 1024 * 1024;

export const ALLOWED_SUPPLIER_DOC_MIMES: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

export const ALLOWED_SUPPLIER_DOC_TYPES = new Set<SupplierDocumentType>([
  'invoice',
  'contract',
  'pricing_agreement',
  'quote',
  'other',
]);

export function safeFinite(value: unknown, fallback = 0): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

export function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(fallback) && !Array.isArray(parsed)) {
      return fallback;
    }
    if (
      fallback !== null &&
      typeof fallback === 'object' &&
      !Array.isArray(fallback) &&
      (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    ) {
      return fallback;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function resolveSupplierDocPath(storageKey: string): string {
  const safeBase = path.basename(typeof storageKey === 'string' ? storageKey : '');
  if (!safeBase || safeBase === '.' || safeBase === '..') {
    throw new Error('Invalid storage key.');
  }
  const resolved = path.resolve(SUPPLIER_DOCS_DIR, safeBase);
  if (!resolved.startsWith(SUPPLIER_DOCS_DIR + path.sep)) {
    throw new Error('Document storage path escapes designated directory.');
  }
  return resolved;
}

export function sanitizeDownloadFilename(name: string): string {
  const cleaned = path
    .basename(typeof name === 'string' ? name : '')
    .replace(/[\r\n"\\/:*?<>|]+/g, '_')
    .trim();
  return cleaned || 'supplier-document';
}

export function mapInventoryItemRow(i: Record<string, unknown>): InventoryItem {
  const quantityOnHand = Number(i.quantity_on_hand) || 0;
  const reorderLevel = Number(i.reorder_level) || 0;
  const supplier = String(i.supplier || '');
  const supplierContact = String(i.supplier_contact || '');
  const supplierSku = String(i.supplier_sku || '');
  const leadTimeDays = Number(i.lead_time_days) || 0;
  const supplierPayload = supplier
    ? {
        name: supplier,
        contact: supplierContact,
        supplierSku,
        leadTimeDays,
      }
    : undefined;

  return {
    id: String(i.id),
    sku: String(i.sku),
    barcode: String(i.barcode || ''),
    name: String(i.name),
    categoryId: i.category_id ? String(i.category_id) : undefined,
    category: String(i.category),
    itemType: i.item_type as InventoryItem['itemType'],
    unit: String(i.unit),
    quantityOnHand,
    currentStock: quantityOnHand,
    reservedQuantity: Number(i.reserved_quantity) || 0,
    reorderLevel,
    reorderThreshold: reorderLevel,
    minimumThreshold: Number(i.minimum_threshold) || 0,
    reorderQuantity: Number(i.reorder_quantity) || Math.max(reorderLevel * 2, 0),
    unitCost: Number(i.unit_cost) || 0,
    supplier,
    supplierContact,
    supplierSku,
    leadTimeDays,
    supplierDetails: supplierPayload,
    supplierInfo: supplierPayload,
    storageLocation: String(i.storage_location || ''),
    lastRestockedAt: i.last_restocked_at ? String(i.last_restocked_at) : null,
    isDemo: i.is_demo === 1,
    createdAt: i.created_at ? String(i.created_at) : String(i.updated_at),
    updatedAt: String(i.updated_at),
  };
}

export function mapSupplierRow(s: Record<string, unknown>): SupplierRecord {
  return {
    id: String(s.id),
    name: String(s.name),
    contactPerson: String(s.contact_person || ''),
    phone: String(s.phone || ''),
    email: String(s.email || ''),
    address: String(s.address || ''),
    defaultLeadTimeDays: Math.max(0, Number(s.default_lead_time_days) || 0),
    paymentTerms: String(s.payment_terms || ''),
    notes: String(s.notes || ''),
    isDemo: s.is_demo === 1,
    createdAt: s.created_at ? String(s.created_at) : String(s.updated_at),
    updatedAt: String(s.updated_at),
  };
}

export function mapSupplierDocumentRow(d: Record<string, unknown>): SupplierDocument {
  const rawType = String(d.doc_type || 'other') as SupplierDocumentType;
  return {
    id: String(d.id),
    supplierId: d.supplier_id ? String(d.supplier_id) : undefined,
    supplierName: String(d.supplier_name),
    docType: ALLOWED_SUPPLIER_DOC_TYPES.has(rawType) ? rawType : 'other',
    title: String(d.title),
    referenceNumber: String(d.reference_number || ''),
    effectiveDate: String(d.effective_date || ''),
    expiryDate: String(d.expiry_date || ''),
    agreedTermsSummary: String(d.agreed_terms_summary || ''),
    fileName: String(d.file_name),
    mimeType: String(d.mime_type),
    fileSize: Math.max(0, Number(d.file_size) || 0),
    uploadedBy: String(d.uploaded_by || 'Staff'),
    createdAt: String(d.created_at),
    updatedAt: String(d.updated_at),
  };
}

export function mapStockMovementRow(m: Record<string, unknown>): StockMovement {
  const delta = Number(m.quantity_delta) || 0;
  const balanceAfter = Number(m.balance_after) || 0;
  const quantityBefore =
    m.quantity_before !== undefined && m.quantity_before !== null
      ? Number(m.quantity_before) || 0
      : Math.max(0, Number((balanceAfter - delta).toFixed(2)));
  const movementType = String(m.movement_type || 'adjustment') as StockMovementType;
  const createdAt = String(m.created_at);

  return {
    id: String(m.id),
    inventoryItemId: String(m.inventory_item_id),
    itemName: String(m.item_name),
    movementType,
    quantityBefore,
    quantityDelta: delta,
    balanceAfter,
    unitCostAtMovement: Number(m.unit_cost_at_movement) || 0,
    referenceType: (m.reference_type
      ? String(m.reference_type)
      : inferReferenceType(movementType)) as StockMovement['referenceType'],
    reference: String(m.reference || ''),
    performedById: String(m.performed_by_id || ''),
    performedBy: String(m.performed_by),
    note: String(m.note || ''),
    occurredAt: m.occurred_at ? String(m.occurred_at) : createdAt,
    orderedAt: m.ordered_at ? String(m.ordered_at) : undefined,
    expectedDeliveryAt: m.expected_delivery_at ? String(m.expected_delivery_at) : undefined,
    createdAt,
  };
}

export function mapServiceRow(row: Record<string, unknown>): PrintService {
  return {
    id: String(row.id),
    sku: String(row.sku),
    name: String(row.name),
    categoryId: String(row.category_id),
    description: String(row.description || ''),
    iconName: String(row.icon_name || 'Printer'),
    pricingMethod: row.pricing_method as PrintService['pricingMethod'],
    basePrice: Number(row.base_price) || 0,
    unitLabel: String(row.unit_label || 'pc'),
    costEstimate: Number(row.cost_estimate) || 0,
    requiresConfiguration: row.requires_configuration === 1,
    requiresProductionJob: row.requires_production_job === 1,
    allowCustomDimensions: row.allow_custom_dimensions === 1,
    allowPagesAndCopies: row.allow_pages_and_copies === 1,
    allowRushFee: row.allow_rush_fee === 1,
    rushFeePercent: Number(row.rush_fee_percent) || 0,
    defaultDesignFee: Number(row.default_design_fee) || 0,
    bulkTiers: parseJsonSafe(row.bulk_tiers_json as string, []),
    formulaExpression: String(row.formula_expression || ''),
    attributeGroups: parseJsonSafe(row.attribute_groups_json as string, []),
    consumables: parseJsonSafe(row.consumables_json as string, []),
    isFavorite: row.is_favorite === 1,
    isArchived: row.is_archived === 1,
    isDemo: row.is_demo === 1,
    updatedAt: String(row.updated_at),
  };
}

export function mapTransactionRow(row: Record<string, unknown>): Transaction {
  return {
    id: String(row.id),
    receiptNumber: String(row.receipt_number),
    clientMutationId: String(row.client_mutation_id),
    type: row.type as Transaction['type'],
    customerId: row.customer_id ? String(row.customer_id) : null,
    customerName: String(row.customer_name || 'Walk-in Customer'),
    cashierId: String(row.cashier_id),
    cashierName: String(row.cashier_name),
    shiftId: row.shift_id ? String(row.shift_id) : null,
    items: parseJsonSafe(row.items_json as string, []),
    subtotal: Number(row.subtotal) || 0,
    itemDiscountsTotal: Number(row.item_discounts_total) || 0,
    orderDiscountType: (row.order_discount_type as Transaction['orderDiscountType']) || 'none',
    orderDiscountValue: Number(row.order_discount_value) || 0,
    orderDiscountAmount: Number(row.order_discount_amount) || 0,
    taxAmount: Number(row.tax_amount) || 0,
    totalAmount: Number(row.total_amount) || 0,
    amountPaid: Number(row.amount_paid) || 0,
    changeAmount: Number(row.change_amount) || 0,
    balanceDue: Number(row.balance_due) || 0,
    paymentStatus: row.payment_status as Transaction['paymentStatus'],
    payments: parseJsonSafe(row.payments_json as string, []),
    notes: String(row.notes || ''),
    syncStatus: (row.sync_status as Transaction['syncStatus']) || 'synced',
    isDemo: row.is_demo === 1,
    createdAt: String(row.created_at),
    voidReason: row.void_reason ? String(row.void_reason) : undefined,
    refundReason: row.refund_reason ? String(row.refund_reason) : undefined,
  };
}

export function mapPrintJobRow(row: Record<string, unknown>): PrintJob {
  return {
    id: String(row.id),
    jobOrderNumber: String(row.job_order_number),
    transactionId: row.transaction_id ? String(row.transaction_id) : null,
    customerId: row.customer_id ? String(row.customer_id) : null,
    customerName: String(row.customer_name),
    customerPhone: String(row.customer_phone || ''),
    title: String(row.title),
    specifications: String(row.specifications || ''),
    attachmentNames: parseJsonSafe(row.attachment_names_json as string, []),
    instructions: String(row.instructions || ''),
    assignedOperator: String(row.assigned_operator || ''),
    productionStatus: row.production_status as ProductionStatus,
    paymentStatus: row.payment_status as PrintJob['paymentStatus'],
    totalAmount: Number(row.total_amount) || 0,
    depositAmount: Number(row.deposit_amount) || 0,
    remainingBalance: Number(row.remaining_balance) || 0,
    estimatedCompletion: String(row.estimated_completion),
    deadline: String(row.deadline),
    history: parseJsonSafe(row.history_json as string, []),
    isDemo: row.is_demo === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
