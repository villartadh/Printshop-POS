import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Link2,
  Upload,
  X,
} from 'lucide-react';
import type {
  InventoryItem,
  SupplierCsvImportPayload,
  SupplierCsvMatchMethod,
} from '../../types/inventory.ts';
import type { TaxAndCurrencyConfig } from '../../shared/types.ts';
import { DEFAULT_SETTINGS } from '../../shared/defaults.ts';
import { formatCurrency } from '../../shared/pricingEngine.ts';
import {
  autoMapSupplierCsvRows,
  buildSupplierMappingPayload,
  buildSupplierSampleCsv,
  detectSupplierCsvColumns,
  parseCsvDocument,
  type ParsedCsvDocument,
  type SupplierCsvColumnMap,
} from '../../shared/supplierCsvMapper.ts';
import { Button, Select, StatusIndicator } from '../ui/Primitives.tsx';
import { EmptyState, Modal } from '../ui/Overlays.tsx';

export interface SupplierCsvImportModalProps {
  open: boolean;
  onClose: () => void;
  inventory: InventoryItem[];
  taxAndCurrency?: TaxAndCurrencyConfig;
  onApplyMappings: (payload: SupplierCsvImportPayload) => Promise<InventoryItem[] | void>;
}

type PreviewFilter = 'all' | 'matched' | 'unmatched';

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

