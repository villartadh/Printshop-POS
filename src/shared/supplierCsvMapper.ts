import type {
  InventoryItem,
  SupplierCsvMappingItem,
  SupplierCsvMatchMethod,
} from '../types/inventory.ts';
import { extractSupplierInfo } from './inventoryModel.ts';

export interface SupplierCsvColumnMap {
  sku: number;
  supplierName: number;
  supplierContact: number;
  supplierSku: number;
  leadTimeDays: number;
  unitCost: number;
}

export interface ParsedCsvDocument {
  headers: string[];
  rows: string[][];
  delimiter: ',' | ';' | '\t';
}

export interface MappedSupplierCsvRow {
  rowIndex: number;
  sku: string;
  supplierName: string;
  supplierContact: string;
  supplierSku: string;
  leadTimeDays: number | undefined;
  unitCost: number | undefined;
  matchMethod: SupplierCsvMatchMethod;
  matchedItems: InventoryItem[];
  matchDetail: string;
}

const MAX_CSV_ROWS = 2000;

function detectDelimiter(firstLine: string): ',' | ';' | '\t' {
  let commaCount = 0;
  let semiCount = 0;
  let tabCount = 0;
  let inQuotes = false;

  for (let i = 0; i < firstLine.length; i += 1) {
    const ch = firstLine[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (ch === ',') commaCount += 1;
      else if (ch === ';') semiCount += 1;
      else if (ch === '\t') tabCount += 1;
    }
  }

  if (tabCount > commaCount && tabCount >= semiCount) return '\t';
  if (semiCount > commaCount) return ';';
  return ',';
}

export function parseCsvDocument(rawText: string): ParsedCsvDocument {
  if (typeof rawText !== 'string' || !rawText) {
    return { headers: [], rows: [], delimiter: ',' };
  }
  const cleaned = rawText.replace(/^\uFEFF/, '');
  const firstBreak = cleaned.search(/\r?\n/);
  const sampleHeader = firstBreak >= 0 ? cleaned.slice(0, firstBreak) : cleaned;
  const delimiter = detectDelimiter(sampleHeader);

  const records: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    const next = cleaned[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentField += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentField += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && next === '\n') {
        i += 1;
      }
      currentRow.push(currentField.trim());
      currentField = '';
      if (currentRow.some((cell) => cell.length > 0)) {
        records.push(currentRow);
      }
      currentRow = [];
      if (records.length >= MAX_CSV_ROWS + 1) {
        break;
      }
    } else {
      currentField += ch;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((cell) => cell.length > 0) && records.length < MAX_CSV_ROWS + 1) {
      records.push(currentRow);
    }
  }

  if (records.length === 0) {
    return { headers: [], rows: [], delimiter };
  }

  const headers = records[0].map((h, idx) => h || `Column ${idx + 1}`);
  const rows = records.slice(1).map((row) => {
    if (row.length >= headers.length) return row;
    return [...row, ...Array(headers.length - row.length).fill('')];
  });

  return { headers, rows, delimiter };
}

