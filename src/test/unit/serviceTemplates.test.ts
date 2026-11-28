import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, DEMO_CATEGORIES, DEMO_SERVICES } from '../../shared/defaults.ts';
import { calculateServicePrice, getDefaultServiceSelection } from '../../shared/pricingEngine.ts';
import {
  SERVICE_BLUEPRINTS,
  buildBulkTiersFromPreset,
  cloneServiceDraft,
  createAttributeGroupFromPreset,
  generateUniqueServiceSku,
  instantiateServiceFromBlueprint,
  normalizeAndValidateServicePayload,
  slugifyAttributeKey,
} from '../../shared/serviceTemplates.ts';
import type { PrintService } from '../../shared/types.ts';

describe('Reusable & Dynamic Service Templates Engine', () => {
  it('instantiates a service blueprint with mapped category, dynamic options, and unique SKU', () => {
    const merchBlueprint = SERVICE_BLUEPRINTS.find((b) => b.id === 'bp-merch-sublimation')!;
    const draft = instantiateServiceFromBlueprint(merchBlueprint, DEMO_CATEGORIES, DEMO_SERVICES);

    expect(draft.pricingMethod).toBe('tiered_bulk');
    expect(draft.categoryId).toBe('cat-merch');
    expect(draft.bulkTiers.length).toBeGreaterThanOrEqual(3);
    expect(draft.attributeGroups.length).toBeGreaterThanOrEqual(1);
    expect(DEMO_SERVICES.some((s) => s.sku === draft.sku)).toBe(false);

    // Instantiating a second time increments name & SKU without collision
    const existingWithFirst: PrintService[] = [
      ...DEMO_SERVICES,
      { id: 'srv-first-bp', updatedAt: new Date().toISOString(), ...draft },
    ];
    const secondDraft = instantiateServiceFromBlueprint(
      merchBlueprint,
      DEMO_CATEGORIES,
      existingWithFirst,
    );
    expect(secondDraft.name).toBe('Merch & Sublimation 2');
    expect(secondDraft.sku).not.toBe(draft.sku);
  });

  it('deep-clones an existing service with collision-free SKU and preserves all dynamic rules', () => {
    const colorPrint = DEMO_SERVICES.find((s) => s.id === 'srv-color-print')!;
    const clone1 = cloneServiceDraft(colorPrint, DEMO_SERVICES);

    expect(clone1.name).toBe(`${colorPrint.name} (Copy)`);
    expect(clone1.sku).toBe('PRT-CLR-01-COPY');
    expect(clone1.consumables).toHaveLength(2);
    expect(clone1.attributeGroups).toHaveLength(colorPrint.attributeGroups.length);
    expect(clone1.bulkTiers).toHaveLength(colorPrint.bulkTiers.length);

    // Mutating cloned nested arrays must not affect original service
    clone1.bulkTiers[0].unitPrice = 999;
    expect(colorPrint.bulkTiers[0].unitPrice).not.toBe(999);

    const withClone1: PrintService[] = [
      ...DEMO_SERVICES,
      { id: 'srv-cloned-1', updatedAt: new Date().toISOString(), ...clone1 },
    ];
    const clone2 = cloneServiceDraft(colorPrint, withClone1);
    expect(clone2.name).toBe(`${colorPrint.name} (Copy 2)`);
    expect(clone2.sku).toBe('PRT-CLR-01-COPY-2');
  });

  it('generates collision-free attribute keys and inserts reusable attribute presets cleanly', () => {
    const firstKey = slugifyAttributeKey('Laminate Finish!', []);
    expect(firstKey).toBe('laminateFinish');
    const secondKey = slugifyAttributeKey('Laminate Finish!', [firstKey]);
    expect(secondKey).toBe('laminateFinish2');

    const preset1 = createAttributeGroupFromPreset('preset-sides-mult', [])!;
    expect(preset1.key).toBe('sides');
    expect(preset1.options.find((o) => o.id === 'double')?.priceMultiplier).toBe(1.8);

    const preset2 = createAttributeGroupFromPreset('preset-sides-mult', ['sides'])!;
    expect(preset2.key).toBe('printSides');
  });

  it('normalizes and validates dynamic payloads, sorting tiers and preserving multi-consumables', () => {
    const bulkTiers = buildBulkTiersFromPreset('tiers-merch-breaks', 200);
    expect(bulkTiers).toEqual([
      { minQty: 10, unitPrice: 180 },
      { minQty: 25, unitPrice: 160 },
      { minQty: 50, unitPrice: 140 },
    ]);

    const result = normalizeAndValidateServicePayload({
      name: '  Custom Mug Wrap  ',
      sku: 'mrc-mug-01',
      categoryId: 'cat-merch',
      pricingMethod: 'tiered_bulk',
      basePrice: 150,
      costEstimate: 55,
      defaultDesignFee: 75,
      rushFeePercent: 25,
      bulkTiers: [
        { minQty: 50, unitPrice: 110 },
        { minQty: 10, unitPrice: 130 },
      ],
      attributeGroups: [
        {
          key: 'mugCoating',
          label: 'Coating Type',
          defaultOptionId: 'missing-id',
          options: [
            { id: 'gloss', label: 'Standard Gloss', priceDelta: 0 },
            { id: 'magic', label: 'Color-Changing Magic', priceDelta: 40, priceMultiplier: 1.2 },
          ],
        },
      ],
      consumables: [
        { inventoryItemId: 'inv-bond-a4', quantityPerUnit: 1 },
        { inventoryItemId: 'inv-ink-set', quantityPerUnit: 0.25 },
      ],
    });

    expect(result.valid).toBe(true);
    if (!result.valid) {
      throw new Error('Expected payload to validate');
    }
    expect(result.service.sku).toBe('MRC-MUG-01');
    expect(result.service.bulkTiers).toEqual([
      { minQty: 10, unitPrice: 130 },
      { minQty: 50, unitPrice: 110 },
    ]);
    expect(result.service.attributeGroups[0].defaultOptionId).toBe('gloss');
    expect(result.service.consumables).toHaveLength(2);
  });

  it('rejects invalid formulas and negative pricing inputs cleanly', () => {
    const badFormula = normalizeAndValidateServicePayload({
      name: 'Broken Formula',
      categoryId: 'cat-signage',
      pricingMethod: 'formula',
      basePrice: 20,
      formulaExpression: 'base / 0',
    });
    expect(badFormula.valid).toBe(false);

    const negativePrice = normalizeAndValidateServicePayload({
      name: 'Negative Price',
      categoryId: 'cat-print',
      pricingMethod: 'per_piece',
      basePrice: -5,
    });
    expect(negativePrice.valid).toBe(false);
  });

  it('prices custom dynamic attribute keys with priceMultiplier and bulk tiers accurately', () => {
    const customService: PrintService = {
      id: 'srv-custom-dyn',
      sku: generateUniqueServiceSku('DYN-TEST', DEMO_SERVICES),
      name: 'Dynamic Foil Card',
      categoryId: 'cat-print',
      description: '',
      iconName: 'Sparkles',
      pricingMethod: 'per_piece',
      basePrice: 100,
      unitLabel: 'pc',
      costEstimate: 30,
      requiresConfiguration: true,
      requiresProductionJob: false,
      allowCustomDimensions: false,
      allowPagesAndCopies: false,
      allowRushFee: true,
      rushFeePercent: 25,
      defaultDesignFee: 50,
      bulkTiers: [{ minQty: 10, unitPrice: 80 }],
      attributeGroups: [
        {
          key: 'foilFinish',
          label: 'Foil Finish',
          defaultOptionId: 'matte',
          options: [
            { id: 'matte', label: 'Matte', priceDelta: 0, priceMultiplier: 1 },
            { id: 'gold', label: 'Gold Foil', priceDelta: 10, priceMultiplier: 1.5 },
          ],
        },
      ],
      consumables: [],
      isFavorite: false,
      isArchived: false,
      updatedAt: new Date().toISOString(),
    };

    const defaults = getDefaultServiceSelection(customService);
    const calc = calculateServicePrice(
      customService,
      {
        ...defaults,
        quantity: 10,
        selectedAttributes: { foilFinish: 'gold' },
      },
      DEFAULT_SETTINGS.taxAndCurrency,
    );

    // Tier unitPrice = 80; (80 + 10) * 1.5 = 135/pc * 10 + 50 designFee = 1400
    expect(calc.unitPrice).toBe(135);
    expect(calc.lineSubtotal).toBe(1400);
  });
});
