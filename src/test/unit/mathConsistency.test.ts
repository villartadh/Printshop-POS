import { describe, expect, it } from 'vitest';
import {
  calculateCartItemTotals,
  calculateOrderTotals,
  calculateServicePrice,
  convertToFeet,
  convertToMeters,
  evaluateFormulaExpression,
  getDefaultServiceSelection,
  recalculateCartItemQuantity,
  roundAmount,
} from '../../shared/pricingEngine.ts';
import {
  allocateTransactionPaymentsByMethod,
  computeDashboardMetrics,
  computeProfitAndLossReport,
} from '../../shared/financeModel.ts';
import {
  buildReorderRequestList,
  calculateInventoryValuation,
  getAvailableStock,
} from '../../shared/inventoryModel.ts';
import { computePredictiveReorderForecasts } from '../../shared/predictiveReorderEngine.ts';
import { buildSupplierDirectory, normalizeSupplierRecord } from '../../shared/supplierModel.ts';
import { DEFAULT_SETTINGS, DEMO_CATEGORIES, DEMO_SERVICES } from '../../shared/defaults.ts';
import type {
  CartItem,
  Customer,
  ExpenseRecord,
  InventoryItem,
  PrintService,
  StockMovement,
  TaxAndCurrencyConfig,
  Transaction,
} from '../../shared/types.ts';

const baseCurrency: TaxAndCurrencyConfig = {
  ...DEFAULT_SETTINGS.taxAndCurrency,
  currencyCode: 'PHP',
  currencySymbol: '₱',
  decimalPlaces: 2,
  taxEnabled: false,
  taxRatePercent: 12,
  taxInclusive: true,
  roundingMode: 'none',
};

