import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Barcode,
  CheckSquare,
  Download,
  Minus,
  Plus,
  Printer,
  RotateCcw,
  Square,
} from 'lucide-react';
import type { InventoryItem } from '../../types/inventory.ts';
import type { TaxAndCurrencyConfig } from '../../shared/types.ts';
import { DEFAULT_SETTINGS } from '../../shared/defaults.ts';
import { extractSupplierInfo } from '../../shared/inventoryModel.ts';
import { formatCurrency } from '../../shared/pricingEngine.ts';
import { Button, Select } from '../ui/Primitives.tsx';
import { EmptyState, Modal } from '../ui/Overlays.tsx';
import { BarcodeSvg } from './BarcodeSvg.tsx';

type LabelLayoutPreset =
  | 'sheet_3col'
  | 'sheet_2col'
  | 'sheet_4col'
  | 'thermal_50x30'
  | 'thermal_80x40';

type BarcodeValueSource = 'sku' | 'barcode' | 'supplier_sku';

interface LayoutPresetConfig {
  id: LabelLayoutPreset;
  label: string;
  description: string;
  perPage: number | null;
  columns: number;
  isThermal: boolean;
  barcodeHeight: number;
  cellMinHeightClass: string;
  printCellCss: string;
  printGridCss: string;
}

const LABEL_LAYOUT_PRESETS: Record<LabelLayoutPreset, LayoutPresetConfig> = {
  sheet_3col: {
    id: 'sheet_3col',
    label: 'A4 / Letter · 3 Columns (21 / sheet)',
    description: 'Standard shelf & product stickers (63.5 × 38.1 mm)',
    perPage: 21,
    columns: 3,
    isThermal: false,
    barcodeHeight: 36,
    cellMinHeightClass: 'min-h-[126px]',
    printGridCss: 'grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px;',
    printCellCss: 'min-height: 38mm;',
  },
  sheet_2col: {
    id: 'sheet_2col',
    label: 'A4 / Letter · 2 Columns Large (10 / sheet)',
    description: 'Large rack, bin, and carton labels (99 × 57 mm)',
    perPage: 10,
    columns: 2,
    isThermal: false,
    barcodeHeight: 46,
    cellMinHeightClass: 'min-h-[154px]',
    printGridCss: 'grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;',
    printCellCss: 'min-height: 52mm;',
  },
  sheet_4col: {
    id: 'sheet_4col',
    label: 'A4 / Letter · 4 Columns Compact (40 / sheet)',
    description: 'Compact SKU tags for small consumables (48 × 25 mm)',
    perPage: 40,
    columns: 4,
    isThermal: false,
    barcodeHeight: 28,
    cellMinHeightClass: 'min-h-[104px]',
    printGridCss: 'grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px;',
    printCellCss: 'min-height: 26mm;',
  },
  thermal_50x30: {
    id: 'thermal_50x30',
    label: 'Thermal Roll · 50 × 30 mm',
    description: 'Single-column adhesive roll printer stream',
    perPage: null,
    columns: 1,
    isThermal: true,
    barcodeHeight: 32,
    cellMinHeightClass: 'min-h-[112px]',
    printGridCss: 'grid-template-columns: 50mm; gap: 6px; justify-content: start;',
    printCellCss: 'width: 50mm; min-height: 30mm;',
  },
  thermal_80x40: {
    id: 'thermal_80x40',
    label: 'Thermal Roll · 80 × 40 mm',
    description: 'Wide thermal shelf & rack barcode roll',
    perPage: null,
    columns: 1,
    isThermal: true,
    barcodeHeight: 42,
    cellMinHeightClass: 'min-h-[138px]',
    printGridCss: 'grid-template-columns: 80mm; gap: 8px; justify-content: start;',
    printCellCss: 'width: 80mm; min-height: 40mm;',
  },
};

export interface InventoryLabelPrintModalProps {
  open: boolean;
  onClose: () => void;
  items: InventoryItem[];
  allInventory?: InventoryItem[];
  taxAndCurrency?: TaxAndCurrencyConfig;
  businessName?: string;
}