function normalizeHeader(header: string): string {
  return (typeof header === 'string' ? header : '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findHeaderIndex(headers: string[], candidates: string[]): number {
  const safeHeaders = Array.isArray(headers) ? headers : [];
  const normalizedHeaders = safeHeaders.map(normalizeHeader);
  for (const candidate of candidates) {
    const exactIdx = normalizedHeaders.indexOf(candidate);
    if (exactIdx !== -1) return exactIdx;
  }
  for (const candidate of candidates) {
    const partialIdx = normalizedHeaders.findIndex(
      (h) => h === candidate || h.includes(candidate),
    );
    if (partialIdx !== -1) return partialIdx;
  }
  return -1;
}

export function detectSupplierCsvColumns(headers: string[]): SupplierCsvColumnMap {
  return {
    sku: findHeaderIndex(headers, [
      'sku',
      'item sku',
      'product sku',
      'material sku',
      'item code',
      'product code',
    ]),
    supplierName: findHeaderIndex(headers, [
      'supplier name',
      'supplier',
      'vendor name',
      'vendor',
      'company',
    ]),
    supplierContact: findHeaderIndex(headers, [
      'supplier contact',
      'contact',
      'contact info',
      'phone',
      'email',
      'supplier email',
      'supplier phone',
    ]),
    supplierSku: findHeaderIndex(headers, [
      'supplier sku',
      'vendor sku',
      'supplier code',
      'vendor code',
      'part number',
      'mpn',
    ]),
    leadTimeDays: findHeaderIndex(headers, [
      'lead time days',
      'lead time',
      'lead days',
      'delivery days',
      'eta days',
    ]),
    unitCost: findHeaderIndex(headers, [
      'unit cost',
      'supplier cost',
      'cost',
      'unit price',
    ]),
  };
}

const SUPPLIER_SUFFIX_TOKENS = new Set([
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'co',
  'company',
  'ltd',
  'llc',
  'supply',
  'supplies',
  'trading',
  'enterprise',
  'enterprises',
  'ph',
  'the',
  'and',
]);

export function normalizeSupplierNameKey(name: string): string {
  const tokens = (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return '';
  const stripped = tokens.filter((t) => !SUPPLIER_SUFFIX_TOKENS.has(t));
  return (stripped.length > 0 ? stripped : tokens).join(' ');
}

function normalizeStrictDecimalString(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Strip currency prefixes/symbols and thousands commas only, preserving invalid letters/signs
  const stripped = trimmed.replace(/^(?:PHP|USD|EUR)\s+/i, '').replace(/[$₱€,\s]/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(stripped)) return null;
  return stripped;
}

function parseOptionalNonNegativeInt(raw: string): number | undefined {
  const normalized = normalizeStrictDecimalString(raw);
  if (!normalized) return undefined;
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) return undefined;
  return Math.min(365, Math.round(num));
}

function parseOptionalNonNegativeCost(raw: string): number | undefined {
  const normalized = normalizeStrictDecimalString(raw);
  if (!normalized) return undefined;
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0 || num > 10_000_000) return undefined;
  return Number(num.toFixed(2));
}