describe('Mathematical System Consistency & Domain Invariants', () => {
  describe('1. Unit Conversion Symmetry & Dimensional Consistency', () => {
    it('maintains exact SI <-> Imperial round-trip invertibility across ft, in, cm, and m', () => {
      const units = ['ft', 'in', 'cm', 'm'] as const;
      const sampleValues = [0.5, 1, 2.5, 12, 30.48, 100, 250];

      expect(convertToMeters(1, 'm')).toBe(1);
      expect(convertToMeters(100, 'cm')).toBe(1);
      expect(convertToFeet(12, 'in')).toBe(1);
      expect(convertToFeet(0.3048, 'm')).toBe(1);

      for (const unit of units) {
        for (const value of sampleValues) {
          const feet = convertToFeet(value, unit);
          const meters = convertToMeters(value, unit);
          expect(meters).toBeCloseTo(feet * 0.3048, 10);
          expect(convertToFeet(meters, 'm')).toBeCloseTo(feet, 10);
        }
      }
    });

    it('produces identical per_sqft area regardless of equivalent dimension units', () => {
      const tarpService = DEMO_SERVICES.find((s) => s.id === 'srv-tarpaulin')!;
      const ftConfig = {
        ...getDefaultServiceSelection(tarpService),
        width: 4,
        height: 3,
        dimensionUnit: 'ft' as const,
        quantity: 2,
      };
      const inConfig = {
        ...ftConfig,
        width: 48,
        height: 36,
        dimensionUnit: 'in' as const,
      };
      const cmConfig = {
        ...ftConfig,
        width: 121.92,
        height: 91.44,
        dimensionUnit: 'cm' as const,
      };

      const ftPrice = calculateServicePrice(tarpService, ftConfig, baseCurrency);
      const inPrice = calculateServicePrice(tarpService, inConfig, baseCurrency);
      const cmPrice = calculateServicePrice(tarpService, cmConfig, baseCurrency);

      expect(ftPrice.areaSqFt).toBe(12);
      expect(inPrice.areaSqFt).toBe(12);
      expect(cmPrice.areaSqFt).toBe(12);
      expect(ftPrice.lineSubtotal).toBe(inPrice.lineSubtotal);
      expect(ftPrice.lineSubtotal).toBe(cmPrice.lineSubtotal);
    });
  });

  describe('2. Pricing, Bulk Tiers, Cart Quantity & Tax/Discount Conservation', () => {
    it('recalculates cart quantity updates with bulk tiers, fixed fees, and proportional COGS', () => {
      const bwService = DEMO_SERVICES.find((s) => s.id === 'srv-bw-print')!;
      const initialSel = {
        ...getDefaultServiceSelection(bwService),
        pages: 20,
        copies: 2, // 40 effective pages -> tier < 50 (basePrice = 3.00)
        designFee: 50,
        laborFee: 10,
      };
      const initCalc = calculateServicePrice(bwService, initialSel, baseCurrency);
      const initialItem: CartItem = {
        id: 'ci-bw-1',
        serviceId: bwService.id,
        sku: bwService.sku,
        serviceName: bwService.name,
        pricingMethod: bwService.pricingMethod,
        unitLabel: bwService.unitLabel,
        unitPrice: initCalc.unitPrice,
        effectiveQuantity: initCalc.effectiveQuantity,
        displaySummary: initCalc.displaySummary,
        config: initialSel,
        discountType: 'none',
        discountValue: 0,
        lineSubtotal: initCalc.lineSubtotal,
        lineDiscount: 0,
        lineTotal: initCalc.lineSubtotal,
        costTotal: initCalc.estimatedCost,
        requiresProductionJob: false,
        consumables: bwService.consumables,
      };

      // Update copies from 2 to 3 -> 60 effective pages -> hits >=50 bulk tier (2.50/page)
      // Fixed designFee (50) + laborFee (10) = 60 must NOT be multiplied by copies!
      const updated = recalculateCartItemQuantity(initialItem, 3, bwService, baseCurrency);
      expect(updated.config.copies).toBe(3);
      expect(updated.effectiveQuantity).toBe(60);
      expect(updated.unitPrice).toBe(2.5);
      expect(updated.lineSubtotal).toBe(2.5 * 60 + 60); // 210, NOT scaled linearly
      expect(updated.costTotal).toBe(
        roundAmount(bwService.costEstimate * 60, baseCurrency),
      );
    });

    it('preserves tax and discount conservation identities across randomized order configurations', () => {
      const configExclusive: TaxAndCurrencyConfig = {
        ...baseCurrency,
        taxEnabled: true,
        taxRatePercent: 12,
        taxInclusive: false,
      };
      const configInclusive: TaxAndCurrencyConfig = {
        ...baseCurrency,
        taxEnabled: true,
        taxRatePercent: 12,
        taxInclusive: true,
      };

      const itemA: CartItem = {
        id: 'a',
        serviceId: 's1',
        sku: 'S1',
        serviceName: 'Service A',
        pricingMethod: 'per_piece',
        unitLabel: 'pc',
        unitPrice: 125.5,
        effectiveQuantity: 3,
        displaySummary: '3 pcs',
        config: getDefaultServiceSelection(DEMO_SERVICES[0]),
        discountType: 'percent',
        discountValue: 15,
        lineSubtotal: 376.5,
        ...calculateCartItemTotals(
          {
            id: 'a',
            serviceId: 's1',
            sku: 'S1',
            serviceName: 'Service A',
            pricingMethod: 'per_piece',
            unitLabel: 'pc',
            unitPrice: 125.5,
            effectiveQuantity: 3,
            displaySummary: '3 pcs',
            config: getDefaultServiceSelection(DEMO_SERVICES[0]),
            discountType: 'percent',
            discountValue: 15,
            lineSubtotal: 376.5,
            costTotal: 90,
            requiresProductionJob: false,
            consumables: [],
          },
          baseCurrency,
        ),
        costTotal: 90,
        requiresProductionJob: false,
        consumables: [],
      };

      const excl = calculateOrderTotals([itemA], 'percent', 10, configExclusive);
      const taxableNet = roundAmount(
        excl.subtotal - excl.itemDiscountsTotal - excl.orderDiscountAmount,
        configExclusive,
      );
      expect(excl.totalAmount).toBe(roundAmount(taxableNet + excl.taxAmount, configExclusive));
      expect(excl.totalAmount).toBeGreaterThanOrEqual(0);

      const incl = calculateOrderTotals([itemA], 'percent', 10, configInclusive);
      expect(incl.totalAmount).toBe(taxableNet);
      const impliedPreTax = roundAmount(incl.totalAmount / 1.12, configInclusive);
      expect(Math.abs(impliedPreTax + incl.taxAmount - incl.totalAmount)).toBeLessThanOrEqual(0.01);

      // Extreme discount >= 100% clamps cleanly at 0
      const zeroed = calculateOrderTotals([itemA], 'percent', 250, configExclusive);
      expect(zeroed.totalAmount).toBe(0);
      expect(zeroed.taxAmount).toBe(0);
      expect(zeroed.orderDiscountAmount).toBe(
        roundAmount(excl.subtotal - excl.itemDiscountsTotal, configExclusive),
      );
    });

    it('enforces idempotence across all rounding modes and safe AST precedence', () => {
      const modes = ['none', 'nearest_0_25', 'nearest_1'] as const;
      for (const mode of modes) {
        const cfg = { ...baseCurrency, roundingMode: mode };
        for (const val of [0, 0.01, 12.345, 99.99, 1234.567]) {
          const once = roundAmount(val, cfg);
          const twice = roundAmount(once, cfg);
          expect(twice).toBe(once);
        }
      }

      // AST precedence: 2 + 3 * 4 = 14, (2 + 3) * 4 = 20
      expect(evaluateFormulaExpression('2 + 3 * 4', {})).toBe(14);
      expect(evaluateFormulaExpression('(2 + 3) * 4', {})).toBe(20);
      expect(evaluateFormulaExpression('100 / (5 - 5)', {})).toBeNull();
    });
  });

  describe('3. Financial Analytics, Cash Change Netting & Range Consistency', () => {
    const now = Date.parse('2026-06-15T14:00:00.000Z');
    const makeSale = (overrides: Partial<Transaction>): Transaction => ({
      id: 't1',
      receiptNumber: 'OR-001',
      clientMutationId: 'm1',
      type: 'sale',
      customerId: null,
      customerName: 'Walk-in',
      cashierId: 'u1',
      cashierName: 'Cashier 1',
      shiftId: 's1',
      items: [
        {
          id: 'ci1',
          serviceId: DEMO_SERVICES[0].id,
          sku: DEMO_SERVICES[0].sku,
          serviceName: DEMO_SERVICES[0].name,
          pricingMethod: 'per_piece',
          unitLabel: 'pc',
          unitPrice: 600,
          effectiveQuantity: 1,
          displaySummary: '1 pc',
          config: getDefaultServiceSelection(DEMO_SERVICES[0]),
          discountType: 'none',
          discountValue: 0,
          lineSubtotal: 600,
          lineDiscount: 0,
          lineTotal: 600,
          costTotal: 200,
          requiresProductionJob: false,
          consumables: [],
        },
      ],
      subtotal: 600,
      itemDiscountsTotal: 0,
      orderDiscountType: 'none',
      orderDiscountValue: 0,
      orderDiscountAmount: 0,
      taxAmount: 0,
      totalAmount: 600,
      amountPaid: 600,
      changeAmount: 0,
      balanceDue: 0,
      paymentStatus: 'paid',
      payments: [],
      notes: '',
      syncStatus: 'synced',
      createdAt: '2026-06-15T10:00:00.000Z',
      ...overrides,
    });

    it('nets cash change out of payment breakdowns so sum(paymentBreakdown) === sum(amountPaid)', () => {
      const cashOverTender = makeSale({
        id: 't-cash-change',
        totalAmount: 600,
        amountPaid: 600,
        changeAmount: 400,
        payments: [
          {
            id: 'p1',
            methodId: 'cash',
            methodName: 'Cash',
            methodType: 'cash',
            amount: 1000,
            referenceNumber: '',
            verificationStatus: 'verified',
            paidAt: '2026-06-15T10:00:00.000Z',
          },
        ],
      });

      const splitWithChange = makeSale({
        id: 't-split',
        totalAmount: 600,
        amountPaid: 600,
        changeAmount: 100,
        payments: [
          {
            id: 'p2',
            methodId: 'gcash',
            methodName: 'GCash',
            methodType: 'ewallet',
            amount: 200,
            referenceNumber: 'GC-1',
            verificationStatus: 'verified',
            paidAt: '2026-06-15T11:00:00.000Z',
          },
          {
            id: 'p3',
            methodId: 'cash',
            methodName: 'Cash',
            methodType: 'cash',
            amount: 500,
            referenceNumber: '',
            verificationStatus: 'verified',
            paidAt: '2026-06-15T11:00:00.000Z',
          },
        ],
      });

      const map = allocateTransactionPaymentsByMethod([cashOverTender, splitWithChange]);
      expect(map.get('Cash')).toBe(1000); // 600 + 400 (NOT 1500!)
      expect(map.get('GCash')).toBe(200);
      const breakdownTotal = Array.from(map.values()).reduce((s, v) => s + v, 0);
      expect(breakdownTotal).toBe(1200); // Matches amountPaid (600 + 600)
    });

    it('applies consistent date-range filtering to expenses and excludes voided/refunded sales in Dashboard & P&L', () => {
      const todaySale = makeSale({
        id: 't-today',
        createdAt: '2026-06-15T09:00:00.000Z',
        payments: [
          {
            id: 'p1',
            methodId: 'cash',
            methodName: 'Cash',
            methodType: 'cash',
            amount: 1000,
            referenceNumber: '',
            verificationStatus: 'verified',
            paidAt: '2026-06-15T09:00:00.000Z',
          },
        ],
        changeAmount: 400,
      });
      const voidedSale = makeSale({
        id: 't-void',
        paymentStatus: 'voided',
        totalAmount: 999,
      });
      const oldSale = makeSale({
        id: 't-old',
        totalAmount: 1200,
        amountPaid: 1200,
        createdAt: '2026-06-01T09:00:00.000Z',
      });

      const expenses: ExpenseRecord[] = [
        {
          id: 'e-today',
          category: 'electricity',
          description: 'Electricity today',
          amount: 100,
          vendor: 'Meralco',
          recordedBy: 'Admin',
          expenseDate: '2026-06-15',
          createdAt: '2026-06-15T08:00:00.000Z',
        },
        {
          id: 'e-old',
          category: 'rent',
          description: 'Last month rent',
          amount: 15000,
          vendor: 'Landlord',
          recordedBy: 'Admin',
          expenseDate: '2026-05-20',
          createdAt: '2026-05-20T08:00:00.000Z',
        },
      ];
      const customers: Customer[] = [
        {
          id: 'c1',
          name: 'Client A',
          phone: '',
          email: '',
          address: '',
          group: 'regular',
          discountPercent: 0,
          loyaltyPoints: 0,
          outstandingBalance: 350,
          totalSpent: 600,
          notes: '',
          createdAt: '2026-06-01T00:00:00.000Z',
        },
      ];

      const validSales = [todaySale, oldSale];
      const todayDash = computeDashboardMetrics({
        validSales,
        expenses,
        customers,
        printJobs: [],
        inventory: [],
        range: 'today',
        nowMs: now,
      });

      // Today range: revenue = 600, cost = 200 -> gross = 400; today expense = 100 -> net = 300
      expect(todayDash.todaySales).toBe(600);
      expect(todayDash.grossProfit).toBe(400);
      expect(todayDash.totalExpenses).toBe(100);
      expect(todayDash.netProfit).toBe(300);
      expect(todayDash.paymentBreakdown).toEqual([{ label: 'Cash', value: 600 }]);

      const pnl = computeProfitAndLossReport({
        rangedTxns: [todaySale, voidedSale],
        rangedExpenses: [expenses[0]],
        customers,
        services: DEMO_SERVICES,
        categories: DEMO_CATEGORIES,
      });
      expect(pnl.revenue).toBe(600);
      expect(pnl.cashReceived).toBe(600);
      expect(pnl.receivables).toBe(350);
      expect(pnl.estimatedMaterialCost).toBe(200);
      expect(pnl.grossProfit).toBe(400);
      expect(pnl.operatingExpenses).toBe(100);
      expect(pnl.netProfit).toBe(300);
      expect(pnl.byPayment).toEqual([{ label: 'Cash', value: 600 }]);
    });
  });

  describe('4. Inventory Valuation, Predictive Reorder & Supplier Analytics Invariants', () => {
    it('prevents POS + sale_deduction double-counting and aligns forecasts with reorder list costs', () => {
      const nowMs = Date.parse('2026-06-15T12:00:00.000Z');
      const items: InventoryItem[] = [
        {
          id: 'inv-paper',
          sku: 'PAP-A4-01',
          name: 'A4 Paper',
          category: 'Paper',
          itemType: 'consumable',
          unit: 'sheet',
          quantityOnHand: 40,
          reservedQuantity: 15,
          reorderLevel: 50,
          minimumThreshold: 20,
          reorderQuantity: 100,
          unitCost: 2.5,
          supplier: 'PaperOne',
          leadTimeDays: 3,
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-06-15T00:00:00.000Z',
        },
      ];

      expect(getAvailableStock(items[0])).toBe(25);
      expect(calculateInventoryValuation(items)).toBe(100);

      const customService: PrintService = {
        ...DEMO_SERVICES[0],
        id: 'srv-a4-test',
        consumables: [{ inventoryItemId: 'inv-paper', quantityPerUnit: 1 }],
      };

      const txns: Transaction[] = [
        {
          id: 'txn-1',
          receiptNumber: 'OR-DUP-100',
          clientMutationId: 'mut-1',
          type: 'sale',
          customerId: null,
          customerName: 'Walk-in',
          cashierId: 'u1',
          cashierName: 'Cashier',
          shiftId: null,
          items: [
            {
              id: 'ci1',
              serviceId: customService.id,
              sku: customService.sku,
              serviceName: customService.name,
              pricingMethod: 'per_page',
              unitLabel: 'page',
              unitPrice: 5,
              effectiveQuantity: 35,
              displaySummary: '35 pages',
              config: getDefaultServiceSelection(customService),
              discountType: 'none',
              discountValue: 0,
              lineSubtotal: 175,
              lineDiscount: 0,
              lineTotal: 175,
              costTotal: 87.5,
              requiresProductionJob: false,
              consumables: [{ inventoryItemId: 'inv-paper', quantityPerUnit: 1 }],
            },
          ],
          subtotal: 175,
          itemDiscountsTotal: 0,
          orderDiscountType: 'none',
          orderDiscountValue: 0,
          orderDiscountAmount: 0,
          taxAmount: 0,
          totalAmount: 175,
          amountPaid: 175,
          changeAmount: 0,
          balanceDue: 0,
          paymentStatus: 'paid',
          payments: [],
          notes: '',
          syncStatus: 'synced',
          createdAt: '2026-06-14T10:00:00.000Z',
        },
      ];

      // Corresponding stock movement shares receiptNumber OR-DUP-100 -> must NOT be counted twice
      const movements: StockMovement[] = [
        {
          id: 'mov-sale-1',
          inventoryItemId: 'inv-paper',
          itemName: 'A4 Paper',
          movementType: 'sale_deduction',
          quantityBefore: 75,
          quantityDelta: -35,
          balanceAfter: 40,
          unitCostAtMovement: 2.5,
          referenceType: 'sale',
          reference: 'OR-DUP-100',
          performedById: 'u1',
          performedBy: 'Cashier',
          note: '',
          occurredAt: '2026-06-14T10:00:00.000Z',
          createdAt: '2026-06-14T10:00:00.000Z',
        },
        {
          id: 'mov-waste-1',
          inventoryItemId: 'inv-paper',
          itemName: 'A4 Paper',
          movementType: 'wastage',
          quantityBefore: 80,
          quantityDelta: -5,
          balanceAfter: 75,
          unitCostAtMovement: 2.5,
          referenceType: 'manual',
          reference: 'WASTE-1',
          performedById: 'u1',
          performedBy: 'Admin',
          note: '',
          occurredAt: '2026-06-13T10:00:00.000Z',
          createdAt: '2026-06-13T10:00:00.000Z',
        },
      ];

      const forecasts = computePredictiveReorderForecasts({
        inventory: items,
        transactions: txns,
        services: [customService],
        stockMovements: movements,
        lookbackDays: 30,
        targetCoverageDays: 30,
        nowMs,
      });

      expect(forecasts).toHaveLength(1);
      const fc = forecasts[0];
      expect(fc.salesConsumedUnits).toBe(35); // Not 70!
      expect(fc.otherUsageUnits).toBe(5);
      expect(fc.totalConsumedUnits).toBe(40);
      expect(fc.estimatedOrderCost).toBe(Number((fc.suggestedOrderQty * fc.unitCost).toFixed(2)));
      expect(fc.daysUntilStockout).not.toBeNull();
      expect(fc.daysUntilThreshold).not.toBeNull();
      expect(fc.daysUntilStockout!).toBeGreaterThanOrEqual(fc.daysUntilThreshold!);

      const forecastMap = new Map(forecasts.map((f) => [f.inventoryItemId, f]));
      const reorderList = buildReorderRequestList(items, 'nearing_threshold', forecastMap);
      expect(reorderList).toHaveLength(1);
      expect(reorderList[0].recommendedOrderQty).toBe(fc.suggestedOrderQty);
      expect(reorderList[0].estimatedCost).toBe(fc.estimatedOrderCost);
    });

    it('reconciles supplier directory PO totals, OTD percentages, and cost variances', () => {
      const suppliers = [
        normalizeSupplierRecord({ id: 's1', name: 'PaperOne', defaultLeadTimeDays: 2 }),
      ];
      const inventory: InventoryItem[] = [
        {
          id: 'i1',
          sku: 'PAP-1',
          name: 'Bond',
          category: 'Paper',
          itemType: 'consumable',
          unit: 'ream',
          quantityOnHand: 10,
          reorderLevel: 5,
          unitCost: 120,
          supplier: 'PaperOne',
          leadTimeDays: 2,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ];
      const movements: StockMovement[] = [
        {
          id: 'm1',
          inventoryItemId: 'i1',
          itemName: 'Bond',
          movementType: 'purchase',
          quantityBefore: 0,
          quantityDelta: 5,
          balanceAfter: 5,
          unitCostAtMovement: 100,
          referenceType: 'purchase_order',
          reference: 'PO-1',
          performedById: 'u1',
          performedBy: 'Admin',
          note: '',
          orderedAt: '2026-03-01T00:00:00.000Z',
          expectedDeliveryAt: '2026-03-03T00:00:00.000Z',
          occurredAt: '2026-03-03T00:00:00.000Z',
          createdAt: '2026-03-03T00:00:00.000Z',
        },
        {
          id: 'm2',
          inventoryItemId: 'i1',
          itemName: 'Bond',
          movementType: 'purchase',
          quantityBefore: 5,
          quantityDelta: 5,
          balanceAfter: 10,
          unitCostAtMovement: 120, // +20% over 100
          referenceType: 'purchase_order',
          reference: 'PO-2',
          performedById: 'u1',
          performedBy: 'Admin',
          note: '',
          orderedAt: '2026-03-10T00:00:00.000Z',
          expectedDeliveryAt: '2026-03-12T00:00:00.000Z',
          occurredAt: '2026-03-15T00:00:00.000Z',
          createdAt: '2026-03-15T00:00:00.000Z',
        },
      ];

      const [profile] = buildSupplierDirectory({
        suppliers,
        inventory,
        stockMovements: movements,
        forecasts: [],
      });

      expect(profile.totalStockValue).toBe(1200);
      expect(profile.totalOrderSpend).toBe(5 * 100 + 5 * 120);
      expect(profile.onTimeDeliveryCount + profile.lateDeliveryCount).toBe(
        profile.trackedDeliveryCount,
      );
      expect(profile.onTimeDeliveryRate).toBe(50);
      expect(profile.avgCostVariancePct).toBe(20);
      expect(profile.avgCostVarianceAmount).toBe(20);
    });
  });
});