export const InventoryLabelPrintModal: React.FC<InventoryLabelPrintModalProps> = ({
  open,
  onClose,
  items,
  allInventory = [],
  taxAndCurrency = DEFAULT_SETTINGS.taxAndCurrency,
  businessName = '',
}) => {
  const sheetRef = useRef<HTMLDivElement>(null);

  const [presetId, setPresetId] = useState<LabelLayoutPreset>('sheet_3col');
  const [barcodeSource, setBarcodeSource] = useState<BarcodeValueSource>('sku');
  const [showCategoryUnit, setShowCategoryUnit] = useState(true);
  const [showSupplierLocation, setShowSupplierLocation] = useState(true);
  const [showUnitCost, setShowUnitCost] = useState(false);
  const [showThresholds, setShowThresholds] = useState(false);
  const [showCutLines, setShowCutLines] = useState(true);
  const [showBusinessName, setShowBusinessName] = useState(false);
  const [useFullCatalog, setUseFullCatalog] = useState(false);
  const [copiesById, setCopiesById] = useState<Record<string, number>>({});

  const sourcePool = useMemo(() => {
    if (useFullCatalog && allInventory.length > 0) {
      return allInventory;
    }
    return items;
  }, [useFullCatalog, allInventory, items]);

  useEffect(() => {
    if (!open) return;
    setUseFullCatalog(false);
    const nextCopies: Record<string, number> = {};
    for (const item of items) {
      nextCopies[item.id] = 1;
    }
    setCopiesById(nextCopies);
  }, [open, items]);

  const handleToggleCatalogScope = (full: boolean) => {
    setUseFullCatalog(full);
    const pool = full && allInventory.length > 0 ? allInventory : items;
    setCopiesById((prev) => {
      const next: Record<string, number> = {};
      for (const item of pool) {
        next[item.id] = prev[item.id] ?? 1;
      }
      return next;
    });
  };

  const setItemCopies = (id: string, rawCount: number) => {
    const clamped = Math.max(0, Math.min(99, Math.round(rawCount) || 0));
    setCopiesById((prev) => ({ ...prev, [id]: clamped }));
  };

  const setAllCopies = (count: number) => {
    const next: Record<string, number> = {};
    for (const item of sourcePool) {
      next[item.id] = count;
    }
    setCopiesById(next);
  };

  const resolveBarcodeValue = (item: InventoryItem): string => {
    if (barcodeSource === 'barcode') {
      return (item.barcode || '').trim() || item.sku;
    }
    if (barcodeSource === 'supplier_sku') {
      const sup = extractSupplierInfo(item);
      return (sup.supplierSku || '').trim() || item.sku;
    }
    return item.sku;
  };

  const expandedLabels = useMemo(() => {
    const list: Array<{ key: string; item: InventoryItem; barcodeValue: string }> = [];
    for (const item of sourcePool) {
      const copies = Math.max(0, Math.min(99, copiesById[item.id] ?? 0));
      const barcodeValue = resolveBarcodeValue(item);
      for (let i = 0; i < copies; i += 1) {
        list.push({
          key: `${item.id}::${i}`,
          item,
          barcodeValue,
        });
      }
    }
    return list;
  }, [sourcePool, copiesById, barcodeSource]);

  const activeItemsCount = useMemo(
    () => sourcePool.filter((item) => (copiesById[item.id] ?? 0) > 0).length,
    [sourcePool, copiesById],
  );

  const preset = LABEL_LAYOUT_PRESETS[presetId];
  const estimatedPages =
    preset.perPage && expandedLabels.length > 0
      ? Math.ceil(expandedLabels.length / preset.perPage)
      : expandedLabels.length > 0
        ? expandedLabels.length
        : 0;

  const handlePrint = () => {
    if (expandedLabels.length === 0) return;
    window.print();
  };

  const handleExportHtml = () => {
    if (!sheetRef.current || expandedLabels.length === 0) return;
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Inventory Barcode Labels (${expandedLabels.length})</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 10mm;
      background: #ffffff;
      color: #000000;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .label-grid {
      display: grid;
      ${preset.printGridCss}
    }
    .label-card {
      ${preset.printCellCss}
      padding: 6px 8px;
      background: #ffffff;
      color: #000000;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      break-inside: avoid;
      page-break-inside: avoid;
      border: ${showCutLines ? '1px dashed #94a3b8' : '1px solid transparent'};
      border-radius: 4px;
    }
    .label-biz { font-size: 9px; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px; }
    .label-name { font-size: 11px; font-weight: 700; line-height: 1.2; color: #000000; }
    .label-meta { font-size: 9px; color: #475569; margin-top: 2px; }
    .label-barcode { margin: 5px 0 3px; width: 100%; }
    .label-barcode > div { display: flex; flex-direction: column; align-items: center; width: 100%; background: #ffffff; }
    .label-barcode svg { width: 100%; display: block; }
    .label-barcode > div > div { margin-top: 3px; font-size: 10px; line-height: 1; font-weight: 600; letter-spacing: 0.14em; font-family: ui-monospace, monospace; color: #000000; text-align: center; }
    .label-footer { display: flex; justify-content: space-between; gap: 6px; padding-top: 4px; border-top: 1px solid #e2e8f0; font-size: 9px; color: #1e293b; font-family: ui-monospace, monospace; }
    @media print {
      body { margin: 6mm; }
    }
  </style>
</head>
<body>
  <div class="label-grid">
    ${Array.from(sheetRef.current.querySelectorAll('[data-label-card="true"]'))
      .map((el) => el.outerHTML)
      .join('\n')}
  </div>
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory-barcode-labels-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const gridClassName =
    presetId === 'sheet_2col'
      ? 'grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 gap-2.5'
      : presetId === 'sheet_4col'
        ? 'grid grid-cols-2 sm:grid-cols-4 print:grid-cols-4 gap-1.5'
        : preset.isThermal
          ? 'flex flex-col items-center gap-2'
          : 'grid grid-cols-1 sm:grid-cols-3 print:grid-cols-3 gap-2';

  const thermalWidthClass =
    presetId === 'thermal_50x30'
      ? 'w-[220px]'
      : presetId === 'thermal_80x40'
        ? 'w-[320px]'
        : 'w-full';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Print Inventory Barcode Labels"
      subtitle="Configure label dimensions, barcode field, and copy counts for physical shelf or item tagging"
      maxWidth="xl"
      footer={
        <div className="w-full flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-[var(--pos-text-muted)] font-mono-num">
            {expandedLabels.length} {expandedLabels.length === 1 ? 'label' : 'labels'} across{' '}
            {activeItemsCount} {activeItemsCount === 1 ? 'item' : 'items'}
            {estimatedPages > 0 &&
              ` · ~${estimatedPages} ${
                preset.isThermal
                  ? estimatedPages === 1
                    ? 'roll tag'
                    : 'roll tags'
                  : estimatedPages === 1
                    ? 'sheet'
                    : 'sheets'
              }`}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={expandedLabels.length === 0}
              onClick={handleExportHtml}
            >
              <Download className="w-3.5 h-3.5" />
              Export HTML
            </Button>
            <Button
              size="sm"
              disabled={expandedLabels.length === 0}
              onClick={handlePrint}
            >
              <Printer className="w-3.5 h-3.5" />
              Print Labels ({expandedLabels.length})
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Configuration Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label="Label Sheet / Printer Format"
            value={presetId}
            onChange={(e) => setPresetId(e.target.value as LabelLayoutPreset)}
            options={Object.values(LABEL_LAYOUT_PRESETS).map((p) => ({
              value: p.id,
              label: p.label,
            }))}
          />
          <Select
            label="Barcode Encodes"
            value={barcodeSource}
            onChange={(e) => setBarcodeSource(e.target.value as BarcodeValueSource)}
            options={[
              { value: 'sku', label: 'Product SKU (Code 128)' },
              { value: 'barcode', label: 'Barcode / EAN (fallback to SKU)' },
              { value: 'supplier_sku', label: 'Supplier SKU (fallback to SKU)' },
            ]}
          />
        </div>

        {/* Display Options */}
        <div
          style={{ borderRadius: 'var(--pos-radius)' }}
          className="px-3.5 py-2.5 border border-[var(--pos-border)] bg-[var(--pos-bg)] flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[var(--pos-text)]"
        >
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showCategoryUnit}
              onChange={(e) => setShowCategoryUnit(e.target.checked)}
              className="h-3.5 w-3.5 rounded accent-[var(--pos-primary)] cursor-pointer"
            />
            <span>Category &amp; Unit</span>
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showSupplierLocation}
              onChange={(e) => setShowSupplierLocation(e.target.checked)}
              className="h-3.5 w-3.5 rounded accent-[var(--pos-primary)] cursor-pointer"
            />
            <span>Supplier / Rack</span>
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showUnitCost}
              onChange={(e) => setShowUnitCost(e.target.checked)}
              className="h-3.5 w-3.5 rounded accent-[var(--pos-primary)] cursor-pointer"
            />
            <span>Unit Cost</span>
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showThresholds}
              onChange={(e) => setShowThresholds(e.target.checked)}
              className="h-3.5 w-3.5 rounded accent-[var(--pos-primary)] cursor-pointer"
            />
            <span>Min / Reorder Levels</span>
          </label>
          {businessName && (
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showBusinessName}
                onChange={(e) => setShowBusinessName(e.target.checked)}
                className="h-3.5 w-3.5 rounded accent-[var(--pos-primary)] cursor-pointer"
              />
              <span>Store Header</span>
            </label>
          )}
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showCutLines}
              onChange={(e) => setShowCutLines(e.target.checked)}
              className="h-3.5 w-3.5 rounded accent-[var(--pos-primary)] cursor-pointer"
            />
            <span>Cut Guide Borders</span>
          </label>
        </div>

        {/* Item Queue & Copy Counts */}
        <div
          style={{ borderRadius: 'var(--pos-radius)' }}
          className="border border-[var(--pos-border)] overflow-hidden"
        >
          <div className="px-3.5 py-2 bg-[var(--pos-bg)] border-b border-[var(--pos-border)] flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-[var(--pos-text)]">
                Label Queue ({sourcePool.length} listed)
              </span>
              {allInventory.length > items.length && (
                <button
                  type="button"
                  onClick={() => handleToggleCatalogScope(!useFullCatalog)}
                  className="text-[var(--pos-primary)] hover:underline font-medium cursor-pointer"
                >
                  {useFullCatalog
                    ? `Show Table Selection (${items.length})`
                    : `Load All Catalog (${allInventory.length})`}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAllCopies(1)}
                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--pos-primary)] hover:underline cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                Set All 1×
              </button>
              <span className="text-[var(--pos-border)]">|</span>
              <button
                type="button"
                onClick={() => setAllCopies(0)}
                className="text-xs font-medium text-[var(--pos-text-muted)] hover:text-[var(--pos-text)] cursor-pointer"
              >
                Uncheck All
              </button>
            </div>
          </div>

          <div className="max-h-44 overflow-y-auto divide-y divide-[var(--pos-border)] bg-[var(--pos-surface)]">
            {sourcePool.map((item) => {
              const count = copiesById[item.id] ?? 0;
              const checked = count > 0;
              const code = resolveBarcodeValue(item);
              return (
                <div
                  key={item.id}
                  className="px-3.5 py-2 flex items-center justify-between gap-3 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  <button
                    type="button"
                    onClick={() => setItemCopies(item.id, checked ? 0 : 1)}
                    className="flex items-center gap-2.5 min-w-0 text-left flex-1 cursor-pointer"
                  >
                    {checked ? (
                      <CheckSquare className="w-4 h-4 text-[var(--pos-primary)] shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-[var(--pos-text-muted)] shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--pos-text)] truncate">
                        {item.name}
                      </div>
                      <div className="text-[11px] text-[var(--pos-text-muted)] font-mono-num truncate">
                        {code} · {item.category} · {item.quantityOnHand} {item.unit}
                      </div>
                    </div>
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[11px] text-[var(--pos-text-muted)] mr-1">
                      Copies
                    </span>
                    <button
                      type="button"
                      aria-label={`Decrease label copies for ${item.name}`}
                      onClick={() => setItemCopies(item.id, Math.max(0, count - 1))}
                      className="h-7 w-7 rounded border border-[var(--pos-border)] bg-[var(--pos-surface)] flex items-center justify-center text-[var(--pos-text)] hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <input
                      type="number"
                      min="0"
                      max="99"
                      aria-label={`Label copies for ${item.name}`}
                      value={count}
                      onChange={(e) => setItemCopies(item.id, Number(e.target.value))}
                      className="w-11 h-7 rounded border border-[var(--pos-border)] bg-[var(--pos-surface)] text-center font-mono-num text-xs text-[var(--pos-text)] focus:outline-none focus:border-[var(--pos-primary)]"
                    />
                    <button
                      type="button"
                      aria-label={`Increase label copies for ${item.name}`}
                      onClick={() => setItemCopies(item.id, Math.min(99, count + 1))}
                      className="h-7 w-7 rounded border border-[var(--pos-border)] bg-[var(--pos-surface)] flex items-center justify-center text-[var(--pos-text)] hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Printable Label Sheet Preview */}
        {expandedLabels.length === 0 ? (
          <EmptyState
            icon={<Barcode className="w-5 h-5" />}
            title="No labels queued for printing"
            description="Select at least one inventory item with 1 or more copies above to preview the printable barcode sheet."
            actionLabel="Queue 1 Copy Each"
            onAction={() => setAllCopies(1)}
          />
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-[var(--pos-text-muted)]">
              <span className="font-medium text-[var(--pos-text)]">
                Print Preview — {preset.description}
              </span>
              <span className="font-mono-num">
                Code 128 · Black on white
              </span>
            </div>

            <div
              style={{ borderRadius: 'var(--pos-radius)' }}
              className="p-3 border border-[var(--pos-border)] bg-slate-100 dark:bg-slate-900/70 overflow-x-auto"
            >
              <div
                id="printable-document"
                ref={sheetRef}
                className="mx-auto bg-white text-black p-4 shadow-sm max-w-[820px]"
              >
                <div className={gridClassName}>
                  {expandedLabels.map(({ key, item, barcodeValue }) => {
                    const sup = extractSupplierInfo(item);
                    const subParts: string[] = [];
                    if (showCategoryUnit) {
                      subParts.push(`${item.category} · ${item.unit}`);
                    }
                    if (showSupplierLocation) {
                      const locOrSup = [item.storageLocation, sup.name]
                        .filter(Boolean)
                        .join(' · ');
                      if (locOrSup) subParts.push(locOrSup);
                    }

                    return (
                      <div
                        key={key}
                        data-label-card="true"
                        className={`label-card break-inside-avoid bg-white text-black px-2.5 py-2 flex flex-col justify-between ${thermalWidthClass} ${preset.cellMinHeightClass} ${
                          showCutLines
                            ? 'border border-dashed border-slate-400 rounded-[3px]'
                            : 'border border-slate-200/70 print:border-transparent rounded-[3px]'
                        }`}
                      >
                        <div>
                          {showBusinessName && businessName && (
                            <div className="label-biz text-[9px] font-semibold uppercase tracking-wider text-slate-600 truncate">
                              {businessName}
                            </div>
                          )}
                          <div
                            className={`label-name font-bold text-black leading-tight line-clamp-2 ${
                              presetId === 'sheet_4col' ? 'text-[10.5px]' : 'text-xs'
                            }`}
                          >
                            {item.name}
                          </div>
                          {subParts.length > 0 && (
                            <div className="label-meta text-[9.5px] text-slate-600 leading-tight mt-0.5 truncate">
                              {subParts.join(' · ')}
                            </div>
                          )}
                        </div>

                        <div className="label-barcode my-1.5">
                          <BarcodeSvg
                            value={barcodeValue}
                            height={preset.barcodeHeight}
                            showText
                          />
                        </div>

                        {(showUnitCost || showThresholds || barcodeSource !== 'sku') && (
                          <div className="label-footer flex items-center justify-between gap-1.5 pt-1 border-t border-slate-200 text-[9px] font-mono tabular-nums text-slate-800">
                            <span className="truncate">
                              {barcodeSource !== 'sku'
                                ? `SKU ${item.sku}`
                                : showThresholds
                                  ? `Min ${item.minimumThreshold ?? 0} / Reorder ${item.reorderLevel}`
                                  : ''}
                            </span>
                            <span className="shrink-0 font-semibold">
                              {showUnitCost
                                ? `${formatCurrency(item.unitCost, taxAndCurrency)}/${item.unit}`
                                : showThresholds && barcodeSource !== 'sku'
                                  ? `Min ${item.minimumThreshold ?? 0}`
                                  : ''}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
