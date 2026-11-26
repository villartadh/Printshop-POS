import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ClipboardList,
  Copy,
  Download,
  Printer,
  RotateCcw,
} from 'lucide-react';
import { useApp } from '../../context/AppContext.tsx';
import { downloadCsv } from '../../services/hardwareService.ts';
import {
  buildReorderRequestList,
  isBelowMinimumThreshold,
} from '../../shared/inventoryModel.ts';
import { computePredictiveReorderForecasts } from '../../shared/predictiveReorderEngine.ts';
import { formatCurrency } from '../../shared/pricingEngine.ts';
import type { ReorderRequestItem, ReorderRequestScope } from '../../types/inventory.ts';
import { Button } from '../ui/Primitives.tsx';
import { EmptyState, Modal } from '../ui/Overlays.tsx';

export interface ReorderRequestModalProps {
  open: boolean;
  initialScope?: ReorderRequestScope;
  onClose: () => void;
}

export const ReorderRequestModal: React.FC<ReorderRequestModalProps> = ({
  open,
  initialScope = 'below_minimum',
  onClose,
}) => {
  const {
    inventory,
    transactions,
    services,
    stockMovements,
    settings,
    setActiveModule,
    notify,
  } = useApp();
  const taxCurr = settings.taxAndCurrency;

  const [scope, setScope] = useState<ReorderRequestScope>(initialScope);
  const [lookbackDays, setLookbackDays] = useState<14 | 30 | 60>(30);
  const [coverageDays, setCoverageDays] = useState<14 | 30 | 45>(30);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [qtyOverrides, setQtyOverrides] = useState<Record<string, number>>({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setScope(initialScope);
    setCopied(false);
  }, [open, initialScope]);

  const forecasts = useMemo(
    () =>
      computePredictiveReorderForecasts({
        inventory,
        transactions,
        services,
        stockMovements,
        lookbackDays,
        targetCoverageDays: coverageDays,
      }),
    [inventory, transactions, services, stockMovements, lookbackDays, coverageDays],
  );

  const forecastsByItemId = useMemo(
    () => new Map(forecasts.map((f) => [f.inventoryItemId, f])),
    [forecasts],
  );

  const belowMinCount = useMemo(
    () => inventory.filter((item) => isBelowMinimumThreshold(item)).length,
    [inventory],
  );

  const nearingCount = useMemo(
    () => forecasts.filter((f) => f.isNearingThreshold).length,
    [forecasts],
  );

  const allLowCount = useMemo(
    () =>
      inventory.filter((item) => {
        const stockCount = Math.max(0, Number(item.currentStock ?? item.quantityOnHand) || 0);
        const reorder = Math.max(0, Number(item.reorderLevel) || 0);
        return stockCount <= 0 || stockCount <= reorder || isBelowMinimumThreshold(item);
      }).length,
    [inventory],
  );

  const requestRows = useMemo<ReorderRequestItem[]>(() => {
    const base = buildReorderRequestList(inventory, scope, forecastsByItemId);
    return base.map((row) => {
      const override = qtyOverrides[row.inventoryItemId];
      const orderQty =
        override !== undefined && Number.isFinite(override) && override >= 0
          ? override
          : row.recommendedOrderQty;
      return {
        ...row,
        recommendedOrderQty: orderQty,
        estimatedCost: Number((orderQty * row.unitCost).toFixed(2)),
      };
    });
  }, [inventory, scope, forecastsByItemId, qtyOverrides]);

  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set(requestRows.map((r) => r.inventoryItemId)));
  }, [open, scope, inventory.length]);

  const hasOverrides = Object.keys(qtyOverrides).length > 0;

  const selectedRows = useMemo(
    () =>
      requestRows.filter(
        (row) => selectedIds.has(row.inventoryItemId) && row.recommendedOrderQty > 0,
      ),
    [requestRows, selectedIds],
  );

  const summary = useMemo(() => {
    const suppliers = new Set<string>();
    let totalCost = 0;
    let totalUnits = 0;
    for (const row of selectedRows) {
      suppliers.add(row.supplierName);
      totalCost += row.estimatedCost;
      totalUnits += row.recommendedOrderQty;
    }
    return {
      itemCount: selectedRows.length,
      supplierCount: suppliers.size,
      totalCost: Number(totalCost.toFixed(2)),
      totalUnits: Number(totalUnits.toFixed(2)),
    };
  }, [selectedRows]);

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === requestRows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(requestRows.map((r) => r.inventoryItemId)));
    }
  };

  const handleQtyChange = (id: string, raw: string) => {
    const num = Number(raw);
    if (raw === '') {
      setQtyOverrides((prev) => ({ ...prev, [id]: 0 }));
      return;
    }
    if (!Number.isFinite(num) || num < 0) return;
    setQtyOverrides((prev) => ({ ...prev, [id]: Number(num.toFixed(2)) }));
  };

  const handleCopyRequest = async () => {
    if (selectedRows.length === 0) {
      notify('Select at least one item with a non-zero order quantity.', 'error');
      return;
    }

    const bySupplier = new Map<string, ReorderRequestItem[]>();
    for (const row of selectedRows) {
      const list = bySupplier.get(row.supplierName) || [];
      list.push(row);
      bySupplier.set(row.supplierName, list);
    }

    const scopeLabel =
      scope === 'below_minimum'
        ? 'Items Below Minimum Threshold'
        : scope === 'nearing_threshold'
          ? 'Predictive Velocity: Items Nearing / Below Threshold'
          : 'All Low-Stock Items';

    const dateStamp = new Date().toLocaleDateString();
    const lines: string[] = [
      `${settings.branding.businessName} — Inventory Reorder Request (${dateStamp})`,
      `Scope: ${scopeLabel} · Target Coverage: ${coverageDays}d (${lookbackDays}d velocity window)`,
      `Items: ${summary.itemCount} · Suppliers: ${summary.supplierCount} · Est. Total: ${formatCurrency(summary.totalCost, taxCurr)}`,
      '',
    ];

    for (const [supplierName, items] of bySupplier.entries()) {
      const contact = items[0]?.supplierContact ? ` (${items[0].supplierContact})` : '';
      lines.push(`Supplier: ${supplierName}${contact}`);
      for (const item of items) {
        const skuNote = item.supplierSku ? ` [Vendor SKU: ${item.supplierSku}]` : '';
        const velocityNote =
          item.dailyVelocity && item.dailyVelocity > 0
            ? ` | Velocity: ${item.dailyVelocity}/day`
            : '';
        lines.push(
          `  - ${item.name} (${item.sku})${skuNote}: Order ${item.recommendedOrderQty} ${item.unit} | On hand: ${item.currentStock} / Min: ${item.minimumThreshold}${velocityNote} | Est. ${formatCurrency(item.estimatedCost, taxCurr)}`,
        );
      }
      lines.push('');
    }

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      notify('Reorder request list copied to clipboard.', 'success');
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      notify('Unable to access clipboard in this browser.', 'error');
    }
  };

  const handleDownloadCsv = () => {
    if (selectedRows.length === 0) {
      notify('Select at least one item with a non-zero order quantity.', 'error');
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(
      `reorder-request-${today}.csv`,
      [
        'SKU',
        'Item Name',
        'Category',
        'Supplier',
        'Supplier Contact',
        'Supplier SKU',
        'Unit',
        'Current Stock',
        'Minimum Threshold',
        'Reorder Level',
        'Daily Sales Velocity',
        'Days Until Stockout',
        'Order Quantity',
        'Unit Cost',
        'Estimated Cost',
        'Lead Time (Days)',
        'Forecast Basis',
      ],
      selectedRows.map((r) => [
        r.sku,
        r.name,
        r.category,
        r.supplierName,
        r.supplierContact,
        r.supplierSku,
        r.unit,
        r.currentStock,
        r.minimumThreshold,
        r.reorderLevel,
        r.dailyVelocity ?? 0,
        r.daysUntilStockout ?? '',
        r.recommendedOrderQty,
        r.unitCost,
        r.estimatedCost,
        r.leadTimeDays,
        r.forecastRationale || '',
      ]),
    );
    notify(`Exported ${selectedRows.length} reorder item(s) to CSV.`, 'success');
  };

  const handlePrint = () => {
    if (selectedRows.length === 0) {
      notify('Select at least one item with a non-zero order quantity.', 'error');
      return;
    }
    window.print();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Inventory Reorder Request List"
      subtitle="Velocity-predicted reorder quantities based on historical sales, lead time, and threshold buffers"
      maxWidth="xl"
      footer={
        <div className="w-full flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onClose();
              setActiveModule('inventory');
            }}
          >
            Open Inventory
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={selectedRows.length === 0}
              onClick={handlePrint}
            >
              <Printer className="w-3.5 h-3.5" />
              Print
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={selectedRows.length === 0}
              onClick={() => void handleCopyRequest()}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy List'}
            </Button>
            <Button
              size="sm"
              disabled={selectedRows.length === 0}
              onClick={handleDownloadCsv}
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </Button>
          </div>
        </div>
      }
    >
      <div id="printable-document" className="space-y-4">
        {/* Top Controls & Predictive Scope Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Reorder request scope"
            style={{ borderRadius: 'var(--pos-radius)' }}
            className="inline-flex flex-wrap items-center gap-1 p-1 bg-[var(--pos-bg)] border border-[var(--pos-border)]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'below_minimum'}
              onClick={() => setScope('below_minimum')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                scope === 'below_minimum'
                  ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs border border-[var(--pos-border)]'
                  : 'text-[var(--pos-text-muted)] hover:text-[var(--pos-text)]'
              }`}
            >
              Below Minimum ({belowMinCount})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'nearing_threshold'}
              onClick={() => setScope('nearing_threshold')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                scope === 'nearing_threshold'
                  ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs border border-[var(--pos-border)]'
                  : 'text-[var(--pos-text-muted)] hover:text-[var(--pos-text)]'
              }`}
            >
              Nearing Threshold ({nearingCount})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'all_low_stock'}
              onClick={() => setScope('all_low_stock')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                scope === 'all_low_stock'
                  ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs border border-[var(--pos-border)]'
                  : 'text-[var(--pos-text-muted)] hover:text-[var(--pos-text)]'
              }`}
            >
              All Low Stock ({allLowCount})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1 text-xs">
              <span className="text-[var(--pos-text-muted)]">Velocity:</span>
              {([14, 30, 60] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setLookbackDays(d)}
                  className={`px-2 py-1 rounded font-mono-num text-[11px] font-medium border cursor-pointer ${
                    lookbackDays === d
                      ? 'border-[var(--pos-primary)] bg-[var(--pos-primary)]/10 text-[var(--pos-primary)]'
                      : 'border-[var(--pos-border)] text-[var(--pos-text-muted)] hover:text-[var(--pos-text)]'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>

            <div className="inline-flex items-center gap-1 text-xs">
              <span className="text-[var(--pos-text-muted)]">Cover:</span>
              {([14, 30, 45] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setCoverageDays(d)}
                  className={`px-2 py-1 rounded font-mono-num text-[11px] font-medium border cursor-pointer ${
                    coverageDays === d
                      ? 'border-[var(--pos-primary)] bg-[var(--pos-primary)]/10 text-[var(--pos-primary)]'
                      : 'border-[var(--pos-border)] text-[var(--pos-text-muted)] hover:text-[var(--pos-text)]'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>

            {hasOverrides && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setQtyOverrides({})}
                title="Reset manually edited quantities to velocity forecast"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Forecast
              </Button>
            )}
          </div>
        </div>

        {/* Summary Metrics Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg border border-[var(--pos-border)] bg-[var(--pos-bg)] text-xs font-mono-num">
          <div className="text-[var(--pos-text-muted)] font-sans">
            Forecast engine uses {lookbackDays}-day sales &amp; usage velocity for {coverageDays}-day stock coverage
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <span className="text-[var(--pos-text-muted)]">Selected: </span>
              <span className="font-semibold text-[var(--pos-text)]">
                {summary.itemCount} items
              </span>
            </div>
            <div>
              <span className="text-[var(--pos-text-muted)]">Suppliers: </span>
              <span className="font-semibold text-[var(--pos-text)]">
                {summary.supplierCount}
              </span>
            </div>
            <div>
              <span className="text-[var(--pos-text-muted)]">Est. Total: </span>
              <span className="font-bold text-[var(--pos-primary)]">
                {formatCurrency(summary.totalCost, taxCurr)}
              </span>
            </div>
          </div>
        </div>

        {requestRows.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="w-5 h-5" />}
            title={
              scope === 'below_minimum'
                ? 'No items below minimum threshold'
                : scope === 'nearing_threshold'
                  ? 'No items nearing threshold'
                  : 'All inventory levels are healthy'
            }
            description={
              scope === 'below_minimum' && (nearingCount > 0 || allLowCount > 0)
                ? 'Switch to Nearing Threshold or All Low Stock above to review items approaching reorder thresholds.'
                : 'Stock levels are currently above configured thresholds.'
            }
            actionLabel={
              scope === 'below_minimum' && nearingCount > 0
                ? `View Nearing Threshold (${nearingCount})`
                : undefined
            }
            onAction={
              scope === 'below_minimum' && nearingCount > 0
                ? () => setScope('nearing_threshold')
                : undefined
            }
          />
        ) : (
          <div
            style={{ borderRadius: 'var(--pos-radius)' }}
            className="border border-[var(--pos-border)] overflow-x-auto bg-[var(--pos-surface)]"
          >
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--pos-border)] bg-[var(--pos-bg)] text-[var(--pos-text-muted)]">
                  <th className="py-2.5 px-3 w-10">
                    <input
                      type="checkbox"
                      checked={
                        requestRows.length > 0 && selectedIds.size === requestRows.length
                      }
                      onChange={toggleAll}
                      aria-label="Select all reorder items"
                      className="h-4 w-4 rounded border-[var(--pos-border)] accent-[var(--pos-primary)] cursor-pointer"
                    />
                  </th>
                  <th className="py-2.5 px-3 font-semibold">Item &amp; SKU</th>
                  <th className="py-2.5 px-3 font-semibold">Supplier</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Stock / Threshold</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Sales Velocity</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Order Qty</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Est. Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--pos-border)]">
                {requestRows.map((row) => {
                  const checked = selectedIds.has(row.inventoryItemId);
                  return (
                    <tr
                      key={row.inventoryItemId}
                      className={
                        row.isBelowMinimum || row.isOutOfStock
                          ? 'bg-red-500/[0.06]'
                          : ''
                      }
                    >
                      <td className="py-2.5 px-3 align-middle">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleItem(row.inventoryItemId)}
                          aria-label={`Include ${row.name} in reorder list`}
                          className="h-4 w-4 rounded border-[var(--pos-border)] accent-[var(--pos-primary)] cursor-pointer"
                        />
                      </td>
                      <td className="py-2.5 px-3 align-middle min-w-[180px]">
                        <div className="font-semibold text-[var(--pos-text)] flex items-center gap-1.5">
                          {(row.isBelowMinimum || row.isOutOfStock) && (
                            <AlertTriangle className="w-3.5 h-3.5 text-[var(--pos-error)] shrink-0" />
                          )}
                          <span>{row.name}</span>
                        </div>
                        <div className="text-[11px] text-[var(--pos-text-muted)] font-mono-num mt-0.5">
                          {row.sku} · {row.category}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 align-middle min-w-[140px]">
                        <div className="font-medium text-[var(--pos-text)]">
                          {row.supplierName}
                        </div>
                        {(row.supplierContact || row.leadTimeDays > 0) && (
                          <div className="text-[11px] text-[var(--pos-text-muted)] mt-0.5">
                            {[
                              row.supplierContact,
                              row.leadTimeDays > 0 ? `${row.leadTimeDays}d lead` : '',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 align-middle text-right font-mono-num whitespace-nowrap">
                        <div
                          className={`font-semibold ${
                            row.isBelowMinimum || row.isOutOfStock
                              ? 'text-[var(--pos-error)]'
                              : 'text-[var(--pos-warning)]'
                          }`}
                        >
                          {row.currentStock} {row.unit}
                        </div>
                        <div className="text-[11px] text-[var(--pos-text-muted)]">
                          {row.minimumThreshold > 0
                            ? `Min ${row.minimumThreshold} · Reorder ${row.reorderLevel}`
                            : `Reorder ${row.reorderLevel}`}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 align-middle text-right font-mono-num whitespace-nowrap">
                        {row.dailyVelocity && row.dailyVelocity > 0 ? (
                          <div>
                            <div className="font-semibold text-[var(--pos-text)]">
                              {row.dailyVelocity} {row.unit}/day
                            </div>
                            <div className="text-[11px] text-[var(--pos-text-muted)]">
                              {row.daysUntilStockout !== null && row.daysUntilStockout !== undefined
                                ? `~${row.daysUntilStockout}d left`
                                : 'Active demand'}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="text-[var(--pos-text-muted)]">0 /day</div>
                            <div className="text-[11px] text-[var(--pos-text-muted)]">
                              Baseline qty
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 align-middle text-right whitespace-nowrap">
                        <div className="inline-flex flex-col items-end gap-0.5">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              disabled={!checked}
                              value={row.recommendedOrderQty}
                              onChange={(e) =>
                                handleQtyChange(row.inventoryItemId, e.target.value)
                              }
                              aria-label={`Order quantity for ${row.name}`}
                              style={{ borderRadius: 'calc(var(--pos-radius) - 4px)' }}
                              className="w-20 h-8 px-2 text-right font-mono-num text-xs bg-[var(--pos-surface)] border border-[var(--pos-border)] text-[var(--pos-text)] focus:outline-none focus:border-[var(--pos-primary)] disabled:opacity-45"
                            />
                            <span className="text-[11px] text-[var(--pos-text-muted)] min-w-[36px] text-left">
                              {row.unit}
                            </span>
                          </div>
                          {row.forecastRationale && (
                            <span className="text-[10px] text-[var(--pos-text-muted)] max-w-[175px] truncate">
                              {row.forecastRationale}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 align-middle text-right font-mono-num font-semibold text-[var(--pos-text)] whitespace-nowrap">
                        {formatCurrency(checked ? row.estimatedCost : 0, taxCurr)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
};
