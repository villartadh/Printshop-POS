import { evaluateFormulaExpression } from './pricingEngine.ts';
import type {
  BulkTier,
  MaterialConsumptionBinding,
  PricingMethod,
  PrintService,
  ServiceAttributeGroup,
  ServiceAttributeOption,
  ServiceCategory,
} from './types.ts';

export const ALLOWED_PRICING_METHODS: ReadonlySet<PricingMethod> = new Set<PricingMethod>([
  'per_page',
  'per_sheet',
  'per_copy',
  'per_piece',
  'per_set',
  'per_sqft',
  'per_linear_ft',
  'per_meter',
  'per_hour',
  'fixed',
  'tiered_bulk',
  'formula',
]);

export const PRICING_METHOD_OPTIONS: Array<{ value: PricingMethod; label: string }> = [
  { value: 'per_page', label: 'Per Page' },
  { value: 'per_sheet', label: 'Per Sheet' },
  { value: 'per_copy', label: 'Per Copy' },
  { value: 'per_piece', label: 'Per Piece' },
  { value: 'per_set', label: 'Per Set' },
  { value: 'per_sqft', label: 'Per Square Foot' },
  { value: 'per_linear_ft', label: 'Per Linear Foot' },
  { value: 'per_meter', label: 'Per Meter' },
  { value: 'per_hour', label: 'Per Hour' },
  { value: 'fixed', label: 'Fixed Service Price' },
  { value: 'tiered_bulk', label: 'Bulk Tiered Pricing' },
  { value: 'formula', label: 'Formula-Based Pricing' },
];

export const FORMULA_VARIABLES: Array<{
  name: string;
  description: string;
}> = [
  { name: 'base', description: 'Resolved base or bulk-tier unit price' },
  { name: 'qty', description: 'Selected quantity' },
  { name: 'pages', description: 'Pages count (when Pages & Copies enabled)' },
  { name: 'copies', description: 'Copies count' },
  { name: 'areaSqFt', description: 'Width × Height converted to sq ft' },
  { name: 'linearFt', description: 'Longest dimension in feet' },
  { name: 'linearMeters', description: 'Longest dimension in meters' },
  { name: 'attrDelta', description: 'Sum of selected option price deltas' },
  { name: 'attrMult', description: 'Product of selected option multipliers' },
  { name: 'designFee', description: 'Entered design fee' },
  { name: 'laborFee', description: 'Entered additional labor fee' },
];

export interface ServiceBlueprint {
  id: string;
  name: string;
  tagline: string;
  categoryKeyword: string;
  skuPrefix: string;
  iconName: string;
  pricingMethod: PricingMethod;
  basePrice: number;
  unitLabel: string;
  costEstimate: number;
  requiresConfiguration: boolean;
  requiresProductionJob: boolean;
  allowCustomDimensions: boolean;
  allowPagesAndCopies: boolean;
  allowRushFee: boolean;
  rushFeePercent: number;
  defaultDesignFee: number;
  formulaExpression?: string;
  bulkTiers: BulkTier[];
  attributeGroups: ServiceAttributeGroup[];
}

