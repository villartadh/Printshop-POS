import React, { useMemo } from 'react';
import {
  ArrowLeftRight,
  CalendarClock,
  Clock,
  DollarSign,
  ExternalLink,
  Package,
  ShoppingBag,
  Truck,
} from 'lucide-react';
import { formatCurrency } from '../../shared/pricingEngine.ts';
import { extractSupplierInfo } from '../../shared/inventoryModel.ts';
import type { SupplierProfile } from '../../shared/supplierModel.ts';
import type { TaxAndCurrencyConfig } from '../../shared/types.ts';
import { Button, Card, Select, StatusIndicator } from '../ui/Primitives.tsx';

export interface SupplierComparisonViewProps {
  suppliers: SupplierProfile[];
  supplierAKey: string;
  supplierBKey: string;
  onChangeSupplierA: (key: string) => void;
  onChangeSupplierB: (key: string) => void;
  onSwapSuppliers: () => void;
  onInspectSupplier: (key: string) => void;
  taxCurrency: TaxAndCurrencyConfig;
}

function formatSignedPercent(val: number | null): string {
  if (val === null) return '—';
  return `${val > 0 ? '+' : ''}${val.toFixed(1)}%`;
}

function computePricingStats(sup: SupplierProfile) {
  const costs = sup.items.map((i) => Math.max(0, Number(i.unitCost) || 0));
  const avgUnitCost =
    costs.length > 0
      ? Number((costs.reduce((sum, c) => sum + c, 0) / costs.length).toFixed(2))
      : null;
  const minUnitCost = costs.length > 0 ? Math.min(...costs) : null;
  const maxUnitCost = costs.length > 0 ? Math.max(...costs) : null;
  const avgPoSpend =
    sup.totalOrderCount > 0
      ? Number((sup.totalOrderSpend / sup.totalOrderCount).toFixed(2))
      : null;
  return {
    avgUnitCost,
    minUnitCost,
    maxUnitCost,
    avgPoSpend,
  };
}

