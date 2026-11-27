import type {
  CartItem,
  PrintService,
  ServiceConfigSelection,
  TaxAndCurrencyConfig,
} from './types.ts';

export interface PricingCalculationResult {
  unitPrice: number;
  effectiveQuantity: number;
  areaSqFt: number;
  linearFt: number;
  linearMeters: number;
  baseSubtotal: number;
  attributesDelta: number;
  rushAmount: number;
  extraFees: number;
  lineSubtotal: number;
  estimatedCost: number;
  displaySummary: string;
}

const MAX_FORMULA_LENGTH = 500;
const MAX_FORMULA_TOKENS = 200;

function safeFinite(value: unknown, fallback = 0): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function safeNonNegative(value: unknown, fallback = 0): number {
  const num = safeFinite(value, fallback);
  return num >= 0 ? num : fallback;
}

function getSafeDecimalPlaces(config?: Partial<TaxAndCurrencyConfig>): number {
  const raw = safeFinite(config?.decimalPlaces, 2);
  return Math.min(4, Math.max(0, Math.round(raw)));
}

export function roundAmount(value: number, config: TaxAndCurrencyConfig): number {
  const safeVal = safeFinite(value, 0);
  const decimalPlaces = getSafeDecimalPlaces(config);
  const factor = Math.pow(10, decimalPlaces);
  let rounded = Math.round((safeVal + Number.EPSILON) * factor) / factor;
  if (config?.roundingMode === 'nearest_0_25') {
    rounded = Math.round(rounded * 4) / 4;
  } else if (config?.roundingMode === 'nearest_1') {
    rounded = Math.round(rounded);
  }
  return Number.isFinite(rounded) ? rounded : 0;
}

export function formatCurrency(amount: number, config: TaxAndCurrencyConfig): string {
  const safe = safeFinite(amount, 0);
  const decimalPlaces = getSafeDecimalPlaces(config);
  const symbol = typeof config?.currencySymbol === 'string' && config.currencySymbol
    ? config.currencySymbol
    : '₱';
  return `${symbol}${safe.toLocaleString('en-PH', {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  })}`;
}

export function convertToFeet(value: number, unit: ServiceConfigSelection['dimensionUnit']): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  switch (unit) {
    case 'ft':
      return value;
    case 'in':
      return value / 12;
    case 'cm':
      return value / 30.48;
    case 'm':
      return value * 3.28084;
    default:
      return value;
  }
}

export function convertToMeters(value: number, unit: ServiceConfigSelection['dimensionUnit']): number {
  return convertToFeet(value, unit) * 0.3048;
}

type FormulaToken =
  | { type: 'number'; value: number }
  | { type: 'op'; value: '+' | '-' | '*' | '/' }
  | { type: 'paren'; value: '(' | ')' };

function tokenizeFormula(
  expression: string,
  vars: Record<string, number>,
): FormulaToken[] | null {
  const tokens: FormulaToken[] = [];
  let i = 0;

  while (i < expression.length) {
    const ch = expression[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'op', value: ch });
      i += 1;
    } else if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', value: ch });
      i += 1;
    } else if (/[0-9.]/.test(ch)) {
      let numStr = '';
      let dotCount = 0;
      while (i < expression.length && /[0-9.]/.test(expression[i])) {
        if (expression[i] === '.') dotCount += 1;
        numStr += expression[i];
        i += 1;
      }
      if (dotCount > 1 || numStr === '.') return null;
      const parsed = Number(numStr);
      if (!Number.isFinite(parsed)) return null;
      tokens.push({ type: 'number', value: parsed });
    } else if (/[a-zA-Z_]/.test(ch)) {
      let ident = '';
      while (i < expression.length && /[a-zA-Z0-9_]/.test(expression[i])) {
        ident += expression[i];
        i += 1;
      }
      if (!Object.prototype.hasOwnProperty.call(vars, ident)) {
        return null;
      }
      const val = safeFinite(vars[ident], 0);
      tokens.push({ type: 'number', value: val });
    } else {
      return null;
    }

    if (tokens.length > MAX_FORMULA_TOKENS) {
      return null;
    }
  }

  return tokens;
}

