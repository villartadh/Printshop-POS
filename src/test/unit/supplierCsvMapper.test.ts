import { describe, it, expect } from 'vitest';
import {
  autoMapSupplierCsvRows,
  buildSupplierMappingPayload,
  detectSupplierCsvColumns,
  normalizeSupplierNameKey,
  parseCsvDocument,
} from '../../shared/supplierCsvMapper.ts';
import { DEMO_INVENTORY } from '../../shared/defaults.ts';

describe('supplierCsvMapper', () => {
  it('parses comma, semicolon, and tab CSV documents including quoted commas and BOM', () => {
    const csv = '\uFEFFSKU,Supplier Name,Unit Cost\n"MAT-PAP-A4","PaperOne Supply, Inc.",0.48\n';
    const parsed = parseCsvDocument(csv);
    expect(parsed.delimiter).toBe(',');
    expect(parsed.headers).toEqual(['SKU', 'Supplier Name', 'Unit Cost']);
    expect(parsed.rows).toEqual([['MAT-PAP-A4', 'PaperOne Supply, Inc.', '0.48']]);

    const semi = parseCsvDocument('SKU;Vendor;Lead Days\nMAT-LAM-A4;BindTech;3');
    expect(semi.delimiter).toBe(';');
    expect(semi.rows).toEqual([['MAT-LAM-A4', 'BindTech', '3']]);

    const tsv = parseCsvDocument('SKU\tVendor\nMAT-INK-CMYK\tEpson');
    expect(tsv.delimiter).toBe('\t');
    expect(tsv.rows).toEqual([['MAT-INK-CMYK', 'Epson']]);
  });

  it('auto-detects columns and normalizes supplier name keys', () => {
    const colMap = detectSupplierCsvColumns([
      'Item Code',
      'Vendor Name',
      'Supplier Email',
      'Vendor SKU',
      'Lead Time Days',
      'Unit Cost',
    ]);
    expect(colMap).toEqual({
      sku: 0,
      supplierName: 1,
      supplierContact: 2,
      supplierSku: 3,
      leadTimeDays: 4,
      unitCost: 5,
    });
    expect(normalizeSupplierNameKey('PaperOne Supply Inc.')).toBe('paperone');
  });

  it('maps rows by exact SKU, supplier SKU, supplier name, manual override, and unmatched', () => {
    const columnMap = detectSupplierCsvColumns([
      'SKU',
      'Supplier Name',
      'Supplier Contact',
      'Supplier SKU',
      'Lead Time Days',
      'Unit Cost',
    ]);

    const rows = [
      ['MAT-PAP-A4', 'PaperOne Supply', '09170001111', 'PO-NEW', '2', '0.50'],
      ['', 'Kodak', 'kodak@example.com', 'KM-4R-260G', '3', '3.10'],
      ['', 'BindTech Supplies Inc.', 'liza@bindtech.local', '', '1', '4.30'],
      ['UNKNOWN-SKU', 'Unknown Vendor', '', '', '5', '10.00'],
      ['UNKNOWN-MANUAL', 'Custom Vendor', 'custom@vendor.local', '', '7', '25.00'],
    ];

    const mapped = autoMapSupplierCsvRows({
      rows,
      columnMap,
      inventory: DEMO_INVENTORY,
      manualItemIdByRowIndex: { 4: 'inv-id-lace' },
    });

    expect(mapped[0].matchMethod).toBe('exact_sku');
    expect(mapped[0].matchedItems[0].id).toBe('inv-bond-a4');

    expect(mapped[1].matchMethod).toBe('supplier_sku');
    expect(mapped[1].matchedItems[0].id).toBe('inv-photo-4r');

    expect(mapped[2].matchMethod).toBe('supplier_name');
    expect(mapped[2].matchedItems[0].id).toBe('inv-lam-film');

    expect(mapped[3].matchMethod).toBe('unmatched');
    expect(mapped[3].matchedItems).toHaveLength(0);

    expect(mapped[4].matchMethod).toBe('manual');
    expect(mapped[4].matchedItems[0].id).toBe('inv-id-lace');

    const payloadWithoutCost = buildSupplierMappingPayload(
      mapped,
      new Set([0, 2, 3, 4]),
      false,
    );
    expect(payloadWithoutCost).toHaveLength(3);
    expect(payloadWithoutCost[0].unitCost).toBeUndefined();

    const payloadWithCost = buildSupplierMappingPayload(
      mapped,
      new Set([0]),
      true,
    );
    expect(payloadWithCost[0]).toMatchObject({
      inventoryItemId: 'inv-bond-a4',
      supplierSku: 'PO-NEW',
      leadTimeDays: 2,
      unitCost: 0.5,
    });
  });
});
