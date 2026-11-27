import type { InventoryItem } from '../types/inventory.ts';
import { extractSupplierInfo } from './inventoryModel.ts';

export type ScanMatchMethod = 'barcode' | 'sku' | 'supplier_sku' | 'id';

export interface ParsedScanPayload {
  rawCode: string;
  normalizedCode: string;
  lookupCandidates: string[];
  suggestedQty?: number;
  suggestedUnitCost?: number;
}

export interface InventoryScanMatchResult {
  rawCode: string;
  normalizedCode: string;
  item: InventoryItem | null;
  matchedBy: ScanMatchMethod | null;
  suggestedQty?: number;
  suggestedUnitCost?: number;
}

const MAX_SCAN_INPUT_LENGTH = 4096;

function parsePositiveNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0 || num > 1_000_000) return undefined;
  return Number(num.toFixed(2));
}

function parseNonNegativeNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 10_000_000) return undefined;
  return Number(num.toFixed(2));
}

export function parseScannedCodePayload(raw: string): ParsedScanPayload {
  if (typeof raw !== 'string') {
    return {
      rawCode: '',
      normalizedCode: '',
      lookupCandidates: [],
    };
  }
  const rawCode = raw.trim().slice(0, MAX_SCAN_INPUT_LENGTH);
  if (!rawCode) {
    return {
      rawCode: '',
      normalizedCode: '',
      lookupCandidates: [],
    };
  }

  const candidates: string[] = [];
  let suggestedQty: number | undefined;
  let suggestedUnitCost: number | undefined;
  let normalizedCode = rawCode;

  const pushCandidate = (val: unknown) => {
    if (typeof val !== 'string' && typeof val !== 'number') return;
    const str = String(val).trim();
    if (str && !candidates.includes(str)) {
      candidates.push(str);
    }
  };

  // 1. JSON QR payload (e.g. {"sku":"PPR-A4-001","qty":50,"unitCost":245})
  if (rawCode.startsWith('{') && rawCode.endsWith('}')) {
    try {
      const parsed: unknown = JSON.parse(rawCode);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        pushCandidate(record.barcode);
        pushCandidate(record.sku);
        pushCandidate(record.code);
        pushCandidate(record.supplierSku);
        pushCandidate(record.supplier_sku);
        pushCandidate(record.id);
        pushCandidate(record.itemId);
        suggestedQty = parsePositiveNumber(
          record.qty ?? record.quantity ?? record.receivedQty ?? record.amount,
        );
        suggestedUnitCost = parseNonNegativeNumber(
          record.unitCost ?? record.cost ?? record.price,
        );
        if (candidates.length > 0) {
          normalizedCode = candidates[0];
        }
      }
    } catch {
      // Ignore malformed JSON and treat as plain code
    }
  }

  // 2. URL or query-string QR payload (e.g. https://shop/receive?sku=PPR-A4-001&qty=20 or sku=ABC&qty=5)
  if (
    rawCode.includes('=') &&
    (rawCode.startsWith('http://') ||
      rawCode.startsWith('https://') ||
      rawCode.includes('?') ||
      /^(sku|barcode|code|id)=/i.test(rawCode))
  ) {
    try {
      const queryPart = rawCode.includes('?')
        ? rawCode.slice(rawCode.indexOf('?') + 1)
        : rawCode;
      const params = new URLSearchParams(queryPart);
      pushCandidate(params.get('barcode'));
      pushCandidate(params.get('sku'));
      pushCandidate(params.get('code'));
      pushCandidate(params.get('supplierSku'));
      pushCandidate(params.get('id'));
      const qQty = parsePositiveNumber(
        params.get('qty') ?? params.get('quantity'),
      );
      if (qQty !== undefined && suggestedQty === undefined) {
        suggestedQty = qQty;
      }
      const qCost = parseNonNegativeNumber(
        params.get('unitCost') ?? params.get('cost'),
      );
      if (qCost !== undefined && suggestedUnitCost === undefined) {
        suggestedUnitCost = qCost;
      }
      if (candidates.length > 0) {
        normalizedCode = candidates[0];
      }
    } catch {
      // Fall back to raw code
    }
  }

  // 3. Prefixed label format (e.g. SKU:PPR-A4-001 or BARCODE:480123456)
  const prefixMatch = rawCode.match(/^(sku|barcode|code|id)\s*[:=]\s*(.+)$/i);
  if (prefixMatch && prefixMatch[2]) {
    const extracted = prefixMatch[2].trim();
    if (extracted) {
      pushCandidate(extracted);
      normalizedCode = extracted;
    }
  }

  pushCandidate(rawCode);

  return {
    rawCode,
    normalizedCode,
    lookupCandidates: candidates,
    suggestedQty,
    suggestedUnitCost,
  };
}

export function matchInventoryItemFromScan(
  rawCode: string,
  items: InventoryItem[],
): InventoryScanMatchResult {
  const parsed = parseScannedCodePayload(rawCode);
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
  if (parsed.lookupCandidates.length === 0 || safeItems.length === 0) {
    return {
      rawCode: parsed.rawCode,
      normalizedCode: parsed.normalizedCode,
      item: null,
      matchedBy: null,
      suggestedQty: parsed.suggestedQty,
      suggestedUnitCost: parsed.suggestedUnitCost,
    };
  }

  const normalizedTargets = parsed.lookupCandidates.map((c) => c.toLowerCase());

  // Pass 1: exact item.barcode
  for (const target of normalizedTargets) {
    const found = safeItems.find(
      (item) => (item.barcode || '').trim().toLowerCase() === target,
    );
    if (found) {
      return {
        rawCode: parsed.rawCode,
        normalizedCode: parsed.normalizedCode,
        item: found,
        matchedBy: 'barcode',
        suggestedQty: parsed.suggestedQty,
        suggestedUnitCost: parsed.suggestedUnitCost,
      };
    }
  }

  // Pass 2: exact item.sku
  for (const target of normalizedTargets) {
    const found = safeItems.find(
      (item) => (item.sku || '').trim().toLowerCase() === target,
    );
    if (found) {
      return {
        rawCode: parsed.rawCode,
        normalizedCode: parsed.normalizedCode,
        item: found,
        matchedBy: 'sku',
        suggestedQty: parsed.suggestedQty,
        suggestedUnitCost: parsed.suggestedUnitCost,
      };
    }
  }

  // Pass 3: exact supplierSku
  for (const target of normalizedTargets) {
    const found = safeItems.find((item) => {
      const supSku = (extractSupplierInfo(item).supplierSku || '').trim().toLowerCase();
      return supSku.length > 0 && supSku === target;
    });
    if (found) {
      return {
        rawCode: parsed.rawCode,
        normalizedCode: parsed.normalizedCode,
        item: found,
        matchedBy: 'supplier_sku',
        suggestedQty: parsed.suggestedQty,
        suggestedUnitCost: parsed.suggestedUnitCost,
      };
    }
  }

  // Pass 4: exact item.id
  for (const target of normalizedTargets) {
    const found = safeItems.find((item) => (item.id || '').trim().toLowerCase() === target);
    if (found) {
      return {
        rawCode: parsed.rawCode,
        normalizedCode: parsed.normalizedCode,
        item: found,
        matchedBy: 'id',
        suggestedQty: parsed.suggestedQty,
        suggestedUnitCost: parsed.suggestedUnitCost,
      };
    }
  }

  return {
    rawCode: parsed.rawCode,
    normalizedCode: parsed.normalizedCode,
    item: null,
    matchedBy: null,
    suggestedQty: parsed.suggestedQty,
    suggestedUnitCost: parsed.suggestedUnitCost,
  };
}