export function evaluateFormulaExpression(
  expression: string | undefined,
  vars: Record<string, number>,
): number | null {
  if (typeof expression !== 'string') return null;
  const trimmed = expression.trim();
  if (!trimmed || trimmed.length > MAX_FORMULA_LENGTH) return null;

  const tokens = tokenizeFormula(trimmed, vars ?? {});
  if (!tokens || tokens.length === 0) return null;

  let pos = 0;
  const peek = (): FormulaToken | undefined => tokens[pos];
  const consume = (): FormulaToken => tokens[pos++];

  function parseExpression(): number | null {
    let left = parseTerm();
    if (left === null) return null;

    while (true) {
      const next = peek();
      if (!next || next.type !== 'op' || (next.value !== '+' && next.value !== '-')) {
        break;
      }
      consume();
      const right = parseTerm();
      if (right === null) return null;
      left = next.value === '+' ? left + right : left - right;
      if (!Number.isFinite(left)) return null;
    }
    return left;
  }

  function parseTerm(): number | null {
    let left = parseFactor();
    if (left === null) return null;

    while (true) {
      const next = peek();
      if (!next || next.type !== 'op' || (next.value !== '*' && next.value !== '/')) {
        break;
      }
      consume();
      const right = parseFactor();
      if (right === null) return null;
      if (next.value === '/') {
        if (right === 0) return null;
        left = left / right;
      } else {
        left = left * right;
      }
      if (!Number.isFinite(left)) return null;
    }
    return left;
  }

  function parseFactor(): number | null {
    const next = peek();
    if (!next) return null;

    if (next.type === 'op' && (next.value === '+' || next.value === '-')) {
      consume();
      const operand = parseFactor();
      if (operand === null) return null;
      return next.value === '-' ? -operand : operand;
    }

    if (next.type === 'number') {
      consume();
      return next.value;
    }

    if (next.type === 'paren' && next.value === '(') {
      consume();
      const inner = parseExpression();
      const closing = peek();
      if (inner === null || !closing || closing.type !== 'paren' || closing.value !== ')') {
        return null;
      }
      consume();
      return inner;
    }

    return null;
  }

  const result = parseExpression();
  if (result === null || pos !== tokens.length) return null;
  return Number.isFinite(result) && result >= 0 ? result : null;
}

export function getDefaultServiceSelection(service: PrintService): ServiceConfigSelection {
  const selectedAttributes: Record<string, string> = {};
  const groups = Array.isArray(service?.attributeGroups) ? service.attributeGroups : [];
  for (const group of groups) {
    if (!group || !group.key) continue;
    const options = Array.isArray(group.options) ? group.options : [];
    if (group.defaultOptionId) {
      selectedAttributes[group.key] = group.defaultOptionId;
    } else if (options.length > 0) {
      selectedAttributes[group.key] = options[0].id;
    }
  }
  return {
    quantity: 1,
    pages: 1,
    copies: 1,
    width: service?.allowCustomDimensions ? 3 : 1,
    height: service?.allowCustomDimensions ? 2 : 1,
    dimensionUnit: 'ft',
    selectedAttributes,
    isRush: false,
    designFee: safeNonNegative(service?.defaultDesignFee, 0),
    laborFee: 0,
    notes: '',
  };
}

