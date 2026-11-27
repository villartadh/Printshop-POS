import { describe, it, expect } from 'vitest';
import {
  matchInventoryItemFromScan,
  parseScannedCodePayload,
} from '../../shared/barcodeScannerMatch.ts';
import { DEMO_INVENTORY } from '../../shared/defaults.ts';

describe('barcodeScannerMatch', () => {
  it('handles blank scan inputs safely', () => {
    const parsed = parseScannedCodePayload('   ');
    expect(parsed.lookupCandidates).toEqual([]);
    const match = matchInventoryItemFromScan('   ', DEMO_INVENTORY);
    expect(match.item).toBeNull();
    expect(match.matchedBy).toBeNull();
  });

  it('matches exact barcode, SKU, vendor SKU, and item ID in priority order', () => {
    const byBarcode = matchInventoryItemFromScan('480001001001', DEMO_INVENTORY);
    expect(byBarcode.item?.id).toBe('inv-bond-a4');
    expect(byBarcode.matchedBy).toBe('barcode');

    const bySku = matchInventoryItemFromScan('mat-lam-a4', DEMO_INVENTORY);
    expect(bySku.item?.id).toBe('inv-lam-film');
    expect(bySku.matchedBy).toBe('sku');

    const byVendorSku = matchInventoryItemFromScan('KM-4R-260G', DEMO_INVENTORY);
    expect(byVendorSku.item?.id).toBe('inv-photo-4r');
    expect(byVendorSku.matchedBy).toBe('supplier_sku');

    const byId = matchInventoryItemFromScan('inv-ink-set', DEMO_INVENTORY);
    expect(byId.item?.id).toBe('inv-ink-set');
    expect(byId.matchedBy).toBe('id');
  });

  it('parses JSON QR payloads with suggested quantity and unit cost', () => {
    const match = matchInventoryItemFromScan(
      '{"sku":"MAT-TARP-13OZ","qty":120,"unitCost":7.25}',
      DEMO_INVENTORY,
    );
    expect(match.item?.id).toBe('inv-tarp-roll');
    expect(match.matchedBy).toBe('sku');
    expect(match.normalizedCode).toBe('MAT-TARP-13OZ');
    expect(match.suggestedQty).toBe(120);
    expect(match.suggestedUnitCost).toBe(7.25);
  });

  it('parses URL query strings and prefixed barcode labels', () => {
    const urlMatch = matchInventoryItemFromScan(
      'https://shop.local/receive?barcode=480001001003&qty=50&cost=4.2',
      DEMO_INVENTORY,
    );
    expect(urlMatch.item?.id).toBe('inv-lam-film');
    expect(urlMatch.matchedBy).toBe('barcode');
    expect(urlMatch.suggestedQty).toBe(50);
    expect(urlMatch.suggestedUnitCost).toBe(4.2);

    const prefixed = matchInventoryItemFromScan('SKU: PRD-IDL-01', DEMO_INVENTORY);
    expect(prefixed.item?.id).toBe('inv-id-lace');
    expect(prefixed.matchedBy).toBe('sku');
    expect(prefixed.normalizedCode).toBe('PRD-IDL-01');
  });

  it('returns null item with normalized code for unrecognized scans', () => {
    const unmatched = matchInventoryItemFromScan('BARCODE:999999999999', DEMO_INVENTORY);
    expect(unmatched.item).toBeNull();
    expect(unmatched.matchedBy).toBeNull();
    expect(unmatched.normalizedCode).toBe('999999999999');
  });

  it('gracefully handles non-string inputs, JSON arrays, and non-finite qty values', () => {
    const nonString = matchInventoryItemFromScan(null as unknown as string, DEMO_INVENTORY);
    expect(nonString.item).toBeNull();
    expect(nonString.normalizedCode).toBe('');

    const jsonArray = parseScannedCodePayload('["MAT-PAP-A4"]');
    expect(jsonArray.lookupCandidates).toEqual(['["MAT-PAP-A4"]']);

    const badNumbers = parseScannedCodePayload('{"sku":"MAT-PAP-A4","qty":-10,"unitCost":"NaN"}');
    expect(badNumbers.normalizedCode).toBe('MAT-PAP-A4');
    expect(badNumbers.suggestedQty).toBeUndefined();
    expect(badNumbers.suggestedUnitCost).toBeUndefined();
  });
});