export const SERVICE_BLUEPRINTS: ServiceBlueprint[] = [
  {
    id: 'bp-document-print',
    name: 'Document Print',
    tagline: 'Pages & copies, paper sizes, stock weights, duplex multiplier & volume breaks',
    categoryKeyword: 'print',
    skuPrefix: 'DOC-PRT',
    iconName: 'Printer',
    pricingMethod: 'per_page',
    basePrice: 5,
    unitLabel: 'page',
    costEstimate: 1.5,
    requiresConfiguration: true,
    requiresProductionJob: false,
    allowCustomDimensions: false,
    allowPagesAndCopies: true,
    allowRushFee: true,
    rushFeePercent: 25,
    defaultDesignFee: 0,
    bulkTiers: [
      { minQty: 50, unitPrice: 4 },
      { minQty: 200, unitPrice: 3 },
    ],
    attributeGroups: [
      {
        key: 'paperSize',
        label: 'Paper Size',
        defaultOptionId: 'a4',
        options: [
          { id: 'short', label: 'Short / Letter', priceDelta: 0 },
          { id: 'a4', label: 'A4', priceDelta: 0 },
          { id: 'long', label: 'Long / Legal', priceDelta: 1.5 },
          { id: 'a3', label: 'A3', priceDelta: 10 },
        ],
      },
      {
        key: 'sides',
        label: 'Print Sides',
        defaultOptionId: 'single',
        options: [
          { id: 'single', label: 'Single-sided', priceDelta: 0, priceMultiplier: 1 },
          { id: 'double', label: 'Back-to-back', priceDelta: 0, priceMultiplier: 1.8 },
        ],
      },
    ],
  },
  {
    id: 'bp-large-format',
    name: 'Large-Format Signage',
    tagline: 'Custom width × height in ft/in/cm/m, material weight, finishing & job order',
    categoryKeyword: 'signage',
    skuPrefix: 'SGN-FMT',
    iconName: 'Image',
    pricingMethod: 'per_sqft',
    basePrice: 28,
    unitLabel: 'sq ft',
    costEstimate: 9.5,
    requiresConfiguration: true,
    requiresProductionJob: true,
    allowCustomDimensions: true,
    allowPagesAndCopies: false,
    allowRushFee: true,
    rushFeePercent: 30,
    defaultDesignFee: 150,
    bulkTiers: [{ minQty: 100, unitPrice: 22 }],
    attributeGroups: [
      {
        key: 'materialType',
        label: 'Material Grade',
        defaultOptionId: 'standard_13oz',
        options: [
          { id: 'eco_10oz', label: '10oz Economy', priceDelta: -3 },
          { id: 'standard_13oz', label: '13oz Heavy Duty', priceDelta: 0 },
          { id: 'blackout_15oz', label: '15oz Blackout', priceDelta: 8 },
        ],
      },
      {
        key: 'finishing',
        label: 'Finishing',
        defaultOptionId: 'eyelets',
        options: [
          { id: 'trim', label: 'Flush Trim Only', priceDelta: 0 },
          { id: 'eyelets', label: 'Seam + Eyelets', priceDelta: 0 },
          { id: 'pole_pocket', label: 'Pole Pockets', priceDelta: 5 },
        ],
      },
    ],
  },
  {
    id: 'bp-merch-sublimation',
    name: 'Merch & Sublimation',
    tagline: 'Tiered bulk volume discounts, variant options, design fee & production tracking',
    categoryKeyword: 'merch',
    skuPrefix: 'MRC-SUB',
    iconName: 'Tag',
    pricingMethod: 'tiered_bulk',
    basePrice: 120,
    unitLabel: 'pc',
    costEstimate: 48,
    requiresConfiguration: true,
    requiresProductionJob: true,
    allowCustomDimensions: false,
    allowPagesAndCopies: false,
    allowRushFee: true,
    rushFeePercent: 30,
    defaultDesignFee: 100,
    bulkTiers: [
      { minQty: 10, unitPrice: 105 },
      { minQty: 25, unitPrice: 92 },
      { minQty: 50, unitPrice: 80 },
    ],
    attributeGroups: [
      {
        key: 'printPlacement',
        label: 'Print Coverage',
        defaultOptionId: 'front_only',
        options: [
          { id: 'front_only', label: 'Single Side', priceDelta: 0 },
          { id: 'front_back', label: 'Front & Back', priceDelta: 35 },
          { id: 'all_over', label: 'Full Wrap', priceDelta: 60 },
        ],
      },
    ],
  },
  {
    id: 'bp-photo-package',
    name: 'Photo & ID Package',
    tagline: 'Fixed set or per-photo sizes with digital soft-copy & bulk set pricing',
    categoryKeyword: 'photo',
    skuPrefix: 'PHO-PKG',
    iconName: 'Camera',
    pricingMethod: 'per_set',
    basePrice: 60,
    unitLabel: 'set',
    costEstimate: 10,
    requiresConfiguration: true,
    requiresProductionJob: false,
    allowCustomDimensions: false,
    allowPagesAndCopies: false,
    allowRushFee: false,
    rushFeePercent: 0,
    defaultDesignFee: 0,
    bulkTiers: [{ minQty: 10, unitPrice: 50 }],
    attributeGroups: [
      {
        key: 'paperSize',
        label: 'Package Option',
        defaultOptionId: 'std_set',
        options: [
          { id: 'std_set', label: 'Standard Set', priceDelta: 0 },
          { id: 'combo_set', label: 'Combo + Extra Copies', priceDelta: 30 },
          { id: 'soft_copy', label: 'With Soft Copy', priceDelta: 20 },
        ],
      },
      {
        key: 'paperType',
        label: 'Finish',
        defaultOptionId: 'glossy',
        options: [
          { id: 'glossy', label: 'High Gloss', priceDelta: 0 },
          { id: 'satin', label: 'Satin / Matte', priceDelta: 10 },
        ],
      },
    ],
  },
  {
    id: 'bp-finishing-addon',
    name: 'Finishing & Binding',
    tagline: 'Lamination, spiral/thermal binding, cutting & post-press finishing',
    categoryKeyword: 'finishing',
    skuPrefix: 'FIN-SVC',
    iconName: 'Layers',
    pricingMethod: 'per_piece',
    basePrice: 35,
    unitLabel: 'pc',
    costEstimate: 8,
    requiresConfiguration: true,
    requiresProductionJob: false,
    allowCustomDimensions: false,
    allowPagesAndCopies: false,
    allowRushFee: true,
    rushFeePercent: 20,
    defaultDesignFee: 0,
    bulkTiers: [{ minQty: 20, unitPrice: 28 }],
    attributeGroups: [
      {
        key: 'finishing',
        label: 'Finishing Spec',
        defaultOptionId: 'standard',
        options: [
          { id: 'standard', label: 'Standard Finish', priceDelta: 0 },
          { id: 'heavy', label: 'Heavy Duty / Thick', priceDelta: 15 },
        ],
      },
    ],
  },
  {
    id: 'bp-custom-formula',
    name: 'Custom Formula Job',
    tagline: 'Dynamic math formula combining dimensions, attributes & quantity',
    categoryKeyword: 'signage',
    skuPrefix: 'FRM-JOB',
    iconName: 'Sparkles',
    pricingMethod: 'formula',
    basePrice: 35,
    unitLabel: 'job',
    costEstimate: 12,
    requiresConfiguration: true,
    requiresProductionJob: true,
    allowCustomDimensions: true,
    allowPagesAndCopies: false,
    allowRushFee: true,
    rushFeePercent: 25,
    defaultDesignFee: 100,
    formulaExpression: '((base + attrDelta) * attrMult) * areaSqFt * qty',
    bulkTiers: [],
    attributeGroups: [
      {
        key: 'laminate',
        label: 'Protective Laminate',
        defaultOptionId: 'none',
        options: [
          { id: 'none', label: 'No Laminate', priceDelta: 0, priceMultiplier: 1 },
          { id: 'matte_lam', label: 'Matte UV Laminate', priceDelta: 10, priceMultiplier: 1 },
          { id: 'die_cut', label: 'Custom Die-Cut', priceDelta: 0, priceMultiplier: 1.25 },
        ],
      },
    ],
  },
];

