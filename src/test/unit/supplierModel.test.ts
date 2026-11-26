import { describe, it, expect } from 'vitest';
import { buildSupplierDirectory, normalizeSupplierRecord } from '../../shared/supplierModel.ts';
import type {
  InventoryItem,
  PredictiveReorderForecast,
  StockMovement,
  SupplierDocument,
  SupplierRecord,
} from '../../types/inventory.ts';

describe('supplierModel', () => {
  it('normalizes supplier records and trims fields safely', () => {
    const normalized = normalizeSupplierRecord({
      id: 'sup-1',
      name: '  PaperOne Supply  ',
      contactPerson: ' Ana ',
      phone: ' 09171234567 ',
      defaultLeadTimeDays: -3,
    });
    expect(normalized.name).toBe('PaperOne Supply');
    expect(normalized.contactPerson).toBe('Ana');
    expect(normalized.phone).toBe('09171234567');
    expect(normalized.defaultLeadTimeDays).toBe(0);
  });

  it('aggregates SKUs, PO history, delivery timeliness, cost variance, and documents', () => {
    const suppliers: SupplierRecord[] = [
      normalizeSupplierRecord({
        id: 'sup-alpha',
        name: 'Alpha Paper Co',
        defaultLeadTimeDays: 2,
        paymentTerms: 'Net 15',
      }),
    ];

    const inventory: InventoryItem[] = [
      {
        id: 'inv-1',
        sku: 'PAP-A4-01',
        name: 'A4 Bond',
        category: 'Paper',
        itemType: 'consumable',
        unit: 'sheet',
        quantityOnHand: 100,
        reorderLevel: 50,
        minimumThreshold: 20,
        unitCost: 11,
        supplier: 'Alpha Paper Co',
        supplierContact: '+63 917 555 0100',
        leadTimeDays: 2,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-10T00:00:00.000Z',
      },
      {
        id: 'inv-2',
        sku: 'INK-BK-01',
        name: 'Pigment Black',
        category: 'Ink & Toner',
        itemType: 'consumable',
        unit: 'bottle',
        quantityOnHand: 2,
        reorderLevel: 5,
        minimumThreshold: 3,
        unitCost: 200,
        supplier: 'Beta Ink Hub',
        supplierContact: 'orders@betaink.local',
        leadTimeDays: 4,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-10T00:00:00.000Z',
      },
    ];

    const stockMovements: StockMovement[] = [
      {
        id: 'mov-init',
        inventoryItemId: 'inv-1',
        itemName: 'A4 Bond',
        movementType: 'initial_stock',
        quantityBefore: 0,
        quantityDelta: 50,
        balanceAfter: 50,
        unitCostAtMovement: 10,
        referenceType: 'system',
        reference: 'INIT',
        performedById: 'u1',
        performedBy: 'Admin',
        note: '',
        occurredAt: '2026-02-01T08:00:00.000Z',
        createdAt: '2026-02-01T08:00:00.000Z',
      },
      {
        id: 'mov-po1',
        inventoryItemId: 'inv-1',
        itemName: 'A4 Bond',
        movementType: 'purchase',
        quantityBefore: 50,
        quantityDelta: 50,
        balanceAfter: 100,
        unitCostAtMovement: 11, // +10% variance from 10
        referenceType: 'purchase_order',
        reference: 'PO-101',
        performedById: 'u1',
        performedBy: 'Admin',
        note: 'First PO',
        orderedAt: '2026-02-05T08:00:00.000Z',
        expectedDeliveryAt: '2026-02-07T08:00:00.000Z',
        occurredAt: '2026-02-07T09:00:00.000Z', // 0 days late, 2d transit -> on time
        createdAt: '2026-02-07T09:00:00.000Z',
      },
      {
        id: 'mov-po2',
        inventoryItemId: 'inv-1',
        itemName: 'A4 Bond',
        movementType: 'purchase',
        quantityBefore: 80,
        quantityDelta: 20,
        balanceAfter: 100,
        unitCostAtMovement: 11, // 0% variance from 11
        referenceType: 'purchase_order',
        reference: 'PO-102',
        performedById: 'u1',
        performedBy: 'Admin',
        note: 'Second PO',
        orderedAt: '2026-02-10T08:00:00.000Z',
        expectedDeliveryAt: '2026-02-12T08:00:00.000Z',
        occurredAt: '2026-02-14T08:00:00.000Z', // 2 days late, 4d transit
        createdAt: '2026-02-14T08:00:00.000Z',
      },
    ];

    const forecasts: PredictiveReorderForecast[] = [
      {
        inventoryItemId: 'inv-2',
        sku: 'INK-BK-01',
        name: 'Pigment Black',
        category: 'Ink & Toner',
        unit: 'bottle',
        currentStock: 2,
        minimumThreshold: 3,
        reorderLevel: 5,
        thresholdBaseline: 5,
        leadTimeDays: 4,
        lookbackDays: 30,
        targetCoverageDays: 14,
        salesConsumedUnits: 10,
        otherUsageUnits: 5,
        totalConsumedUnits: 15,
        recent7dDailyVelocity: 0.5,
        windowDailyVelocity: 0.5,
        weightedDailyVelocity: 0.5,
        weeklyDemand: 3.5,
        daysUntilThreshold: 0,
        daysUntilStockout: 4,
        projectedStockoutDate: '2026-02-15T00:00:00.000Z',
        isBelowMinimum: true,
        isAtReorder: true,
        isNearingThreshold: true,
        urgencyScore: 95,
        suggestedOrderQty: 10,
        configuredOrderQty: 10,
        unitCost: 200,
        estimatedOrderCost: 2000,
        supplierName: 'Beta Ink Hub',
        supplierContact: 'orders@betaink.local',
        supplierSku: 'BIH-BK-01',
        confidence: 'high',
        rationale: 'Below minimum',
      },
    ];

    const docs: SupplierDocument[] = [
      {
        id: 'doc-1',
        supplierId: 'sup-alpha',
        supplierName: 'Alpha Paper Co',
        docType: 'contract',
        title: 'Annual Paper SLA',
        referenceNumber: 'SLA-2026',
        effectiveDate: '2026-01-01',
        expiryDate: '2026-12-31',
        agreedTermsSummary: 'Net 15 locked pricing',
        fileName: 'sla.pdf',
        mimeType: 'application/pdf',
        fileSize: 1024,
        uploadedBy: 'Admin',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ];

    const directory = buildSupplierDirectory({
      suppliers,
      inventory,
      stockMovements,
      forecasts,
      supplierDocuments: docs,
    });

    // Beta Ink Hub has urgent lead-time risk so it sorts first
    expect(directory).toHaveLength(2);
    expect(directory[0].name).toBe('Beta Ink Hub');
    expect(directory[0].email).toBe('orders@betaink.local');
    expect(directory[0].leadTimeRiskCount).toBe(1);
    expect(directory[0].recommendedOrderSpend).toBe(2000);

    const alpha = directory.find((s) => s.name === 'Alpha Paper Co')!;
    expect(alpha.phone).toBe('+63 917 555 0100');
    expect(alpha.totalOrderCount).toBe(2);
    expect(alpha.totalOrderSpend).toBe(770); // 50*11 + 20*11
    expect(alpha.onTimeDeliveryRate).toBe(50); // 1 of 2 on time
    expect(alpha.avgActualDeliveryDays).toBe(3); // (2 + 4) / 2
    expect(alpha.avgCostVariancePct).toBe(5); // (10 + 0) / 2
    expect(alpha.documents).toHaveLength(1);
    expect(alpha.historicalOrders[0].reference).toBe('PO-102'); // sorted newest first
  });
});