export function autoMapSupplierCsvRows({
  rows,
  columnMap,
  inventory,
  manualItemIdByRowIndex = {},
}: {
  rows: string[][];
  columnMap: SupplierCsvColumnMap;
  inventory: InventoryItem[];
  manualItemIdByRowIndex?: Record<number, string>;
}): MappedSupplierCsvRow[] {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeInventory = Array.isArray(inventory) ? inventory.filter(Boolean) : [];
  const itemById = new Map<string, InventoryItem>();
  const itemByExactSku = new Map<string, InventoryItem>();
  const itemsByVendorSku = new Map<string, InventoryItem[]>();
  const itemsByExactSupplier = new Map<string, InventoryItem[]>();
  const itemsByNormalizedSupplier = new Map<string, InventoryItem[]>();

  for (const item of safeInventory) {
    itemById.set(item.id, item);

    const skuKey = (item.sku || '').trim().toUpperCase();
    if (skuKey && !itemByExactSku.has(skuKey)) {
      itemByExactSku.set(skuKey, item);
    }

    const sup = extractSupplierInfo(item);
    const vendorSkuKey = (sup.supplierSku || '').trim().toUpperCase();
    if (vendorSkuKey) {
      const list = itemsByVendorSku.get(vendorSkuKey) ?? [];
      list.push(item);
      itemsByVendorSku.set(vendorSkuKey, list);
    }

    const supExact = sup.name.trim().toLowerCase();
    if (supExact) {
      const list = itemsByExactSupplier.get(supExact) ?? [];
      list.push(item);
      itemsByExactSupplier.set(supExact, list);
    }

    const supNorm = normalizeSupplierNameKey(sup.name);
    if (supNorm) {
      const list = itemsByNormalizedSupplier.get(supNorm) ?? [];
      list.push(item);
      itemsByNormalizedSupplier.set(supNorm, list);
    }
  }

  return safeRows.map((row, rowIndex) => {
    const safeRow = Array.isArray(row) ? row : [];
    const cell = (idx: number) =>
      idx >= 0 && idx < safeRow.length && typeof safeRow[idx] === 'string'
        ? safeRow[idx].trim()
        : '';

    const sku = cell(columnMap.sku);
    const supplierName = cell(columnMap.supplierName);
    const supplierContact = cell(columnMap.supplierContact);
    const supplierSku = cell(columnMap.supplierSku);
    const leadTimeDays = parseOptionalNonNegativeInt(cell(columnMap.leadTimeDays));
    const unitCost = parseOptionalNonNegativeCost(cell(columnMap.unitCost));

    const manualTargetId = manualItemIdByRowIndex[rowIndex];
    if (manualTargetId) {
      const manualItem = itemById.get(manualTargetId);
      if (manualItem) {
        return {
          rowIndex,
          sku,
          supplierName,
          supplierContact,
          supplierSku,
          leadTimeDays,
          unitCost,
          matchMethod: 'manual',
          matchedItems: [manualItem],
          matchDetail: `Manually mapped to ${manualItem.name} (${manualItem.sku})`,
        };
      }
    }

    const skuUpper = sku.toUpperCase();
    if (skuUpper && itemByExactSku.has(skuUpper)) {
      const matched = itemByExactSku.get(skuUpper)!;
      return {
        rowIndex,
        sku,
        supplierName,
        supplierContact,
        supplierSku,
        leadTimeDays,
        unitCost,
        matchMethod: 'exact_sku',
        matchedItems: [matched],
        matchDetail: `Exact SKU match (${matched.sku})`,
      };
    }

    const vendorSkuUpper = (supplierSku || sku).toUpperCase();
    if (vendorSkuUpper && itemsByVendorSku.has(vendorSkuUpper)) {
      const matched = itemsByVendorSku.get(vendorSkuUpper)!;
      return {
        rowIndex,
        sku,
        supplierName,
        supplierContact,
        supplierSku,
        leadTimeDays,
        unitCost,
        matchMethod: 'supplier_sku',
        matchedItems: matched,
        matchDetail: `Matched vendor SKU (${vendorSkuUpper}) across ${matched.length} item(s)`,
      };
    }

    const supExactKey = supplierName.toLowerCase();
    if (supExactKey && itemsByExactSupplier.has(supExactKey)) {
      const matched = itemsByExactSupplier.get(supExactKey)!;
      return {
        rowIndex,
        sku,
        supplierName,
        supplierContact,
        supplierSku,
        leadTimeDays,
        unitCost,
        matchMethod: 'supplier_name',
        matchedItems: matched,
        matchDetail: `Exact supplier match across ${matched.length} item(s)`,
      };
    }

    const supNormKey = normalizeSupplierNameKey(supplierName);
    if (supNormKey && itemsByNormalizedSupplier.has(supNormKey)) {
      const matched = itemsByNormalizedSupplier.get(supNormKey)!;
      return {
        rowIndex,
        sku,
        supplierName,
        supplierContact,
        supplierSku,
        leadTimeDays,
        unitCost,
        matchMethod: 'supplier_name',
        matchedItems: matched,
        matchDetail: `Normalized supplier name match across ${matched.length} item(s)`,
      };
    }

    if (supNormKey && supNormKey.length >= 4) {
      const partialMatches: InventoryItem[] = [];
      const seenItemIds = new Set<string>();
      for (const [key, list] of itemsByNormalizedSupplier.entries()) {
        if (key.includes(supNormKey) || supNormKey.includes(key)) {
          for (const candidate of list) {
            if (!seenItemIds.has(candidate.id)) {
              seenItemIds.add(candidate.id);
              partialMatches.push(candidate);
            }
          }
        }
      }
      if (partialMatches.length > 0) {
        return {
          rowIndex,
          sku,
          supplierName,
          supplierContact,
          supplierSku,
          leadTimeDays,
          unitCost,
          matchMethod: 'supplier_name',
          matchedItems: partialMatches,
          matchDetail: `Supplier name match across ${partialMatches.length} item(s)`,
        };
      }
    }

    return {
      rowIndex,
      sku,
      supplierName,
      supplierContact,
      supplierSku,
      leadTimeDays,
      unitCost,
      matchMethod: 'unmatched',
      matchedItems: [],
      matchDetail: 'No matching SKU or supplier found',
    };
  });
}