export interface AttributeGroupPreset {
  id: string;
  name: string;
  description: string;
  group: ServiceAttributeGroup;
}

export const ATTRIBUTE_GROUP_PRESETS: AttributeGroupPreset[] = [
  {
    id: 'preset-paper-size',
    name: 'Paper Size (Short / A4 / Long / A3)',
    description: 'Standard document sizes with legal & A3 upcharges',
    group: {
      key: 'paperSize',
      label: 'Paper Size',
      defaultOptionId: 'a4',
      options: [
        { id: 'short', label: 'Short / Letter', priceDelta: 0 },
        { id: 'a4', label: 'A4', priceDelta: 0 },
        { id: 'long', label: 'Long / Legal', priceDelta: 1.5 },
        { id: 'a3', label: 'A3', priceDelta: 12 },
      ],
    },
  },
  {
    id: 'preset-paper-stock',
    name: 'Paper Stock Weight (80gsm / 120gsm / 250gsm)',
    description: 'Bond, presentation matte, and thick cardstock',
    group: {
      key: 'paperThickness',
      label: 'Paper Stock',
      defaultOptionId: '80gsm',
      options: [
        { id: '80gsm', label: '80gsm Bond', priceDelta: 0 },
        { id: '120gsm', label: '120gsm Matte', priceDelta: 4 },
        { id: '250gsm', label: '250gsm Cardstock', priceDelta: 10 },
      ],
    },
  },
  {
    id: 'preset-sides-mult',
    name: 'Print Sides (Single vs Back-to-Back ×1.8)',
    description: 'Uses a multiplier for duplex printing',
    group: {
      key: 'sides',
      label: 'Print Sides',
      defaultOptionId: 'single',
      options: [
        { id: 'single', label: 'Single-sided', priceDelta: 0, priceMultiplier: 1 },
        { id: 'double', label: 'Back-to-back', priceDelta: 0, priceMultiplier: 1.8 },
      ],
    },
  },
  {
    id: 'preset-color-mode',
    name: 'Ink / Color Coverage',
    description: 'B&W, partial spot color, or full bleed color',
    group: {
      key: 'colorMode',
      label: 'Color Mode',
      defaultOptionId: 'std_color',
      options: [
        { id: 'bw', label: 'Grayscale / B&W', priceDelta: -2 },
        { id: 'std_color', label: 'Standard Color', priceDelta: 0 },
        { id: 'full_bleed', label: 'Full Coverage Photo', priceDelta: 6 },
      ],
    },
  },
  {
    id: 'preset-banner-material',
    name: 'Signage Media Grade',
    description: '10oz, 13oz Heavy Duty, and 15oz Blackout vinyl',
    group: {
      key: 'materialType',
      label: 'Media Grade',
      defaultOptionId: '13oz',
      options: [
        { id: '10oz', label: '10oz Standard', priceDelta: -3 },
        { id: '13oz', label: '13oz Heavy Duty', priceDelta: 0 },
        { id: '15oz', label: '15oz Blackout', priceDelta: 8 },
      ],
    },
  },
  {
    id: 'preset-finishing',
    name: 'Finishing & Mounting',
    description: 'Eyelets, pole pockets, or UV lamination',
    group: {
      key: 'finishing',
      label: 'Finishing',
      defaultOptionId: 'eyelets',
      options: [
        { id: 'trim', label: 'Flush Trim', priceDelta: 0 },
        { id: 'eyelets', label: 'Seam + Eyelets', priceDelta: 0 },
        { id: 'pocket', label: 'Pole Pockets', priceDelta: 5 },
      ],
    },
  },
];