export const SupplierComparisonView: React.FC<SupplierComparisonViewProps> = ({
  suppliers,
  supplierAKey,
  supplierBKey,
  onChangeSupplierA,
  onChangeSupplierB,
  onSwapSuppliers,
  onInspectSupplier,
  taxCurrency,
}) => {
  const supplierA = useMemo(
    () => suppliers.find((s) => s.key === supplierAKey) ?? suppliers[0] ?? null,
    [suppliers, supplierAKey],
  );

  const supplierB = useMemo(
    () =>
      suppliers.find((s) => s.key === supplierBKey) ??
      suppliers.find((s) => s.key !== supplierA?.key) ??
      suppliers[1] ??
      null,
    [suppliers, supplierBKey, supplierA?.key],
  );

  const selectOptions = useMemo(
    () =>
      suppliers.map((s) => ({
        value: s.key,
        label: `${s.name} (${s.items.length} SKU${s.items.length === 1 ? '' : 's'} · ${s.totalOrderCount} PO${s.totalOrderCount === 1 ? '' : 's'})`,
      })),
    [suppliers],
  );

  if (suppliers.length < 2 || !supplierA || !supplierB) {
    return (
      <Card className="py-12 text-center space-y-2">
        <Truck className="w-8 h-8 mx-auto text-[var(--pos-text-muted)] opacity-45" />
        <div className="text-sm font-semibold text-[var(--pos-text)]">
          At least two suppliers are needed for side-by-side comparison
        </div>
        <p className="text-xs text-[var(--pos-text-muted)]">
          Add another supplier profile or link inventory items to a second supplier to compare pricing, lead times, and order history.
        </p>
      </Card>
    );
  }

  const statsA = computePricingStats(supplierA);
  const statsB = computePricingStats(supplierB);
  const sameSupplierSelected = supplierA.key === supplierB.key;

  const fasterLeadWinner: 'A' | 'B' | null =
    supplierA.effectiveLeadTimeDays !== supplierB.effectiveLeadTimeDays
      ? supplierA.effectiveLeadTimeDays < supplierB.effectiveLeadTimeDays
        ? 'A'
        : 'B'
      : null;

  const betterActualTransitWinner: 'A' | 'B' | null =
    supplierA.avgActualDeliveryDays !== null &&
    supplierB.avgActualDeliveryDays !== null &&
    supplierA.avgActualDeliveryDays !== supplierB.avgActualDeliveryDays
      ? supplierA.avgActualDeliveryDays < supplierB.avgActualDeliveryDays
        ? 'A'
        : 'B'
      : null;

  const betterOnTimeWinner: 'A' | 'B' | null =
    supplierA.onTimeDeliveryRate !== null &&
    supplierB.onTimeDeliveryRate !== null &&
    supplierA.onTimeDeliveryRate !== supplierB.onTimeDeliveryRate
      ? supplierA.onTimeDeliveryRate > supplierB.onTimeDeliveryRate
        ? 'A'
        : 'B'
      : null;

  const betterCostVarWinner: 'A' | 'B' | null =
    supplierA.avgCostVariancePct !== null &&
    supplierB.avgCostVariancePct !== null &&
    supplierA.avgCostVariancePct !== supplierB.avgCostVariancePct
      ? supplierA.avgCostVariancePct < supplierB.avgCostVariancePct
        ? 'A'
        : 'B'
      : null;

  const lowerAvgCostWinner: 'A' | 'B' | null =
    statsA.avgUnitCost !== null &&
    statsB.avgUnitCost !== null &&
    statsA.avgUnitCost !== statsB.avgUnitCost
      ? statsA.avgUnitCost < statsB.avgUnitCost
        ? 'A'
        : 'B'
      : null;

  const comparisonRows: Array<{
    section: 'lead' | 'pricing' | 'orders';
    label: string;
    valueA: React.ReactNode;
    valueB: React.ReactNode;
    winner?: 'A' | 'B' | null;
  }> = [
    {
      section: 'lead',
      label: 'Target Lead Time',
      valueA: (
        <span>
          {supplierA.effectiveLeadTimeDays} day
          {supplierA.effectiveLeadTimeDays === 1 ? '' : 's'}
          {supplierA.minLeadTimeDays > 0 &&
            supplierA.maxLeadTimeDays > supplierA.minLeadTimeDays && (
              <span className="text-[11px] font-normal text-[var(--pos-text-muted)] ml-1.5">
                ({supplierA.minLeadTimeDays}–{supplierA.maxLeadTimeDays}d SKUs)
              </span>
            )}
        </span>
      ),
      valueB: (
        <span>
          {supplierB.effectiveLeadTimeDays} day
          {supplierB.effectiveLeadTimeDays === 1 ? '' : 's'}
          {supplierB.minLeadTimeDays > 0 &&
            supplierB.maxLeadTimeDays > supplierB.minLeadTimeDays && (
              <span className="text-[11px] font-normal text-[var(--pos-text-muted)] ml-1.5">
                ({supplierB.minLeadTimeDays}–{supplierB.maxLeadTimeDays}d SKUs)
              </span>
            )}
        </span>
      ),
      winner: fasterLeadWinner,
    },
    {
      section: 'lead',
      label: 'Avg Actual Transit Time',
      valueA:
        supplierA.avgActualDeliveryDays !== null
          ? `${supplierA.avgActualDeliveryDays} days`
          : 'No transit logs',
      valueB:
        supplierB.avgActualDeliveryDays !== null
          ? `${supplierB.avgActualDeliveryDays} days`
          : 'No transit logs',
      winner: betterActualTransitWinner,
    },
    {
      section: 'lead',
      label: 'On-Time Delivery Rate',
      valueA:
        supplierA.onTimeDeliveryRate !== null
          ? `${supplierA.onTimeDeliveryRate.toFixed(1)}% (${supplierA.onTimeDeliveryCount}/${supplierA.trackedDeliveryCount} POs)`
          : '—',
      valueB:
        supplierB.onTimeDeliveryRate !== null
          ? `${supplierB.onTimeDeliveryRate.toFixed(1)}% (${supplierB.onTimeDeliveryCount}/${supplierB.trackedDeliveryCount} POs)`
          : '—',
      winner: betterOnTimeWinner,
    },
    {
      section: 'lead',
      label: 'Payment Terms & Contact',
      valueA: (
        <span className="font-sans font-normal text-xs text-[var(--pos-text)]">
          {supplierA.paymentTerms || 'Standard'} ·{' '}
          {supplierA.contactPerson || supplierA.phone || supplierA.email || 'No contact'}
        </span>
      ),
      valueB: (
        <span className="font-sans font-normal text-xs text-[var(--pos-text)]">
          {supplierB.paymentTerms || 'Standard'} ·{' '}
          {supplierB.contactPerson || supplierB.phone || supplierB.email || 'No contact'}
        </span>
      ),
    },
    {
      section: 'pricing',
      label: 'Avg Catalog Unit Cost',
      valueA:
        statsA.avgUnitCost !== null ? (
          <span>
            {formatCurrency(statsA.avgUnitCost, taxCurrency)}
            {statsA.minUnitCost !== null &&
              statsA.maxUnitCost !== null &&
              statsA.maxUnitCost > statsA.minUnitCost && (
                <span className="text-[11px] font-normal text-[var(--pos-text-muted)] ml-1.5">
                  ({formatCurrency(statsA.minUnitCost, taxCurrency)}–
                  {formatCurrency(statsA.maxUnitCost, taxCurrency)})
                </span>
              )}
          </span>
        ) : (
          'No linked SKUs'
        ),
      valueB:
        statsB.avgUnitCost !== null ? (
          <span>
            {formatCurrency(statsB.avgUnitCost, taxCurrency)}
            {statsB.minUnitCost !== null &&
              statsB.maxUnitCost !== null &&
              statsB.maxUnitCost > statsB.minUnitCost && (
                <span className="text-[11px] font-normal text-[var(--pos-text-muted)] ml-1.5">
                  ({formatCurrency(statsB.minUnitCost, taxCurrency)}–
                  {formatCurrency(statsB.maxUnitCost, taxCurrency)})
                </span>
              )}
          </span>
        ) : (
          'No linked SKUs'
        ),
      winner: lowerAvgCostWinner,
    },
    {
      section: 'pricing',
      label: 'Avg PO Cost Variance',
      valueA: (
        <span>
          {formatSignedPercent(supplierA.avgCostVariancePct)}
          {supplierA.avgCostVarianceAmount !== null && (
            <span className="text-[11px] font-normal text-[var(--pos-text-muted)] ml-1.5">
              ({supplierA.avgCostVarianceAmount > 0 ? '+' : supplierA.avgCostVarianceAmount < 0 ? '-' : ''}
              {formatCurrency(Math.abs(supplierA.avgCostVarianceAmount), taxCurrency)}/unit)
            </span>
          )}
        </span>
      ),
      valueB: (
        <span>
          {formatSignedPercent(supplierB.avgCostVariancePct)}
          {supplierB.avgCostVarianceAmount !== null && (
            <span className="text-[11px] font-normal text-[var(--pos-text-muted)] ml-1.5">
              ({supplierB.avgCostVarianceAmount > 0 ? '+' : supplierB.avgCostVarianceAmount < 0 ? '-' : ''}
              {formatCurrency(Math.abs(supplierB.avgCostVarianceAmount), taxCurrency)}/unit)
            </span>
          )}
        </span>
      ),
      winner: betterCostVarWinner,
    },
    {
      section: 'pricing',
      label: 'Supplied SKUs & Stock Value',
      valueA: `${supplierA.items.length} SKU${supplierA.items.length === 1 ? '' : 's'} · ${formatCurrency(supplierA.totalStockValue, taxCurrency)}`,
      valueB: `${supplierB.items.length} SKU${supplierB.items.length === 1 ? '' : 's'} · ${formatCurrency(supplierB.totalStockValue, taxCurrency)}`,
    },
    {
      section: 'orders',
      label: 'Total Logged POs',
      valueA: `${supplierA.totalOrderCount} order${supplierA.totalOrderCount === 1 ? '' : 's'}`,
      valueB: `${supplierB.totalOrderCount} order${supplierB.totalOrderCount === 1 ? '' : 's'}`,
    },
    {
      section: 'orders',
      label: 'Total Historical PO Spend',
      valueA: formatCurrency(supplierA.totalOrderSpend, taxCurrency),
      valueB: formatCurrency(supplierB.totalOrderSpend, taxCurrency),
    },
    {
      section: 'orders',
      label: 'Average PO Value',
      valueA:
        statsA.avgPoSpend !== null
          ? formatCurrency(statsA.avgPoSpend, taxCurrency)
          : '—',
      valueB:
        statsB.avgPoSpend !== null
          ? formatCurrency(statsB.avgPoSpend, taxCurrency)
          : '—',
    },
    {
      section: 'orders',
      label: 'Last Purchase Order',
      valueA: supplierA.lastOrderDate
        ? new Date(supplierA.lastOrderDate).toLocaleDateString()
        : 'No POs logged',
      valueB: supplierB.lastOrderDate
        ? new Date(supplierB.lastOrderDate).toLocaleDateString()
        : 'No POs logged',
    },
  ];

  return (
    <div className="space-y-4">
      {/* Selector Bar */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-[var(--pos-text)]">
              Compare Two Suppliers Side-by-Side
            </h3>
            <p className="text-xs text-[var(--pos-text-muted)]">
              Select any two vendors to benchmark unit pricing, delivery lead times, and purchase order history
            </p>
          </div>
          {sameSupplierSelected && (
            <StatusIndicator
              tone="warning"
              label="Select two different suppliers for comparison"
            />
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-11 gap-3 items-end">
          <div className="md:col-span-5">
            <Select
              label="Supplier A"
              value={supplierA.key}
              onChange={(e) => onChangeSupplierA(e.target.value)}
              options={selectOptions}
            />
          </div>

          <div className="md:col-span-1 flex justify-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Swap compared suppliers"
              className="h-10 w-full md:w-10 px-0 whitespace-nowrap shrink-0"
              onClick={onSwapSuppliers}
            >
              <ArrowLeftRight className="w-4 h-4" />
            </Button>
          </div>

          <div className="md:col-span-5">
            <Select
              label="Supplier B"
              value={supplierB.key}
              onChange={(e) => onChangeSupplierB(e.target.value)}
              options={selectOptions}
            />
          </div>
        </div>
      </Card>

      {/* Head-to-Head Metrics Table */}
      <Card padded={false} className="overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--pos-border)] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-[var(--pos-primary)]" />
            <h3 className="text-sm font-semibold text-[var(--pos-text)]">
              Head-to-Head Metrics: Lead Time, Pricing &amp; Order Summary
            </h3>
          </div>
          <span className="text-[11px] text-[var(--pos-text-muted)]">
            Green values indicate faster delivery or lower cost drift
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--pos-border)] text-[11px] uppercase tracking-wider text-[var(--pos-text-muted)] bg-[var(--pos-bg)]">
                <th className="py-2.5 px-4 font-semibold w-56">Metric</th>
                <th className="py-2.5 px-4 font-semibold">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--pos-text)] normal-case text-xs font-bold">
                      {supplierA.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => onInspectSupplier(supplierA.key)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium normal-case text-[var(--pos-primary)] hover:underline cursor-pointer shrink-0"
                    >
                      Profile <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                </th>
                <th className="py-2.5 px-4 font-semibold">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--pos-text)] normal-case text-xs font-bold">
                      {supplierB.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => onInspectSupplier(supplierB.key)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium normal-case text-[var(--pos-primary)] hover:underline cursor-pointer shrink-0"
                    >
                      Profile <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--pos-border)] text-xs">
              {comparisonRows.map((row) => (
                <tr key={row.label} className="hover:bg-slate-50 dark:hover:bg-slate-800/35">
                  <td className="py-2.5 px-4 font-medium text-[var(--pos-text-muted)]">
                    {row.label}
                  </td>
                  <td
                    className={`py-2.5 px-4 font-mono-num font-semibold ${
                      row.winner === 'A'
                        ? 'text-[var(--pos-success)]'
                        : 'text-[var(--pos-text)]'
                    }`}
                  >
                    {row.valueA}
                  </td>
                  <td
                    className={`py-2.5 px-4 font-mono-num font-semibold ${
                      row.winner === 'B'
                        ? 'text-[var(--pos-success)]'
                        : 'text-[var(--pos-text)]'
                    }`}
                  >
                    {row.valueB}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Side-by-Side Catalog Pricing Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[supplierA, supplierB].map((sup, idx) => (
          <Card key={`${sup.key}-pricing-${idx}`} padded={false} className="overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--pos-border)] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <DollarSign className="w-4 h-4 text-[var(--pos-primary)] shrink-0" />
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-[var(--pos-text)] truncate">
                    {sup.name} · Material Pricing ({sup.items.length})
                  </h4>
                  <p className="text-[11px] text-[var(--pos-text-muted)]">
                    Unit costs, vendor SKUs, and per-item lead times
                  </p>
                </div>
              </div>
            </div>

            {sup.items.length === 0 ? (
              <div className="py-8 px-4 text-center text-xs text-[var(--pos-text-muted)] space-y-1.5">
                <Package className="w-6 h-6 mx-auto opacity-40" />
                <div>No materials linked to {sup.name}.</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--pos-border)] text-[11px] uppercase tracking-wider text-[var(--pos-text-muted)] bg-[var(--pos-bg)]">
                      <th className="py-2 px-3 font-semibold">Material</th>
                      <th className="py-2 px-3 font-semibold text-right">Lead</th>
                      <th className="py-2 px-3 font-semibold text-right">On Hand</th>
                      <th className="py-2 px-3 font-semibold text-right">Unit Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--pos-border)] text-xs">
                    {sup.items.map((item) => {
                      const info = extractSupplierInfo(item);
                      return (
                        <tr key={item.id}>
                          <td className="py-2 px-3">
                            <div className="font-medium text-[var(--pos-text)]">
                              {item.name}
                            </div>
                            <div className="text-[11px] font-mono-num text-[var(--pos-text-muted)]">
                              {item.sku}
                              {info.supplierSku ? ` · Vendor: ${info.supplierSku}` : ''}
                            </div>
                          </td>
                          <td className="py-2 px-3 text-right font-mono-num text-[var(--pos-text)]">
                            {info.leadTimeDays || sup.effectiveLeadTimeDays}d
                          </td>
                          <td className="py-2 px-3 text-right font-mono-num text-[var(--pos-text-muted)]">
                            {item.quantityOnHand} {item.unit}
                          </td>
                          <td className="py-2 px-3 text-right font-mono-num font-semibold text-[var(--pos-text)]">
                            {formatCurrency(item.unitCost, taxCurrency)} / {item.unit}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* Side-by-Side Order History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[supplierA, supplierB].map((sup, idx) => (
          <Card key={`${sup.key}-orders-${idx}`} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[var(--pos-border)]">
              <div className="flex items-center gap-2 min-w-0">
                <CalendarClock className="w-4 h-4 text-[var(--pos-primary)] shrink-0" />
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-[var(--pos-text)] truncate">
                    {sup.name} · Order History ({sup.historicalOrders.length})
                  </h4>
                  <p className="text-[11px] font-mono-num text-[var(--pos-text-muted)]">
                    Total Spend: {formatCurrency(sup.totalOrderSpend, taxCurrency)}
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="whitespace-nowrap shrink-0"
                onClick={() => onInspectSupplier(sup.key)}
              >
                Open Details →
              </Button>
            </div>

            {sup.historicalOrders.length === 0 ? (
              <div className="py-8 text-center text-xs text-[var(--pos-text-muted)] space-y-1.5">
                <ShoppingBag className="w-6 h-6 mx-auto opacity-40" />
                <div>No purchase orders logged for {sup.name}.</div>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                {sup.historicalOrders.map((order) => (
                  <div
                    key={order.id}
                    style={{ borderRadius: 'var(--pos-radius)' }}
                    className="p-3 border border-[var(--pos-border)] bg-[var(--pos-bg)] space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold font-mono-num text-[var(--pos-text)]">
                          {order.reference}
                        </span>
                        {order.isOnTime === true ? (
                          <StatusIndicator
                            tone="success"
                            label={
                              order.daysLate !== null && order.daysLate < 0
                                ? `Early ${Math.abs(order.daysLate)}d`
                                : 'On Time'
                            }
                          />
                        ) : order.isOnTime === false ? (
                          <StatusIndicator
                            tone="error"
                            label={`Late +${order.daysLate}d`}
                          />
                        ) : (
                          <StatusIndicator tone="success" label="Received" />
                        )}
                      </div>
                      <span className="text-xs font-bold font-mono-num text-[var(--pos-text)]">
                        {formatCurrency(order.totalAmount, taxCurrency)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono-num text-[var(--pos-text-muted)]">
                      <span>
                        Received {new Date(order.occurredAt).toLocaleDateString()}
                        {order.actualDeliveryDays !== null
                          ? ` · ${order.actualDeliveryDays}d transit`
                          : ''}
                      </span>
                      {order.costVariancePct !== null && (
                        <span
                          className={`font-semibold ${
                            order.costVariancePct <= 0
                              ? 'text-[var(--pos-success)]'
                              : order.costVariancePct <= 5
                                ? 'text-[var(--pos-warning)]'
                                : 'text-[var(--pos-error)]'
                          }`}
                        >
                          Cost {formatSignedPercent(order.costVariancePct)}
                        </span>
                      )}
                    </div>

                    <div className="divide-y divide-[var(--pos-border)] border-t border-[var(--pos-border)] pt-1.5 text-[11px]">
                      {order.lines.map((line) => (
                        <div
                          key={line.movementId}
                          className="py-1 flex items-center justify-between gap-2"
                        >
                          <span className="text-[var(--pos-text)] truncate">
                            {line.itemName}
                          </span>
                          <span className="font-mono-num text-[var(--pos-text-muted)] shrink-0">
                            +{line.quantity} {line.unit} ×{' '}
                            {formatCurrency(line.unitCost, taxCurrency)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
};