export function calculateServicePrice(
  service: PrintService,
  config: ServiceConfigSelection,
  taxCurrency: TaxAndCurrencyConfig,
): PricingCalculationResult {
  const qty = Math.max(1, safeFinite(config?.quantity, 1));
  const pages = Math.max(1, safeFinite(config?.pages, 1));
  const copies = Math.max(1, safeFinite(config?.copies, 1));
  const rawWidth = safeNonNegative(config?.width, 1);
  const rawHeight = safeNonNegative(config?.height, 1);
  const unit = config?.dimensionUnit ?? 'ft';

  const widthFt = convertToFeet(rawWidth, unit);
  const heightFt = convertToFeet(rawHeight, unit);
  const areaSqFt = Math.max(0.1, Number((widthFt * heightFt).toFixed(4)));
  const linearFt = Math.max(0.1, Number(Math.max(widthFt, heightFt).toFixed(4)));
  const linearMeters = Math.max(
    0.1,
    Number(
      Math.max(
        convertToMeters(rawWidth, unit),
        convertToMeters(rawHeight, unit),
      ).toFixed(4),
    ),
  );

  // Attribute adjustments
  let attributesDelta = 0;
  let attributeMultiplier = 1;
  const chosenLabels: string[] = [];
  const selectedAttrs = config?.selectedAttributes ?? {};
  const attributeGroups = Array.isArray(service?.attributeGroups) ? service.attributeGroups : [];

  for (const group of attributeGroups) {
    if (!group) continue;
    const options = Array.isArray(group.options) ? group.options : [];
    const selectedId = selectedAttrs[group.key] || group.defaultOptionId;
    const option = options.find((o) => o.id === selectedId);
    if (option) {
      attributesDelta += safeFinite(option.priceDelta, 0);
      const mult = safeFinite(option.priceMultiplier, 0);
      if (mult > 0) {
        attributeMultiplier *= mult;
      }
      if (option.label) {
        chosenLabels.push(option.label);
      }
    }
  }

  // Determine effective quantity and base unit price
  let effectiveQuantity = qty;
  if (
    service.pricingMethod === 'per_page' ||
    service.pricingMethod === 'per_copy' ||
    service.pricingMethod === 'per_sheet'
  ) {
    effectiveQuantity = service.allowPagesAndCopies ? pages * copies : qty;
  } else if (service.pricingMethod === 'per_sqft') {
    effectiveQuantity = Number((areaSqFt * qty).toFixed(2));
  } else if (service.pricingMethod === 'per_linear_ft') {
    effectiveQuantity = Number((linearFt * qty).toFixed(2));
  } else if (service.pricingMethod === 'per_meter') {
    effectiveQuantity = Number((linearMeters * qty).toFixed(2));
  } else if (service.pricingMethod === 'fixed') {
    effectiveQuantity = qty;
  }

  // Check bulk tiers
  let resolvedBasePrice = safeNonNegative(service.basePrice, 0);
  const bulkTiers = Array.isArray(service.bulkTiers) ? service.bulkTiers : [];
  if (bulkTiers.length > 0) {
    const sortedTiers = [...bulkTiers].sort(
      (a, b) => safeFinite(b.minQty, 0) - safeFinite(a.minQty, 0),
    );
    const matchedTier = sortedTiers.find((t) => effectiveQuantity >= safeFinite(t.minQty, 0));
    if (matchedTier) {
      resolvedBasePrice = safeNonNegative(matchedTier.unitPrice, resolvedBasePrice);
    }
  }

  let unitPrice = Math.max(0, (resolvedBasePrice + attributesDelta) * attributeMultiplier);
  let baseSubtotal = unitPrice * effectiveQuantity;
  const designFee = safeNonNegative(config?.designFee, 0);
  const laborFee = safeNonNegative(config?.laborFee, 0);

  if (service.pricingMethod === 'formula') {
    const evaluated = evaluateFormulaExpression(service.formulaExpression, {
      base: resolvedBasePrice,
      qty,
      pages,
      copies,
      areaSqFt,
      linearFt,
      linearMeters,
      attrDelta: attributesDelta,
      attrMult: attributeMultiplier,
      designFee,
      laborFee,
    });
    if (evaluated !== null) {
      baseSubtotal = evaluated;
      unitPrice = effectiveQuantity > 0 ? baseSubtotal / effectiveQuantity : baseSubtotal;
    }
  }

  const rushRate = safeNonNegative(service.rushFeePercent, 25);
  const rushAmount =
    service.allowRushFee && config?.isRush
      ? baseSubtotal * ((rushRate > 0 ? rushRate : 25) / 100)
      : 0;
  const extraFees = designFee + laborFee;
  const rawTotal = Math.max(0, baseSubtotal + rushAmount + extraFees);

  const lineSubtotal = roundAmount(rawTotal, taxCurrency);
  const roundedUnitPrice = roundAmount(unitPrice, taxCurrency);
  const estimatedCost = roundAmount(
    safeNonNegative(service.costEstimate, 0) * effectiveQuantity,
    taxCurrency,
  );

  const summaryParts: string[] = [];
  if (service.allowCustomDimensions) {
    summaryParts.push(`${rawWidth}×${rawHeight} ${unit}`);
  }
  if (service.allowPagesAndCopies && (pages > 1 || copies > 1)) {
    summaryParts.push(`${pages}p × ${copies}c`);
  }
  if (chosenLabels.length > 0) {
    summaryParts.push(chosenLabels.join(' · '));
  }
  if (config?.isRush) {
    summaryParts.push('Rush');
  }

  return {
    unitPrice: roundedUnitPrice,
    effectiveQuantity,
    areaSqFt,
    linearFt,
    linearMeters,
    baseSubtotal: roundAmount(baseSubtotal, taxCurrency),
    attributesDelta,
    rushAmount: roundAmount(rushAmount, taxCurrency),
    extraFees: roundAmount(extraFees, taxCurrency),
    lineSubtotal,
    estimatedCost,
    displaySummary: summaryParts.join(' · ') || `${effectiveQuantity} ${service.unitLabel || 'pc'}`,
  };
}