export interface BulkTierPreset {
  id: string;
  name: string;
  tiers: Array<{ minQty: number; discountPercent: number }>;
}

export const BULK_TIER_PRESETS: BulkTierPreset[] = [
  {
    id: 'tiers-doc-volume',
    name: 'Document Volume (50+ / 200+ / 500+)',
    tiers: [
      { minQty: 50, discountPercent: 15 },
      { minQty: 200, discountPercent: 25 },
      { minQty: 500, discountPercent: 35 },
    ],
  },
  {
    id: 'tiers-merch-breaks',
    name: 'Merch & Promo Breaks (10+ / 25+ / 50+)',
    tiers: [
      { minQty: 10, discountPercent: 10 },
      { minQty: 25, discountPercent: 20 },
      { minQty: 50, discountPercent: 30 },
    ],
  },
  {
    id: 'tiers-large-format',
    name: 'Roll & Area Breaks (50+ / 100+ units)',
    tiers: [
      { minQty: 50, discountPercent: 10 },
      { minQty: 100, discountPercent: 20 },
    ],
  },
];

export function buildBulkTiersFromPreset(presetId: string, basePrice: number): BulkTier[] {
  const preset = BULK_TIER_PRESETS.find((p) => p.id === presetId);
  if (!preset) return [];
  const safeBase = Number.isFinite(basePrice) && basePrice > 0 ? basePrice : 10;
  return preset.tiers.map((t) => ({
    minQty: t.minQty,
    unitPrice: Math.max(0, Number((safeBase * (1 - t.discountPercent / 100)).toFixed(2))),
  }));
}