export function buildSupplierMappingPayload(
  mappedRows: MappedSupplierCsvRow[],
  selectedRowIndices: Set<number>,
  includeUnitCost: boolean,
): SupplierCsvMappingItem[] {
  const byItemId = new Map<string, SupplierCsvMappingItem>();

  for (const row of mappedRows) {
    if (!selectedRowIndices.has(row.rowIndex) || row.matchedItems.length === 0) {
      continue;
    }

    for (const item of row.matchedItems) {
      const prev = byItemId.get(item.id);
      const next: SupplierCsvMappingItem = {
        inventoryItemId: item.id,
        matchMethod: row.matchMethod,
      };

      if (row.supplierName) next.supplier = row.supplierName;
      else if (prev?.supplier !== undefined) next.supplier = prev.supplier;

      if (row.supplierContact) next.supplierContact = row.supplierContact;
      else if (prev?.supplierContact !== undefined) next.supplierContact = prev.supplierContact;

      if (row.supplierSku) next.supplierSku = row.supplierSku;
      else if (prev?.supplierSku !== undefined) next.supplierSku = prev.supplierSku;

      if (row.leadTimeDays !== undefined) next.leadTimeDays = row.leadTimeDays;
      else if (prev?.leadTimeDays !== undefined) next.leadTimeDays = prev.leadTimeDays;

      if (includeUnitCost && row.unitCost !== undefined) next.unitCost = row.unitCost;
      else if (includeUnitCost && prev?.unitCost !== undefined) next.unitCost = prev.unitCost;

      byItemId.set(item.id, next);
    }
  }

  return Array.from(byItemId.values());
}

export function buildSupplierSampleCsv(inventory: InventoryItem[]): string {
  const headers = [
    'SKU',
    'Supplier Name',
    'Supplier Contact',
    'Supplier SKU',
    'Lead Time Days',
    'Unit Cost',
  ];

  const escapeCsv = (val: string | number) => {
    const str = String(val ?? '');
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const sampleRows: Array<Array<string | number>> = [];
  const first = inventory[0];
  const second = inventory[1];

  if (first) {
    const sup = extractSupplierInfo(first);
    sampleRows.push([
      first.sku,
      sup.name || 'Metro Paper Supply',
      sup.contact || '+63 917 555 0101',
      sup.supplierSku || `VND-${first.sku}`,
      sup.leadTimeDays ?? 3,
      first.unitCost,
    ]);
  }
  if (second) {
    const sup = extractSupplierInfo(second);
    // Demonstrate auto-mapping by Supplier Name when SKU column is left blank
    sampleRows.push([
      '',
      sup.name || 'Epson Authorized Hub',
      sup.contact || 'orders@supplier.example',
      '',
      sup.leadTimeDays ?? 4,
      '',
    ]);
  }
  if (sampleRows.length === 0) {
    sampleRows.push([
      'MAT-PAP-A4',
      'PaperOne Supply',
      '+63 2 8810 2200',
      'PO-A4-80-RM',
      2,
      0.45,
    ]);
  }

  return [
    headers.map(escapeCsv).join(','),
    ...sampleRows.map((r) => r.map(escapeCsv).join(',')),
  ].join('\n');
}