export function calculateCartItemTotals(
  item: Omit<CartItem, 'lineDiscount' | 'lineTotal'>,
  taxCurrency: TaxAndCurrencyConfig,
): Pick<CartItem, 'lineDiscount' | 'lineTotal'> {
  const safeLineSubtotal = safeNonNegative(item?.lineSubtotal, 0);
  const safeDiscountVal = safeNonNegative(item?.discountValue, 0);

  let discount = 0;
  if (item?.discountType === 'percent') {
    discount = safeLineSubtotal * (Math.min(100, safeDiscountVal) / 100);
  } else if (item?.discountType === 'fixed') {
    discount = Math.min(safeLineSubtotal, safeDiscountVal);
  }
  const lineDiscount = roundAmount(discount, taxCurrency);
  const lineTotal = roundAmount(Math.max(0, safeLineSubtotal - lineDiscount), taxCurrency);
  return { lineDiscount, lineTotal };
}

export function calculateOrderTotals(
  items: CartItem[],
  orderDiscountType: 'none' | 'percent' | 'fixed',
  orderDiscountValue: number,
  taxCurrency: TaxAndCurrencyConfig,
) {
  const safeItems = Array.isArray(items) ? items : [];
  const subtotal = roundAmount(
    safeItems.reduce((sum, item) => sum + safeNonNegative(item?.lineSubtotal, 0), 0),
    taxCurrency,
  );
  const itemDiscountsTotal = roundAmount(
    safeItems.reduce((sum, item) => sum + safeNonNegative(item?.lineDiscount, 0), 0),
    taxCurrency,
  );
  const afterItemDiscounts = Math.max(0, subtotal - itemDiscountsTotal);
  const safeOrderDiscountVal = safeNonNegative(orderDiscountValue, 0);

  let orderDiscountAmount = 0;
  if (orderDiscountType === 'percent') {
    orderDiscountAmount = afterItemDiscounts * (Math.min(100, safeOrderDiscountVal) / 100);
  } else if (orderDiscountType === 'fixed') {
    orderDiscountAmount = Math.min(afterItemDiscounts, safeOrderDiscountVal);
  }
  orderDiscountAmount = roundAmount(orderDiscountAmount, taxCurrency);

  const taxableBase = Math.max(0, afterItemDiscounts - orderDiscountAmount);
  let taxAmount = 0;
  let totalAmount = taxableBase;

  const safeTaxRate = Math.min(100, safeNonNegative(taxCurrency?.taxRatePercent, 0));
  if (taxCurrency?.taxEnabled && safeTaxRate > 0) {
    const rate = safeTaxRate / 100;
    if (taxCurrency.taxInclusive) {
      taxAmount = roundAmount(taxableBase - taxableBase / (1 + rate), taxCurrency);
      totalAmount = roundAmount(taxableBase, taxCurrency);
    } else {
      taxAmount = roundAmount(taxableBase * rate, taxCurrency);
      totalAmount = roundAmount(taxableBase + taxAmount, taxCurrency);
    }
  } else {
    totalAmount = roundAmount(taxableBase, taxCurrency);
  }

  return {
    subtotal,
    itemDiscountsTotal,
    orderDiscountAmount,
    taxAmount,
    totalAmount,
  };
}
