import React, { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, Clock, TrendingDown, TrendingUp } from 'lucide-react';
import { formatCurrency } from '../../shared/pricingEngine.ts';
import type { SupplierProfile } from '../../shared/supplierModel.ts';
import type { TaxAndCurrencyConfig } from '../../shared/types.ts';
import { Card, StatusIndicator } from '../ui/Primitives.tsx';
import { TopPerformersWidget } from './TopPerformersWidget.tsx';

export interface SupplierAnalyticsDashboardProps {
  suppliers: SupplierProfile[];
  selectedKey: string;
  onSelectSupplier: (key: string) => void;
  taxCurrency: TaxAndCurrencyConfig;
}

interface DeliveryChartDatum {
  key: string;
  name: string;
  shortName: string;
  onTimeRate: number;
  onTimeCount: number;
  trackedCount: number;
  lateCount: number;
  avgActualDays: number | null;
  targetLeadDays: number;
  color: string;
}

interface VarianceChartDatum {
  key: string;
  name: string;
  shortName: string;
  avgVariancePct: number;
  avgVarianceAmount: number;
  lineCount: number;
  totalOrderSpend: number;
  color: string;
}

function truncateVendorName(name: string, max = 14): string {
  const clean = name.trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function getDeliveryColor(rate: number): string {
  if (rate >= 90) return '#16A34A';
  if (rate >= 70) return '#D97706';
  return '#DC2626';
}

function getVarianceColor(pct: number): string {
  if (pct <= 0) return '#16A34A';
  if (pct <= 5) return '#D97706';
  return '#DC2626';
}

function formatSignedPct(val: number | null): string {
  if (val === null) return '—';
  const sign = val > 0 ? '+' : '';
  return `${sign}${val.toFixed(1)}%`;
}

interface DeliveryTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: DeliveryChartDatum }>;
}

const DeliveryTooltip: React.FC<DeliveryTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  return (
    <div
      style={{ borderRadius: 'var(--pos-radius)' }}
      className="px-3 py-2 border border-[var(--pos-border)] bg-[var(--pos-surface)] shadow-md text-xs space-y-1"
    >
      <div className="flex items-center gap-2 font-semibold text-[var(--pos-text)]">
        <span
          className="w-2.5 h-2.5 rounded-[2px] shrink-0"
          style={{ backgroundColor: d.color }}
        />
        <span>{d.name}</span>
      </div>
      <div className="font-mono-num font-bold text-[var(--pos-text)]">
        {d.onTimeRate.toFixed(1)}% On-Time ({d.onTimeCount}/{d.trackedCount} POs)
      </div>
      <div className="text-[11px] font-mono-num text-[var(--pos-text-muted)]">
        {d.avgActualDays !== null
          ? `Avg ${d.avgActualDays}d actual vs ${d.targetLeadDays}d promised`
          : `Target lead time: ${d.targetLeadDays}d`}
      </div>
    </div>
  );
};

interface VarianceTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: VarianceChartDatum }>;
  taxCurrency: TaxAndCurrencyConfig;
}

const VarianceTooltip: React.FC<VarianceTooltipProps> = ({
  active,
  payload,
  taxCurrency,
}) => {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  const absDelta = formatCurrency(Math.abs(d.avgVarianceAmount), taxCurrency);
  const signedDelta =
    d.avgVarianceAmount > 0
      ? `+${absDelta}`
      : d.avgVarianceAmount < 0
        ? `-${absDelta}`
        : absDelta;

  return (
    <div
      style={{ borderRadius: 'var(--pos-radius)' }}
      className="px-3 py-2 border border-[var(--pos-border)] bg-[var(--pos-surface)] shadow-md text-xs space-y-1"
    >
      <div className="flex items-center gap-2 font-semibold text-[var(--pos-text)]">
        <span
          className="w-2.5 h-2.5 rounded-[2px] shrink-0"
          style={{ backgroundColor: d.color }}
        />
        <span>{d.name}</span>
      </div>
      <div className="font-mono-num font-bold text-[var(--pos-text)]">
        {formatSignedPct(d.avgVariancePct)} Avg Cost Variance
      </div>
      <div className="text-[11px] font-mono-num text-[var(--pos-text-muted)]">
        Avg unit delta: {signedDelta} · {d.lineCount} priced PO line
        {d.lineCount === 1 ? '' : 's'}
      </div>
      <div className="text-[11px] font-mono-num text-[var(--pos-text-muted)]">
        Total PO Spend: {formatCurrency(d.totalOrderSpend, taxCurrency)}
      </div>
    </div>
  );
};

