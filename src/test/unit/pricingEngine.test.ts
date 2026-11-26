import { describe, it, expect } from 'vitest';
import {
  calculateCartItemTotals,
  calculateOrderTotals,
  calculateServicePrice,
  convertToFeet,
  evaluateFormulaExpression,
  formatCurrency,
  getDefaultServiceSelection,
  roundAmount,
} from '../../shared/pricingEngine.ts';
import { DEFAULT_SETTINGS, DEMO_SERVICES } from '../../shared/defaults.ts';
import type { CartItem, PrintService, TaxAndCurrencyConfig } from '../../shared/types.ts';

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

describe('pricingEngine', () => {
  it('rounds amounts according to configured rounding modes', () => {
    expect(roundAmount(12.345, baseCurrency)).toBe(12.35);
    expect(roundAmount(12.37, { ...baseCurrency, roundingMode: 'nearest_0_25' })).toBe(12.25);
    expect(roundAmount(12.38, { ...baseCurrency, roundingMode: 'nearest_0_25' })).toBe(12.5);
    expect(roundAmount(12.49, { ...baseCurrency, roundingMode: 'nearest_1' })).toBe(12);
    expect(roundAmount(12.51, { ...baseCurrency, roundingMode: 'nearest_1' })).toBe(13);
  });

  it('formats currency safely including non-finite fallback', () => {
    expect(formatCurrency(1250.5, baseCurrency)).toBe('₱1,250.50');
    expect(formatCurrency(Number.NaN, baseCurrency)).toBe('₱0.00');
  });

  it('converts dimensions accurately to feet', () => {
    expect(convertToFeet(10, 'ft')).toBe(10);
    expect(convertToFeet(24, 'in')).toBe(2);
    expect(convertToFeet(30.48, 'cm')).toBeCloseTo(1, 4);
    expect(convertToFeet(1, 'm')).toBeCloseTo(3.28084, 4);
    expect(convertToFeet(-5, 'ft')).toBe(0);
  });

  it('evaluates safe arithmetic formulas and rejects unsafe identifiers', () => {
    expect(
      evaluateFormulaExpression('base * areaSqFt * qty + designFee', {
        base: 20,
        areaSqFt: 6,
        qty: 2,
        designFee: 50,
      }),
    ).toBe(290);

    expect(evaluateFormulaExpression('process.exit(1)', { base: 10 })).toBeNull();
    expect(evaluateFormulaExpression('window.location', { base: 10 })).toBeNull();
    expect(evaluateFormulaExpression('', { base: 10 })).toBeNull();
  });

  it('calculates per-page printing with bulk tiers, attributes, rush fee, and extra fees', () => {
    const bwService = DEMO_SERVICES.find((s) => s.id === 'srv-bw-print')!;
    const selection = getDefaultServiceSelection(bwService);
    selection.pages = 60;
    selection.copies = 1;
    selection.selectedAttributes = { paperSize: 'legal', sides: 'double' };
    selection.isRush = true;
    selection.designFee = 25;
    selection.laborFee = 15;

    // effectiveQty = 60 -> hits minQty 50 tier (unit base = 2.5)
    // attributesDelta = +1.0 (legal) - 0.5 (double) = +0.5 => unitPrice = 3.0
    // baseSubtotal = 3.0 * 60 = 180; rush 25% = 45; extraFees = 40; lineSubtotal = 265
    const result = calculateServicePrice(bwService, selection, baseCurrency);
    expect(result.effectiveQuantity).toBe(60);
    expect(result.unitPrice).toBe(3);
    expect(result.baseSubtotal).toBe(180);
    expect(result.rushAmount).toBe(45);
    expect(result.extraFees).toBe(40);
    expect(result.lineSubtotal).toBe(265);
    expect(result.displaySummary).toContain('60p × 1c');
    expect(result.displaySummary).toContain('Rush');
  });

  it('calculates per-sqft tarpaulin pricing with inch dimensions', () => {
    const tarpService = DEMO_SERVICES.find((s) => s.id === 'srv-tarpaulin')!;
    const selection = getDefaultServiceSelection(tarpService);
    selection.width = 48; // 4 ft
    selection.height = 36; // 3 ft
    selection.dimensionUnit = 'in';
    selection.quantity = 2; // 12 * 2 = 24 sq ft
    selection.designFee = 150;
    selection.selectedAttributes = { materialType: '15oz', finishing: 'pocket' }; // +8 +5 = +13

    // unitPrice = 25 + 13 = 38; baseSubtotal = 38 * 24 = 912; +150 design = 1062
    const result = calculateServicePrice(tarpService, selection, baseCurrency);
    expect(result.areaSqFt).toBe(12);
    expect(result.effectiveQuantity).toBe(24);
    expect(result.unitPrice).toBe(38);
    expect(result.lineSubtotal).toBe(1062);
  });

  it('calculates formula-based custom service pricing', () => {
    const formulaService: PrintService = {
      ...DEMO_SERVICES[0],
      id: 'srv-formula',
      pricingMethod: 'formula',
      basePrice: 15,
      allowCustomDimensions: true,
      allowRushFee: false,
      bulkTiers: [],
      attributeGroups: [],
      formulaExpression: '(base * areaSqFt * qty) + 50',
    };
    const result = calculateServicePrice(
      formulaService,
      {
        quantity: 2,
        pages: 1,
        copies: 1,
        width: 3,
        height: 2,
        dimensionUnit: 'ft',
        selectedAttributes: {},
        isRush: false,
        designFee: 0,
        laborFee: 0,
        notes: '',
      },
      baseCurrency,
    );
    // (15 * 6 * 2) + 50 = 230
    expect(result.baseSubtotal).toBe(230);
    expect(result.lineSubtotal).toBe(230);
  });

  it('calculates cart line discounts and order totals with inclusive vs exclusive tax', () => {
    const baseItem = {
      id: 'ci-1',
      serviceId: 'srv-bw-print',
      sku: 'PRT-BW-01',
      serviceName: 'B&W Print',
      pricingMethod: 'per_page' as const,
      unitLabel: 'page',
      unitPrice: 10,
      effectiveQuantity: 20,
      displaySummary: '20 pages',
      config: getDefaultServiceSelection(DEMO_SERVICES[0]),
      discountType: 'percent' as const,
      discountValue: 10,
      lineSubtotal: 200,
      costTotal: 50,
      requiresProductionJob: false,
      consumables: [],
    };

    const pctTotals = calculateCartItemTotals(baseItem, baseCurrency);
    expect(pctTotals.lineDiscount).toBe(20);
    expect(pctTotals.lineTotal).toBe(180);

    const fixedTotals = calculateCartItemTotals(
      { ...baseItem, discountType: 'fixed', discountValue: 500 },
      baseCurrency,
    );
    expect(fixedTotals.lineDiscount).toBe(200);
    expect(fixedTotals.lineTotal).toBe(0);

    const cartItems: CartItem[] = [{ ...baseItem, ...pctTotals }];

    // Exclusive 12% VAT after ₱30 order discount => taxableBase = 150, tax = 18, total = 168
    const exclusive = calculateOrderTotals(cartItems, 'fixed', 30, {
      ...baseCurrency,
      taxEnabled: true,
      taxRatePercent: 12,
      taxInclusive: false,
    });
    expect(exclusive.subtotal).toBe(200);
    expect(exclusive.itemDiscountsTotal).toBe(20);
    expect(exclusive.orderDiscountAmount).toBe(30);
    expect(exclusive.taxAmount).toBe(18);
    expect(exclusive.totalAmount).toBe(168);

    // Inclusive 12% VAT with 0 order discount => taxableBase = 180, tax = 180 - 180/1.12 = 19.29, total = 180
    const inclusive = calculateOrderTotals(cartItems, 'none', 0, {
      ...baseCurrency,
      taxEnabled: true,
      taxRatePercent: 12,
      taxInclusive: true,
    });
    expect(inclusive.taxAmount).toBe(19.29);
    expect(inclusive.totalAmount).toBe(180);
  });
});
