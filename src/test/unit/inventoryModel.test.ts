import { describe, it, expect } from 'vitest';
import {
  buildInventoryAlertNotifications,
  buildReorderRequestList,
  calculateInventoryValuation,
  computeSignedStockDelta,
  filterInventoryItems,
  findDuplicateSkuItem,
  generateUniqueInventorySku,
  getAvailableStock,
  getInventoryStockStatus,
  getSuggestedRestockQuantity,
  isBelowMinimumThreshold,
  validateInventoryItemInput,
  validateStockMovementInput,
} from '../../shared/inventoryModel.ts';
import { DEFAULT_SUPPLY_CATEGORIES, DEMO_INVENTORY } from '../../shared/defaults.ts';
import type { InventoryItem } from '../../types/inventory.ts';

describe('inventoryModel', () => {
  it('determines stock status, available stock, and minimum threshold breaches', () => {
    expect(getAvailableStock({ quantityOnHand: 100, reservedQuantity: 25 })).toBe(75);
    expect(getAvailableStock({ quantityOnHand: 10, reservedQuantity: 30 })).toBe(0);

    expect(getInventoryStockStatus({ quantityOnHand: 0, reorderLevel: 20 })).toBe('out_of_stock');
    expect(getInventoryStockStatus({ quantityOnHand: 20, reorderLevel: 20 })).toBe('low_stock');
    expect(getInventoryStockStatus({ quantityOnHand: 25, reorderLevel: 20 })).toBe('in_stock');

    expect(isBelowMinimumThreshold({ quantityOnHand: 9, minimumThreshold: 10 })).toBe(true);
    expect(isBelowMinimumThreshold({ quantityOnHand: 10, minimumThreshold: 10 })).toBe(false);
    expect(isBelowMinimumThreshold({ quantityOnHand: 0, minimumThreshold: 0 })).toBe(false);
  });

  it('computes signed stock deltas accurately by movement type', () => {
    expect(computeSignedStockDelta('purchase', -25)).toBe(25);
    expect(computeSignedStockDelta('return', 5)).toBe(5);
    expect(computeSignedStockDelta('wastage', 10)).toBe(-10);
    expect(computeSignedStockDelta('damaged', -4)).toBe(-4);
    expect(computeSignedStockDelta('sale_deduction', 12)).toBe(-12);
    expect(computeSignedStockDelta('adjustment', -7)).toBe(-7);
    expect(computeSignedStockDelta('adjustment', 7)).toBe(7);
  });

  it('generates collision-free SKUs from category and supplier prefixes', () => {
    const first = generateUniqueInventorySku({
      categoryId: 'sup-cat-paper',
      categoryName: 'Paper',
      supplier: 'PaperOne Supply Inc.',
      existingItems: [],
    });
    expect(first.sku).toBe('PAP-PAP-001');
    expect(first.sequence).toBe(1);

    const second = generateUniqueInventorySku({
      categoryId: 'sup-cat-paper',
      categoryName: 'Paper',
      supplier: 'PaperOne Supply',
      existingItems: [{ id: 'i1', sku: 'PAP-PAP-001' }],
    });
    expect(second.sku).toBe('PAP-PAP-002');
    expect(second.sequence).toBe(2);

    expect(
      findDuplicateSkuItem('  pap-pap-001 ', [{ id: 'i1', sku: 'PAP-PAP-001', name: 'A4' }]),
    )?.toMatchObject({ id: 'i1' });
    expect(
      findDuplicateSkuItem('PAP-PAP-001', [{ id: 'i1', sku: 'PAP-PAP-001', name: 'A4' }], 'i1'),
    ).toBeUndefined();
  });

  it('builds alerts and reorder request lists for simultaneous minimum breaches', () => {
    // DEMO_INVENTORY has inv-lam-film (75 < min 80) and inv-ink-set (2 < min 4)
    const alertSummary = buildInventoryAlertNotifications(DEMO_INVENTORY);
    expect(alertSummary.belowMinimumItems.map((i) => i.id)).toEqual(
      expect.arrayContaining(['inv-lam-film', 'inv-ink-set']),
    );
    expect(alertSummary.hasSimultaneousBreach).toBe(true);
    expect(alertSummary.notifications[0]?.kind).toBe('simultaneous_minimum_breach');

    const reorderList = buildReorderRequestList(DEMO_INVENTORY, 'below_minimum');
    expect(reorderList.length).toBe(2);
    expect(reorderList.every((r) => r.isBelowMinimum && r.recommendedOrderQty > 0)).toBe(true);
  });

  it('filters inventory items by stock status, item type, category, and search query', () => {
    const lowStock = filterInventoryItems(
      DEMO_INVENTORY,
      { search: '', categoryId: 'all', stockStatus: 'low_stock', itemType: 'all' },
      DEFAULT_SUPPLY_CATEGORIES,
    );
    expect(lowStock.length).toBeGreaterThanOrEqual(3);

    const finished = filterInventoryItems(
      DEMO_INVENTORY,
      { search: 'lanyard', categoryId: 'sup-cat-id-merch', stockStatus: 'all', itemType: 'finished_product' },
      DEFAULT_SUPPLY_CATEGORIES,
    );
    expect(finished).toHaveLength(1);
    expect(finished[0].id).toBe('inv-id-lace');
  });

  it('validates inventory items, movements, valuation, and suggested restock qty', () => {
    expect(validateInventoryItemInput({ name: '', unit: 'pc' }).valid).toBe(false);
    expect(validateInventoryItemInput({ name: 'A4', unit: '' }).valid).toBe(false);
    expect(validateInventoryItemInput({ name: 'A4', unit: 'sheet', quantityOnHand: -1 }).valid).toBe(false);
    expect(validateInventoryItemInput({ name: 'A4', unit: 'sheet', minimumThreshold: -5 }).valid).toBe(false);
    expect(validateInventoryItemInput({ name: 'A4', unit: 'sheet', unitCost: -2 }).valid).toBe(false);
    expect(validateInventoryItemInput({ name: 'A4', unit: 'sheet', quantityOnHand: 10 }).valid).toBe(true);

    expect(validateStockMovementInput({ movementType: 'purchase', quantityDelta: 0 }).valid).toBe(false);
    expect(validateStockMovementInput({ movementType: 'purchase', quantityDelta: 5 }).valid).toBe(true);

    const mini: InventoryItem[] = [
      { ...DEMO_INVENTORY[0], quantityOnHand: 10, unitCost: 2.5, reorderLevel: 20, reorderQuantity: 0 },
      { ...DEMO_INVENTORY[1], quantityOnHand: 4, unitCost: 10, reorderLevel: 2, reorderQuantity: 10 },
    ];
    expect(calculateInventoryValuation(mini)).toBe(65);
    expect(getSuggestedRestockQuantity(mini[0])).toBe(30); // 20*2 - 10
    expect(getSuggestedRestockQuantity(mini[1])).toBe(0); // above reorder
  });

  it('rejects non-finite, extreme, and malformed inventory inputs and handles nullish collections', () => {
    expect(validateInventoryItemInput({ name: 'A4', unit: 'sheet', quantityOnHand: Number.NaN }).valid).toBe(false);
    expect(validateInventoryItemInput({ name: 'A4', unit: 'sheet', unitCost: Number.POSITIVE_INFINITY }).valid).toBe(false);
    expect(validateInventoryItemInput({ name: 'A4', unit: 'sheet', reorderLevel: 2e9 }).valid).toBe(false);
    expect(validateStockMovementInput({ movementType: 'purchase', quantityDelta: Number.NaN }).valid).toBe(false);
    expect(validateStockMovementInput({ movementType: 'purchase', quantityDelta: Number.POSITIVE_INFINITY }).valid).toBe(false);
    expect(validateStockMovementInput({ movementType: 'purchase', quantityDelta: 5e7 }).valid).toBe(false);

    expect(calculateInventoryValuation(null as unknown as InventoryItem[])).toBe(0);
    expect(filterInventoryItems(null as unknown as InventoryItem[], { search: 'a4' })).toEqual([]);
    expect(buildInventoryAlertNotifications(null as unknown as InventoryItem[]).notifications).toEqual([]);
  });
});