export function slugifyAttributeKey(label: string, existingKeys: string[] = []): string {
  const words = label
    .trim()
    .replace(/[^a-zA-Z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  let baseKey =
    words.length === 0
      ? 'customOption'
      : words
          .map((w, idx) =>
            idx === 0
              ? w.toLowerCase()
              : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
          )
          .join('');
  if (/^[0-9]/.test(baseKey)) {
    baseKey = `opt_${baseKey}`;
  }

  const used = new Set(existingKeys.map((k) => k.toLowerCase()));
  if (!used.has(baseKey.toLowerCase())) return baseKey;

  let counter = 2;
  while (used.has(`${baseKey}${counter}`.toLowerCase())) {
    counter += 1;
  }
  return `${baseKey}${counter}`;
}

export function createAttributeGroupFromPreset(
  presetId: string,
  existingKeys: string[] = [],
): ServiceAttributeGroup | null {
  const preset = ATTRIBUTE_GROUP_PRESETS.find((p) => p.id === presetId);
  if (!preset) return null;
  const cloned = cloneAttributeGroup(preset.group);
  const used = new Set(existingKeys.map((k) => k.toLowerCase()));
  if (used.has(cloned.key.toLowerCase())) {
    cloned.key = slugifyAttributeKey(cloned.label, existingKeys);
  }
  return cloned;
}

export function cloneAttributeGroup(group: ServiceAttributeGroup): ServiceAttributeGroup {
  const options: ServiceAttributeOption[] = (group.options || []).map((opt) => ({
    id: opt.id,
    label: opt.label,
    priceDelta: Number(opt.priceDelta) || 0,
    ...(opt.priceMultiplier !== undefined && opt.priceMultiplier > 0
      ? { priceMultiplier: Number(opt.priceMultiplier) }
      : {}),
  }));
  return {
    key: group.key,
    label: group.label,
    defaultOptionId: group.defaultOptionId,
    options,
  };
}

export function generateUniqueServiceSku(
  baseSkuOrName: string,
  existingServices: Array<Pick<PrintService, 'id' | 'sku'>>,
  excludeId?: string,
): string {
  const cleaned = baseSkuOrName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  const root = cleaned || 'SRV-ITEM';

  const existingSkus = new Set(
    existingServices
      .filter((s) => !excludeId || s.id !== excludeId)
      .map((s) => s.sku.trim().toUpperCase()),
  );

  if (!existingSkus.has(root)) {
    return root;
  }

  let suffix = 2;
  while (existingSkus.has(`${root}-${suffix}`)) {
    suffix += 1;
  }
  return `${root}-${suffix}`;
}

export function cloneServiceDraft(
  source: PrintService,
  existingServices: PrintService[],
): Omit<PrintService, 'id' | 'updatedAt'> {
  const existingNames = new Set(existingServices.map((s) => s.name.trim().toLowerCase()));
  const baseName = source.name.replace(/\s*\(Copy(?:\s+\d+)?\)$/i, '').trim() || source.name;
  let candidateName = `${baseName} (Copy)`;
  let copyIdx = 2;
  while (existingNames.has(candidateName.toLowerCase())) {
    candidateName = `${baseName} (Copy ${copyIdx})`;
    copyIdx += 1;
  }

  const copySkuRoot = source.sku.replace(/-COPY(?:-\d+)?$/i, '') + '-COPY';
  const sku = generateUniqueServiceSku(copySkuRoot, existingServices);

  return {
    sku,
    name: candidateName,
    categoryId: source.categoryId,
    description: source.description,
    iconName: source.iconName,
    pricingMethod: source.pricingMethod,
    basePrice: Number(source.basePrice) || 0,
    unitLabel: source.unitLabel || 'pc',
    costEstimate: Number(source.costEstimate) || 0,
    requiresConfiguration: source.requiresConfiguration,
    requiresProductionJob: source.requiresProductionJob,
    allowCustomDimensions: source.allowCustomDimensions,
    allowPagesAndCopies: source.allowPagesAndCopies,
    allowRushFee: source.allowRushFee,
    rushFeePercent: Number(source.rushFeePercent) || 0,
    defaultDesignFee: Number(source.defaultDesignFee) || 0,
    bulkTiers: (source.bulkTiers || []).map((t) => ({
      minQty: Number(t.minQty) || 1,
      unitPrice: Number(t.unitPrice) || 0,
    })),
    formulaExpression: source.formulaExpression || '',
    attributeGroups: (source.attributeGroups || []).map(cloneAttributeGroup),
    consumables: (source.consumables || []).map((c) => ({
      inventoryItemId: c.inventoryItemId,
      quantityPerUnit: Number(c.quantityPerUnit) || 1,
    })),
    isFavorite: false,
    isArchived: false,
    isDemo: false,
  };
}

export function instantiateServiceFromBlueprint(
  blueprint: ServiceBlueprint,
  categories: ServiceCategory[],
  existingServices: PrintService[],
): Omit<PrintService, 'id' | 'updatedAt'> {
  const keyword = blueprint.categoryKeyword.toLowerCase();
  const matchedCat =
    categories.find((c) => c.name.toLowerCase().includes(keyword)) || categories[0];

  const existingNames = new Set(existingServices.map((s) => s.name.trim().toLowerCase()));
  let name = blueprint.name;
  let n = 2;
  while (existingNames.has(name.toLowerCase())) {
    name = `${blueprint.name} ${n}`;
    n += 1;
  }

  const sku = generateUniqueServiceSku(`${blueprint.skuPrefix}-01`, existingServices);

  return {
    sku,
    name,
    categoryId: matchedCat?.id || '',
    description: blueprint.tagline,
    iconName: blueprint.iconName,
    pricingMethod: blueprint.pricingMethod,
    basePrice: blueprint.basePrice,
    unitLabel: blueprint.unitLabel,
    costEstimate: blueprint.costEstimate,
    requiresConfiguration: blueprint.requiresConfiguration,
    requiresProductionJob: blueprint.requiresProductionJob,
    allowCustomDimensions: blueprint.allowCustomDimensions,
    allowPagesAndCopies: blueprint.allowPagesAndCopies,
    allowRushFee: blueprint.allowRushFee,
    rushFeePercent: blueprint.rushFeePercent,
    defaultDesignFee: blueprint.defaultDesignFee,
    bulkTiers: blueprint.bulkTiers.map((t) => ({ ...t })),
    formulaExpression: blueprint.formulaExpression || '',
    attributeGroups: blueprint.attributeGroups.map(cloneAttributeGroup),
    consumables: [],
    isFavorite: false,
    isArchived: false,
    isDemo: false,
  };
}

export interface NormalizedServiceResult {
  valid: true;
  service: Omit<PrintService, 'id' | 'updatedAt'>;
}

export interface InvalidServiceResult {
  valid: false;
  error: string;
}

export function normalizeAndValidateServicePayload(
  input: Partial<PrintService>,
): NormalizedServiceResult | InvalidServiceResult {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  if (!name) {
    return { valid: false, error: 'Service name is required.' };
  }
  if (name.length > 120) {
    return { valid: false, error: 'Service name must be 120 characters or fewer.' };
  }

  const categoryId = typeof input?.categoryId === 'string' ? input.categoryId.trim() : '';
  if (!categoryId) {
    return { valid: false, error: 'Service category is required.' };
  }

  const pricingMethod = input?.pricingMethod as PricingMethod;
  if (!ALLOWED_PRICING_METHODS.has(pricingMethod)) {
    return { valid: false, error: 'Select a valid pricing method.' };
  }

  const rawSku = typeof input?.sku === 'string' ? input.sku.trim().toUpperCase() : '';
  const sku = rawSku || `SRV-${Date.now().toString().slice(-4)}`;

  const toFiniteNonNeg = (val: unknown, fallback = 0): number | null => {
    if (val === undefined || val === null || val === '') return fallback;
    const n = typeof val === 'number' ? val : Number(val);
    if (!Number.isFinite(n) || n < 0) return null;
    return Number(n.toFixed(4));
  };

  const basePrice = toFiniteNonNeg(input?.basePrice, 0);
  if (basePrice === null) {
    return { valid: false, error: 'Base price must be zero or a positive number.' };
  }

  const costEstimate = toFiniteNonNeg(input?.costEstimate, 0);
  if (costEstimate === null) {
    return { valid: false, error: 'Estimated cost must be zero or a positive number.' };
  }

  const defaultDesignFee = toFiniteNonNeg(input?.defaultDesignFee, 0);
  if (defaultDesignFee === null) {
    return { valid: false, error: 'Default design fee must be zero or a positive number.' };
  }

  const rawRush =
    input?.rushFeePercent === undefined || input?.rushFeePercent === null
      ? 25
      : Number(input.rushFeePercent);
  if (!Number.isFinite(rawRush) || rawRush < 0 || rawRush > 500) {
    return { valid: false, error: 'Rush fee percentage must be between 0 and 500.' };
  }

  const formulaExpression =
    typeof input?.formulaExpression === 'string' ? input.formulaExpression.trim() : '';
  if (pricingMethod === 'formula') {
    if (!formulaExpression) {
      return { valid: false, error: 'Formula pricing requires a formula expression.' };
    }
    const testResult = evaluateFormulaExpression(formulaExpression, {
      base: Math.max(1, basePrice),
      qty: 1,
      pages: 1,
      copies: 1,
      areaSqFt: 6,
      linearFt: 3,
      linearMeters: 1,
      attrDelta: 0,
      attrMult: 1,
      designFee: defaultDesignFee,
      laborFee: 0,
    });
    if (testResult === null) {
      return {
        valid: false,
        error:
          'Invalid formula expression. Check syntax, parentheses, division by zero, or unsupported variable names.',
      };
    }
  }

  // Normalize bulk tiers
  const tierMap = new Map<number, number>();
  if (Array.isArray(input?.bulkTiers)) {
    for (const rawTier of input.bulkTiers) {
      if (!rawTier) continue;
      const minQty = Number(rawTier.minQty);
      const unitPrice = Number(rawTier.unitPrice);
      if (!Number.isFinite(minQty) || minQty < 1) {
        return { valid: false, error: 'Bulk tier minimum quantity must be at least 1.' };
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        return { valid: false, error: 'Bulk tier unit price must be zero or positive.' };
      }
      tierMap.set(Math.round(minQty), Number(unitPrice.toFixed(4)));
    }
  }
  const bulkTiers: BulkTier[] = Array.from(tierMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([minQty, unitPrice]) => ({ minQty, unitPrice }));

  // Normalize dynamic attribute groups
  const attributeGroups: ServiceAttributeGroup[] = [];
  const usedGroupKeys: string[] = [];
  if (Array.isArray(input?.attributeGroups)) {
    for (const rawGroup of input.attributeGroups) {
      if (!rawGroup) continue;
      const groupLabel = typeof rawGroup.label === 'string' ? rawGroup.label.trim() : '';
      if (!groupLabel) {
        return { valid: false, error: 'Every option group must have a label.' };
      }
      const rawKey = typeof rawGroup.key === 'string' ? rawGroup.key.trim() : '';
      const cleanedKey =
        rawKey && !usedGroupKeys.some((k) => k.toLowerCase() === rawKey.toLowerCase())
          ? rawKey.replace(/[^a-zA-Z0-9_]/g, '_')
          : slugifyAttributeKey(groupLabel, usedGroupKeys);
      usedGroupKeys.push(cleanedKey);

      const rawOptions = Array.isArray(rawGroup.options) ? rawGroup.options : [];
      const normalizedOptions: ServiceAttributeOption[] = [];
      const seenOptionIds = new Set<string>();

      for (let i = 0; i < rawOptions.length; i++) {
        const rawOpt = rawOptions[i];
        if (!rawOpt) continue;
        const optLabel = typeof rawOpt.label === 'string' ? rawOpt.label.trim() : '';
        if (!optLabel) continue;

        const priceDelta = Number(rawOpt.priceDelta ?? 0);
        if (!Number.isFinite(priceDelta)) {
          return {
            valid: false,
            error: `Option "${optLabel}" in "${groupLabel}" has an invalid price delta.`,
          };
        }

        let priceMultiplier: number | undefined;
        if (
          rawOpt.priceMultiplier !== undefined &&
          rawOpt.priceMultiplier !== null &&
          String(rawOpt.priceMultiplier) !== ''
        ) {
          const mult = Number(rawOpt.priceMultiplier);
          if (!Number.isFinite(mult) || mult <= 0 || mult > 100) {
            return {
              valid: false,
              error: `Option "${optLabel}" multiplier must be greater than 0 and at most 100.`,
            };
          }
          if (mult !== 1) {
            priceMultiplier = Number(mult.toFixed(4));
          }
        }

        let optId =
          typeof rawOpt.id === 'string' && rawOpt.id.trim()
            ? rawOpt.id.trim().replace(/[^a-zA-Z0-9_-]/g, '_')
            : slugifyAttributeKey(optLabel, Array.from(seenOptionIds));
        if (seenOptionIds.has(optId)) {
          optId = `${optId}_${i + 1}`;
        }
        seenOptionIds.add(optId);

        normalizedOptions.push({
          id: optId,
          label: optLabel,
          priceDelta: Number(priceDelta.toFixed(2)),
          ...(priceMultiplier !== undefined ? { priceMultiplier } : {}),
        });
      }

      if (normalizedOptions.length === 0) {
        return {
          valid: false,
          error: `Option group "${groupLabel}" must include at least one valid option.`,
        };
      }

      const requestedDefault =
        typeof rawGroup.defaultOptionId === 'string' ? rawGroup.defaultOptionId.trim() : '';
      const defaultOptionId = normalizedOptions.some((o) => o.id === requestedDefault)
        ? requestedDefault
        : normalizedOptions[0].id;

      attributeGroups.push({
        key: cleanedKey,
        label: groupLabel,
        defaultOptionId,
        options: normalizedOptions,
      });
    }
  }

  // Normalize multiple consumables
  const consumableMap = new Map<string, number>();
  if (Array.isArray(input?.consumables)) {
    for (const rawBinding of input.consumables) {
      if (!rawBinding || typeof rawBinding.inventoryItemId !== 'string') continue;
      const itemId = rawBinding.inventoryItemId.trim();
      if (!itemId) continue;
      const qtyPerUnit = Number(rawBinding.quantityPerUnit);
      if (!Number.isFinite(qtyPerUnit) || qtyPerUnit <= 0) {
        return {
          valid: false,
          error: 'Consumable quantity per unit must be greater than zero.',
        };
      }
      consumableMap.set(itemId, Number(qtyPerUnit.toFixed(4)));
    }
  }
  const consumables: MaterialConsumptionBinding[] = Array.from(consumableMap.entries()).map(
    ([inventoryItemId, quantityPerUnit]) => ({
      inventoryItemId,
      quantityPerUnit,
    }),
  );

  return {
    valid: true,
    service: {
      sku,
      name,
      categoryId,
      description: typeof input?.description === 'string' ? input.description.trim() : '',
      iconName:
        typeof input?.iconName === 'string' && input.iconName.trim()
          ? input.iconName.trim()
          : 'Printer',
      pricingMethod,
      basePrice: Number(basePrice.toFixed(2)),
      unitLabel:
        typeof input?.unitLabel === 'string' && input.unitLabel.trim()
          ? input.unitLabel.trim()
          : 'pc',
      costEstimate: Number(costEstimate.toFixed(2)),
      requiresConfiguration: Boolean(input?.requiresConfiguration ?? true),
      requiresProductionJob: Boolean(input?.requiresProductionJob ?? false),
      allowCustomDimensions: Boolean(input?.allowCustomDimensions ?? false),
      allowPagesAndCopies: Boolean(input?.allowPagesAndCopies ?? false),
      allowRushFee: Boolean(input?.allowRushFee ?? false),
      rushFeePercent: Number(rawRush.toFixed(2)),
      defaultDesignFee: Number(defaultDesignFee.toFixed(2)),
      bulkTiers,
      formulaExpression,
      attributeGroups,
      consumables,
      isFavorite: Boolean(input?.isFavorite ?? false),
      isArchived: Boolean(input?.isArchived ?? false),
      isDemo: Boolean(input?.isDemo ?? false),
    },
  };
}