export const SupplierAnalyticsDashboard: React.FC<SupplierAnalyticsDashboardProps> = ({
  suppliers,
  selectedKey,
  onSelectSupplier,
  taxCurrency,
}) => {
  const { deliveryData, varianceData, varianceDomain, scorecardRows } = useMemo(() => {
    const withOrders = suppliers.filter(
      (s) =>
        s.totalOrderCount > 0 ||
        s.trackedDeliveryCount > 0 ||
        s.costVarianceLineCount > 0,
    );

    const delivery: DeliveryChartDatum[] = withOrders
      .filter((s) => s.trackedDeliveryCount > 0 && s.onTimeDeliveryRate !== null)
      .map((s) => ({
        key: s.key,
        name: s.name,
        shortName: truncateVendorName(s.name),
        onTimeRate: s.onTimeDeliveryRate ?? 0,
        onTimeCount: s.onTimeDeliveryCount,
        trackedCount: s.trackedDeliveryCount,
        lateCount: s.lateDeliveryCount,
        avgActualDays: s.avgActualDeliveryDays,
        targetLeadDays: s.effectiveLeadTimeDays,
        color: getDeliveryColor(s.onTimeDeliveryRate ?? 0),
      }))
      .sort((a, b) => b.onTimeRate - a.onTimeRate || a.name.localeCompare(b.name));

    const variance: VarianceChartDatum[] = withOrders
      .filter((s) => s.costVarianceLineCount > 0 && s.avgCostVariancePct !== null)
      .map((s) => ({
        key: s.key,
        name: s.name,
        shortName: truncateVendorName(s.name),
        avgVariancePct: s.avgCostVariancePct ?? 0,
        avgVarianceAmount: s.avgCostVarianceAmount ?? 0,
        lineCount: s.costVarianceLineCount,
        totalOrderSpend: s.totalOrderSpend,
        color: getVarianceColor(s.avgCostVariancePct ?? 0),
      }))
      .sort((a, b) => a.avgVariancePct - b.avgVariancePct || a.name.localeCompare(b.name));

    const pctValues = variance.map((v) => v.avgVariancePct);
    const minVar = pctValues.length > 0 ? Math.min(0, ...pctValues) : -5;
    const maxVar = pctValues.length > 0 ? Math.max(0, ...pctValues) : 5;
    const domainMin = Math.min(-5, Math.floor(minVar - 2));
    const domainMax = Math.max(5, Math.ceil(maxVar + 2));

    const rows = [...suppliers].sort(
      (a, b) => b.totalOrderSpend - a.totalOrderSpend || a.name.localeCompare(b.name),
    );

    return {
      deliveryData: delivery,
      varianceData: variance,
      varianceDomain: [domainMin, domainMax] as [number, number],
      scorecardRows: rows,
    };
  }, [suppliers]);

  if (suppliers.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* 2-Column Analytics Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Chart 1: On-Time Delivery Rate */}
        <Card className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-[var(--pos-primary)]" />
                <h3 className="text-sm font-semibold text-[var(--pos-text)]">
                  On-Time Delivery Rate by Supplier (%)
                </h3>
              </div>
              <p className="text-xs text-[var(--pos-text-muted)] mt-0.5">
                Percentage of purchase orders received on or before promised delivery date (90% target)
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-[var(--pos-text-muted)] font-mono-num shrink-0">
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-[2px] bg-[#16A34A]" /> ≥90%
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-[2px] bg-[#D97706]" /> 70–89%
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-[2px] bg-[#DC2626]" /> &lt;70%
              </span>
            </div>
          </div>

          {deliveryData.length === 0 ? (
            <div className="h-[240px] flex flex-col items-center justify-center text-center px-4 text-xs text-[var(--pos-text-muted)] space-y-1.5">
              <BarChart3 className="w-6 h-6 opacity-40" />
              <div>No purchase orders with scheduled delivery dates logged yet.</div>
              <div>Log a PO with an expected delivery date to benchmark vendor reliability.</div>
            </div>
          ) : (
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={deliveryData}
                  margin={{ top: 10, right: 12, left: -12, bottom: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="var(--pos-border)"
                  />
                  <XAxis
                    dataKey="shortName"
                    tick={{ fill: 'var(--pos-text-muted)', fontSize: 11 }}
                    axisLine={{ stroke: 'var(--pos-border)' }}
                    tickLine={false}
                    interval={0}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tickFormatter={(val: number) => `${val}%`}
                    tick={{ fill: 'var(--pos-text-muted)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                    content={<DeliveryTooltip />}
                  />
                  <ReferenceLine
                    y={90}
                    stroke="#0D9488"
                    strokeDasharray="4 4"
                    label={{
                      value: '90% Target',
                      position: 'insideTopRight',
                      fill: '#0D9488',
                      fontSize: 10,
                    }}
                  />
                  <Bar
                    dataKey="onTimeRate"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={42}
                    background={{
                      fill: 'rgba(148, 163, 184, 0.12)',
                      radius: 4,
                    }}
                    className="cursor-pointer"
                    onClick={(data) => {
                      const payload = data as unknown as { key?: string };
                      if (payload?.key) onSelectSupplier(payload.key);
                    }}
                  >
                    {deliveryData.map((entry) => {
                      const isSelected = entry.key === selectedKey;
                      return (
                        <Cell
                          key={entry.key}
                          fill={entry.color}
                          fillOpacity={isSelected ? 1 : 0.82}
                          stroke={isSelected ? 'var(--pos-text)' : 'none'}
                          strokeWidth={isSelected ? 1.5 : 0}
                        />
                      );
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Chart 2: Average Cost Variance */}
        <Card className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[var(--pos-primary)]" />
                <h3 className="text-sm font-semibold text-[var(--pos-text)]">
                  Average Cost Variance by Supplier (%)
                </h3>
              </div>
              <p className="text-xs text-[var(--pos-text-muted)] mt-0.5">
                Unit cost drift across POs vs. prior baseline (negative = cost savings, positive = price increase)
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-[var(--pos-text-muted)] font-mono-num shrink-0">
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-[2px] bg-[#16A34A]" /> ≤0%
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-[2px] bg-[#D97706]" /> 0–5%
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-[2px] bg-[#DC2626]" /> &gt;5%
              </span>
            </div>
          </div>

          {varianceData.length === 0 ? (
            <div className="h-[240px] flex flex-col items-center justify-center text-center px-4 text-xs text-[var(--pos-text-muted)] space-y-1.5">
              <TrendingDown className="w-6 h-6 opacity-40" />
              <div>Not enough repeat PO price history yet to measure cost variance.</div>
              <div>Log multiple POs per material to track vendor price stability.</div>
            </div>
          ) : (
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={varianceData}
                  margin={{ top: 10, right: 12, left: -12, bottom: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="var(--pos-border)"
                  />
                  <XAxis
                    dataKey="shortName"
                    tick={{ fill: 'var(--pos-text-muted)', fontSize: 11 }}
                    axisLine={{ stroke: 'var(--pos-border)' }}
                    tickLine={false}
                    interval={0}
                  />
                  <YAxis
                    domain={varianceDomain}
                    tickFormatter={(val: number) =>
                      `${val > 0 ? `+${val}` : val}%`
                    }
                    tick={{ fill: 'var(--pos-text-muted)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                    content={<VarianceTooltip taxCurrency={taxCurrency} />}
                  />
                  <ReferenceLine
                    y={0}
                    stroke="var(--pos-text-muted)"
                    strokeWidth={1.25}
                  />
                  <Bar
                    dataKey="avgVariancePct"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={42}
                    className="cursor-pointer"
                    onClick={(data) => {
                      const payload = data as unknown as { key?: string };
                      if (payload?.key) onSelectSupplier(payload.key);
                    }}
                  >
                    {varianceData.map((entry) => {
                      const isSelected = entry.key === selectedKey;
                      return (
                        <Cell
                          key={entry.key}
                          fill={entry.color}
                          fillOpacity={isSelected ? 1 : 0.82}
                          stroke={isSelected ? 'var(--pos-text)' : 'none'}
                          strokeWidth={isSelected ? 1.5 : 0}
                        />
                      );
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* Top Performers Ranked by Total Spending Volume */}
      <TopPerformersWidget
        suppliers={suppliers}
        selectedKey={selectedKey}
        onSelectSupplier={onSelectSupplier}
        taxCurrency={taxCurrency}
      />

      {/* Supplier Performance Scorecard Table */}
      <Card padded={false} className="overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--pos-border)] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-[var(--pos-text)]">
              Supplier Performance Scorecard
            </h3>
            <p className="text-xs text-[var(--pos-text-muted)]">
              Click any supplier row or chart bar to inspect full vendor materials, POs, and forecasts
            </p>
          </div>
          <span className="text-[11px] font-mono-num text-[var(--pos-text-muted)]">
            {scorecardRows.length} vendor{scorecardRows.length === 1 ? '' : 's'} tracked
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--pos-border)] text-[11px] uppercase tracking-wider text-[var(--pos-text-muted)] bg-[var(--pos-bg)]">
                <th className="py-2.5 px-4 font-semibold">Supplier</th>
                <th className="py-2.5 px-3 font-semibold text-right">On-Time Rate</th>
                <th className="py-2.5 px-3 font-semibold text-right">
                  Lead Time (Actual / Target)
                </th>
                <th className="py-2.5 px-3 font-semibold text-right">Avg Cost Variance</th>
                <th className="py-2.5 px-3 font-semibold text-right">Logged POs</th>
                <th className="py-2.5 px-4 font-semibold text-right">Total PO Spend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--pos-border)] text-xs">
              {scorecardRows.map((sup) => {
                const isSelected = sup.key === selectedKey;
                const rate = sup.onTimeDeliveryRate;
                const rateTone =
                  rate === null
                    ? 'neutral'
                    : rate >= 90
                      ? 'success'
                      : rate >= 70
                        ? 'warning'
                        : 'error';
                const variance = sup.avgCostVariancePct;
                const varianceColorClass =
                  variance === null
                    ? 'text-[var(--pos-text-muted)]'
                    : variance <= 0
                      ? 'text-[var(--pos-success)]'
                      : variance <= 5
                        ? 'text-[var(--pos-warning)]'
                        : 'text-[var(--pos-error)]';

                const avgDeltaFormatted =
                  sup.avgCostVarianceAmount !== null
                    ? `${sup.avgCostVarianceAmount > 0 ? '+' : sup.avgCostVarianceAmount < 0 ? '-' : ''}${formatCurrency(
                        Math.abs(sup.avgCostVarianceAmount),
                        taxCurrency,
                      )}`
                    : null;

                return (
                  <tr
                    key={sup.key}
                    onClick={() => onSelectSupplier(sup.key)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-[var(--pos-primary)]/10'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-[var(--pos-text)]">{sup.name}</div>
                      <div className="text-[11px] text-[var(--pos-text-muted)]">
                        {sup.items.length} SKU{sup.items.length === 1 ? '' : 's'}
                        {sup.paymentTerms ? ` · ${sup.paymentTerms}` : ''}
                      </div>
                    </td>

                    <td className="py-2.5 px-3 text-right font-mono-num">
                      {rate !== null ? (
                        <div className="inline-flex items-center justify-end gap-2">
                          <StatusIndicator
                            tone={rateTone}
                            label={`${rate.toFixed(1)}%`}
                          />
                          <span className="text-[11px] text-[var(--pos-text-muted)]">
                            ({sup.onTimeDeliveryCount}/{sup.trackedDeliveryCount})
                          </span>
                        </div>
                      ) : (
                        <span className="text-[var(--pos-text-muted)]">No tracked POs</span>
                      )}
                    </td>

                    <td className="py-2.5 px-3 text-right font-mono-num">
                      <span className="font-semibold text-[var(--pos-text)]">
                        {sup.avgActualDeliveryDays !== null
                          ? `${sup.avgActualDeliveryDays}d`
                          : '—'}
                      </span>
                      <span className="text-[var(--pos-text-muted)]">
                        {' '}
                        / {sup.effectiveLeadTimeDays}d
                      </span>
                    </td>

                    <td className="py-2.5 px-3 text-right font-mono-num">
                      {variance !== null ? (
                        <div>
                          <span className={`font-semibold ${varianceColorClass}`}>
                            {formatSignedPct(variance)}
                          </span>
                          {avgDeltaFormatted && (
                            <div className="text-[11px] text-[var(--pos-text-muted)]">
                              {avgDeltaFormatted} / unit
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-[var(--pos-text-muted)]">—</span>
                      )}
                    </td>

                    <td className="py-2.5 px-3 text-right font-mono-num font-medium text-[var(--pos-text)]">
                      {sup.totalOrderCount}
                    </td>

                    <td className="py-2.5 px-4 text-right font-mono-num font-semibold text-[var(--pos-text)]">
                      {formatCurrency(sup.totalOrderSpend, taxCurrency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