export const SupplierCsvImportModal: React.FC<SupplierCsvImportModalProps> = ({
  open,
  onClose,
  inventory,
  taxAndCurrency = DEFAULT_SETTINGS.taxAndCurrency,
  onApplyMappings,
}) => {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [filename, setFilename] = useState('');
  const [parsedDoc, setParsedDoc] = useState<ParsedCsvDocument | null>(null);
  const [columnMap, setColumnMap] = useState<SupplierCsvColumnMap>({
    sku: -1,
    supplierName: -1,
    supplierContact: -1,
    supplierSku: -1,
    leadTimeDays: -1,
    unitCost: -1,
  });
  const [manualItemIdByRow, setManualItemIdByRow] = useState<Record<number, string>>({});
  const [selectedRows, setSelectedRows] = useState<Set<number>>(() => new Set());
  const [includeUnitCost, setIncludeUnitCost] = useState(false);
  const [previewFilter, setPreviewFilter] = useState<PreviewFilter>('all');
  const [isDragging, setIsDragging] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFilename('');
    setParsedDoc(null);
    setManualItemIdByRow({});
    setSelectedRows(new Set());
    setIncludeUnitCost(false);
    setPreviewFilter('all');
    setParseError(null);
    setSubmitError(null);
    setApplying(false);
    setIsDragging(false);
  }, [open]);

  const mappedRows = useMemo(() => {
    if (!parsedDoc || parsedDoc.rows.length === 0) return [];
    return autoMapSupplierCsvRows({
      rows: parsedDoc.rows,
      columnMap,
      inventory,
      manualItemIdByRowIndex: manualItemIdByRow,
    });
  }, [parsedDoc, columnMap, inventory, manualItemIdByRow]);

  useEffect(() => {
    if (!parsedDoc) return;
    const next = new Set<number>();
    for (const row of mappedRows) {
      if (row.matchedItems.length > 0) {
        next.add(row.rowIndex);
      }
    }
    setSelectedRows(next);
  }, [parsedDoc, columnMap, manualItemIdByRow]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    let bySku = 0;
    let bySupplierName = 0;
    let manual = 0;
    let unmatched = 0;
    for (const r of mappedRows) {
      if (r.matchMethod === 'exact_sku' || r.matchMethod === 'supplier_sku') bySku += 1;
      else if (r.matchMethod === 'supplier_name') bySupplierName += 1;
      else if (r.matchMethod === 'manual') manual += 1;
      else unmatched += 1;
    }
    return { bySku, bySupplierName, manual, unmatched, matched: bySku + bySupplierName + manual };
  }, [mappedRows]);

  const pendingPayload = useMemo(
    () => buildSupplierMappingPayload(mappedRows, selectedRows, includeUnitCost),
    [mappedRows, selectedRows, includeUnitCost],
  );

  const displayedRows = useMemo(() => {
    if (previewFilter === 'matched') {
      return mappedRows.filter((r) => r.matchedItems.length > 0);
    }
    if (previewFilter === 'unmatched') {
      return mappedRows.filter((r) => r.matchedItems.length === 0);
    }
    return mappedRows;
  }, [mappedRows, previewFilter]);

  const loadCsvFile = (file: File) => {
    setParseError(null);
    setSubmitError(null);

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setParseError('CSV file exceeds the 2 MB limit. Split large catalogs into smaller batches.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      const doc = parseCsvDocument(content);
      if (doc.headers.length === 0 || doc.rows.length === 0) {
        setParseError('The uploaded CSV has no header or data rows to map.');
        setParsedDoc(null);
        return;
      }

      const detected = detectSupplierCsvColumns(doc.headers);
      setFilename(file.name);
      setParsedDoc(doc);
      setColumnMap(detected);
      setManualItemIdByRow({});
    };
    reader.onerror = () => {
      setParseError('Unable to read the selected CSV file.');
    };
    reader.readAsText(file);
  };

  const handleDownloadSample = () => {
    const csv = buildSupplierSampleCsv(inventory);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'supplier-mapping-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleRowSelection = (rowIndex: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  };

  const handleManualAssign = (rowIndex: number, inventoryItemId: string) => {
    setManualItemIdByRow((prev) => {
      const next = { ...prev };
      if (!inventoryItemId) {
        delete next[rowIndex];
      } else {
        next[rowIndex] = inventoryItemId;
      }
      return next;
    });
  };

  const handleApply = async () => {
    if (pendingPayload.length === 0) return;
    setApplying(true);
    setSubmitError(null);
    try {
      await onApplyMappings({
        mappings: pendingPayload,
        sourceFilename: filename || undefined,
      });
      onClose();
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Unable to apply supplier mappings.',
      );
    } finally {
      setApplying(false);
    }
  };

  const columnOptions = useMemo(() => {
    if (!parsedDoc) return [{ value: '-1', label: 'Not mapped' }];
    return [
      { value: '-1', label: 'Not mapped' },
      ...parsedDoc.headers.map((h, idx) => ({
        value: String(idx),
        label: h,
      })),
    ];
  }, [parsedDoc]);

  const sortedInventoryOptions = useMemo(
    () =>
      [...inventory]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((item) => ({
          value: item.id,
          label: `${item.name} (${item.sku})`,
        })),
    [inventory],
  );

  const renderMatchBadge = (method: SupplierCsvMatchMethod) => {
    switch (method) {
      case 'exact_sku':
        return <StatusIndicator tone="success" label="SKU Match" />;
      case 'supplier_sku':
        return <StatusIndicator tone="info" label="Vendor SKU" />;
      case 'supplier_name':
        return <StatusIndicator tone="info" label="Supplier Name" />;
      case 'manual':
        return <StatusIndicator tone="success" label="Manual Map" />;
      case 'unmatched':
      default:
        return <StatusIndicator tone="warning" label="Unmatched" />;
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!applying) onClose();
      }}
      title="Import Suppliers CSV & Auto-Map"
      subtitle="Upload a supplier spreadsheet to match and update inventory items by SKU or supplier name"
      maxWidth="xl"
      footer={
        <div className="w-full flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" size="sm" type="button" onClick={handleDownloadSample}>
            <Download className="w-3.5 h-3.5" />
            Download Sample CSV
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              disabled={applying}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              type="button"
              loading={applying}
              disabled={applying || pendingPayload.length === 0}
              onClick={() => void handleApply()}
            >
              <Link2 className="w-3.5 h-3.5" />
              Apply Supplier Mappings ({pendingPayload.length}{' '}
              {pendingPayload.length === 1 ? 'item' : 'items'})
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {parseError && (
          <div
            role="alert"
            style={{ borderRadius: 'var(--pos-radius)' }}
            className="px-3.5 py-2.5 text-xs font-medium text-[var(--pos-error)] bg-[var(--pos-error)]/10 border border-[var(--pos-error)]/25 flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{parseError}</span>
          </div>
        )}

        {submitError && (
          <div
            role="alert"
            style={{ borderRadius: 'var(--pos-radius)' }}
            className="px-3.5 py-2.5 text-xs font-medium text-[var(--pos-error)] bg-[var(--pos-error)]/10 border border-[var(--pos-error)]/25 flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{submitError}</span>
          </div>
        )}

        {/* File Dropzone / Header */}
        {!parsedDoc ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) loadCsvFile(file);
            }}
            style={{ borderRadius: 'var(--pos-radius)' }}
            className={`p-8 border-2 border-dashed text-center transition-colors ${
              isDragging
                ? 'border-[var(--pos-primary)] bg-[var(--pos-primary)]/[0.06]'
                : 'border-[var(--pos-border)] bg-[var(--pos-bg)]/50'
            }`}
          >
            <div className="mx-auto w-11 h-11 rounded-xl bg-[var(--pos-primary)]/10 text-[var(--pos-primary)] flex items-center justify-center mb-3">
              <Upload className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-semibold text-[var(--pos-text)]">
              Upload Supplier CSV File
            </h3>
            <p className="text-xs text-[var(--pos-text-muted)] max-w-md mx-auto mt-1">
              Supports <span className="font-mono-num">SKU</span>,{' '}
              <span className="font-mono-num">Supplier Name</span>,{' '}
              <span className="font-mono-num">Supplier Contact</span>,{' '}
              <span className="font-mono-num">Supplier SKU</span>,{' '}
              <span className="font-mono-num">Lead Time Days</span>, and{' '}
              <span className="font-mono-num">Unit Cost</span>. Rows automatically match existing items by SKU first, then supplier name.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <input
                ref={fileInputRef}
                id={fileInputId}
                type="file"
                accept=".csv,text/csv,.txt"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) loadCsvFile(file);
                  e.target.value = '';
                }}
              />
              <Button
                type="button"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Choose CSV File
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Uploaded File Bar + Column Mapping Controls */}
            <div
              style={{ borderRadius: 'var(--pos-radius)' }}
              className="p-3.5 border border-[var(--pos-border)] bg-[var(--pos-bg)]/60 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FileSpreadsheet className="w-4 h-4 text-[var(--pos-primary)] shrink-0" />
                  <span className="text-xs font-semibold text-[var(--pos-text)] truncate">
                    {filename}
                  </span>
                  <span className="text-[11px] text-[var(--pos-text-muted)] font-mono-num">
                    · {parsedDoc.rows.length} row(s) · {parsedDoc.headers.length} column(s)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv,.txt"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) loadCsvFile(file);
                      e.target.value = '';
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Replace CSV
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setParsedDoc(null);
                      setFilename('');
                    }}
                  >
                    <X className="w-3.5 h-3.5" />
                    Clear
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                <Select
                  label="SKU Column"
                  value={String(columnMap.sku)}
                  onChange={(e) =>
                    setColumnMap((prev) => ({ ...prev, sku: Number(e.target.value) }))
                  }
                  options={columnOptions}
                />
                <Select
                  label="Supplier Name"
                  value={String(columnMap.supplierName)}
                  onChange={(e) =>
                    setColumnMap((prev) => ({ ...prev, supplierName: Number(e.target.value) }))
                  }
                  options={columnOptions}
                />
                <Select
                  label="Supplier Contact"
                  value={String(columnMap.supplierContact)}
                  onChange={(e) =>
                    setColumnMap((prev) => ({
                      ...prev,
                      supplierContact: Number(e.target.value),
                    }))
                  }
                  options={columnOptions}
                />
                <Select
                  label="Supplier SKU"
                  value={String(columnMap.supplierSku)}
                  onChange={(e) =>
                    setColumnMap((prev) => ({ ...prev, supplierSku: Number(e.target.value) }))
                  }
                  options={columnOptions}
                />
                <Select
                  label="Lead Time (Days)"
                  value={String(columnMap.leadTimeDays)}
                  onChange={(e) =>
                    setColumnMap((prev) => ({ ...prev, leadTimeDays: Number(e.target.value) }))
                  }
                  options={columnOptions}
                />
                <Select
                  label="Unit Cost"
                  value={String(columnMap.unitCost)}
                  onChange={(e) =>
                    setColumnMap((prev) => ({ ...prev, unitCost: Number(e.target.value) }))
                  }
                  options={columnOptions}
                />
              </div>

              {columnMap.unitCost >= 0 && (
                <label className="inline-flex items-center gap-2 text-xs text-[var(--pos-text)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeUnitCost}
                    onChange={(e) => setIncludeUnitCost(e.target.checked)}
                    className="h-3.5 w-3.5 rounded accent-[var(--pos-primary)] cursor-pointer"
                  />
                  <span>Also update item unit cost when present in CSV</span>
                </label>
              )}
            </div>

            {/* Match Summary & Filter Tabs */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-[var(--pos-text-muted)] font-mono-num flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 text-[var(--pos-success)] font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {stats.bySku} by SKU
                </span>
                <span aria-hidden="true">·</span>
                <span className="text-[var(--pos-primary)] font-semibold">
                  {stats.bySupplierName} by Supplier Name
                </span>
                {stats.manual > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{stats.manual} manual</span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span
                  className={
                    stats.unmatched > 0
                      ? 'text-[var(--pos-warning)] font-semibold'
                      : ''
                  }
                >
                  {stats.unmatched} unmatched
                </span>
              </div>

              <div
                role="tablist"
                aria-label="Filter mapped rows"
                style={{ borderRadius: 'var(--pos-radius)' }}
                className="inline-flex items-center gap-1 p-0.5 bg-[var(--pos-bg)] border border-[var(--pos-border)]"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={previewFilter === 'all'}
                  onClick={() => setPreviewFilter('all')}
                  className={`px-2.5 py-1 text-xs font-medium rounded cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                    previewFilter === 'all'
                      ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs'
                      : 'text-[var(--pos-text-muted)] hover:text-[var(--pos-text)]'
                  }`}
                >
                  All ({mappedRows.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={previewFilter === 'matched'}
                  onClick={() => setPreviewFilter('matched')}
                  className={`px-2.5 py-1 text-xs font-medium rounded cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                    previewFilter === 'matched'
                      ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs'
                      : 'text-[var(--pos-text-muted)] hover:text-[var(--pos-text)]'
                  }`}
                >
                  Matched ({stats.matched})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={previewFilter === 'unmatched'}
                  onClick={() => setPreviewFilter('unmatched')}
                  className={`px-2.5 py-1 text-xs font-medium rounded cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                    previewFilter === 'unmatched'
                      ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs'
                      : 'text-[var(--pos-text-muted)] hover:text-[var(--pos-text)]'
                  }`}
                >
                  Unmatched ({stats.unmatched})
                </button>
              </div>
            </div>

            {/* Preview Table */}
            {displayedRows.length === 0 ? (
              <EmptyState
                title="No rows in this filter"
                description="Switch tabs above to inspect matched or unmatched CSV rows."
                actionLabel="Show All Rows"
                onAction={() => setPreviewFilter('all')}
              />
            ) : (
              <div
                style={{ borderRadius: 'var(--pos-radius)' }}
                className="border border-[var(--pos-border)] overflow-x-auto max-h-80 overflow-y-auto"
              >
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 z-10 bg-[var(--pos-bg)] border-b border-[var(--pos-border)] text-[var(--pos-text-muted)]">
                    <tr>
                      <th className="py-2 px-3 w-9">Apply</th>
                      <th className="py-2 px-3 font-semibold">CSV Row</th>
                      <th className="py-2 px-3 font-semibold">Supplier Details</th>
                      <th className="py-2 px-3 font-semibold">Match Status</th>
                      <th className="py-2 px-3 font-semibold">Mapped Inventory Item(s)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--pos-border)] bg-[var(--pos-surface)]">
                    {displayedRows.map((row) => {
                      const canSelect = row.matchedItems.length > 0;
                      const isChecked = canSelect && selectedRows.has(row.rowIndex);
                      return (
                        <tr key={row.rowIndex} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 align-top">
                            <input
                              type="checkbox"
                              disabled={!canSelect}
                              checked={isChecked}
                              onChange={() => toggleRowSelection(row.rowIndex)}
                              aria-label={`Apply row ${row.rowIndex + 1}`}
                              className="h-4 w-4 rounded accent-[var(--pos-primary)] cursor-pointer disabled:opacity-40"
                            />
                          </td>
                          <td className="py-2.5 px-3 align-top whitespace-nowrap">
                            <div className="font-mono-num font-semibold text-[var(--pos-text)]">
                              {row.sku || '—'}
                            </div>
                            <div className="text-[11px] text-[var(--pos-text-muted)] font-mono-num">
                              Row #{row.rowIndex + 1}
                              {row.supplierSku ? ` · Vendor ${row.supplierSku}` : ''}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 align-top min-w-[180px]">
                            <div className="font-semibold text-[var(--pos-text)]">
                              {row.supplierName || '—'}
                            </div>
                            <div className="text-[11px] text-[var(--pos-text-muted)] mt-0.5">
                              {[
                                row.supplierContact,
                                row.leadTimeDays !== undefined
                                  ? `${row.leadTimeDays}d lead`
                                  : '',
                                includeUnitCost && row.unitCost !== undefined
                                  ? formatCurrency(row.unitCost, taxAndCurrency)
                                  : '',
                              ]
                                .filter(Boolean)
                                .join(' · ') || 'No contact / lead time'}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 align-top whitespace-nowrap">
                            {renderMatchBadge(row.matchMethod)}
                            <div className="text-[11px] text-[var(--pos-text-muted)] mt-0.5 max-w-[200px] truncate">
                              {row.matchDetail}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 align-top min-w-[220px]">
                            {row.matchedItems.length > 0 ? (
                              <div className="space-y-1">
                                <div className="text-xs font-medium text-[var(--pos-text)]">
                                  {row.matchedItems.length === 1
                                    ? `${row.matchedItems[0].name} (${row.matchedItems[0].sku})`
                                    : `${row.matchedItems.length} items: ${row.matchedItems
                                        .slice(0, 2)
                                        .map((i) => i.name)
                                        .join(', ')}${
                                        row.matchedItems.length > 2
                                          ? ` +${row.matchedItems.length - 2} more`
                                          : ''
                                      }`}
                                </div>
                                {row.matchMethod === 'manual' && (
                                  <button
                                    type="button"
                                    onClick={() => handleManualAssign(row.rowIndex, '')}
                                    className="text-[11px] text-[var(--pos-primary)] hover:underline cursor-pointer"
                                  >
                                    Clear manual map
                                  </button>
                                )}
                              </div>
                            ) : (
                              <Select
                                aria-label={`Manually map row ${row.rowIndex + 1}`}
                                value={manualItemIdByRow[row.rowIndex] || ''}
                                onChange={(e) => handleManualAssign(row.rowIndex, e.target.value)}
                                options={[
                                  { value: '', label: 'Skip or assign inventory item...' },
                                  ...sortedInventoryOptions,
                                ]}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};
