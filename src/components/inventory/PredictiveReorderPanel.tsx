import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  ClipboardList,
  Clock,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApp } from '../../context/AppContext.tsx';
import { computePredictiveReorderForecasts } from '../../shared/predictiveReorderEngine.ts';
import { formatCurrency } from '../../shared/pricingEngine.ts';
import type { InventoryItem, PredictiveReorderForecast } from '../../types/inventory.ts';
import { Button, Card, StatusIndicator } from '../ui/Primitives.tsx';
import { EmptyState } from '../ui/Overlays.tsx';

export interface PredictiveReorderPanelProps {
  onAdjustStock?: (item: InventoryItem) => void;
  onInspectItem?: (item: InventoryItem) => void;
}

interface ChartDatum {
  name: string;
  fullName: string;
  unit: string;
  currentStock: number;
  suggestedOrderQty: number;
  thresholdBaseline: number;
  dailyVelocity: number;
}

interface ForecastChartTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ChartDatum }>;
}

const ForecastChartTooltip: React.FC<ForecastChartTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  return (
    <div
      style={{ borderRadius: 'var(--pos-radius)' }}
      className="px-3 py-2 border border-[var(--pos-border)] bg-[var(--pos-surface)] shadow-md text-xs space-y-1"
    >
      <div className="font-semibold text-[var(--pos-text)]">{d.fullName}</div>
      <div className="font-mono-num text-[var(--pos-text-muted)]">
        On Hand: <strong className="text-[var(--pos-text)]">{d.currentStock} {d.unit}</strong> ·
        Threshold: <strong className="text-[var(--pos-text)]">{d.thresholdBaseline} {d.unit}</strong>
      </div>
      <div className="font-mono-num text-[var(--pos-primary)] font-semibold">
        Suggested Order: +{d.suggestedOrderQty} {d.unit} ({d.dailyVelocity}/day velocity)
      </div>
    </div>
  );
};

export const PredictiveReorderPanel: React.FC<PredictiveReorderPanelProps> = ({
  onAdjustStock,
  onInspectItem,
}) => {
  const {
    inventory,
    transactions,
    services,
    stockMovements,
    settings,
    openReorderRequestModal,
  } = useApp();
  const taxCurr = settings.taxAndCurrency;

  const [lookbackDays, setLookbackDays] = useState<14 | 30 | 60>(30);
  const [coverageDays, setCoverageDays] = useState<14 | 30 | 45>(30);
  const [showAllItems, setShowAllItems] = useState(false);

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

  const nearingForecasts = useMemo(
    () => forecasts.filter((f) => f.isNearingThreshold),
    [forecasts],
  );

  const displayedForecasts = showAllItems ? forecasts : nearingForecasts;

  const summary = useMemo(() => {
    const velocityBacked = nearingForecasts.filter((f) => f.weightedDailyVelocity > 0);
    const earliestStockout = velocityBacked
      .filter((f) => f.daysUntilStockout !== null)
      .sort((a, b) => (a.daysUntilStockout ?? 9999) - (b.daysUntilStockout ?? 9999))[0];
    const totalEstimatedCost = nearingForecasts.reduce(
      (sum, f) => sum + f.estimatedOrderCost,
      0,
    );

    return {
      nearingCount: nearingForecasts.length,
      velocityBackedCount: velocityBacked.length,
      earliestStockout,
      totalEstimatedCost: Number(totalEstimatedCost.toFixed(2)),
    };
  }, [nearingForecasts]);

  const chartData = useMemo<ChartDatum[]>(() => {
    return nearingForecasts.slice(0, 6).map((f) => ({
      name: f.name.length > 18 ? `${f.name.slice(0, 16)}…` : f.name,
      fullName: f.name,
      unit: f.unit,
      currentStock: f.currentStock,
      suggestedOrderQty: f.suggestedOrderQty,
      thresholdBaseline: f.thresholdBaseline,
      dailyVelocity: f.weightedDailyVelocity,
    }));
  }, [nearingForecasts]);

  const inventoryMap = useMemo(
    () => new Map(inventory.map((i) => [i.id, i])),
    [inventory],
  );

  const renderConfidenceLabel = (f: PredictiveReorderForecast) => {
    if (f.confidence === 'high') {
      return <span className="text-[var(--pos-success)] font-medium">High · POS + usage</span>;
    }
    if (f.confidence === 'medium') {
      return <span className="text-[var(--pos-primary)] font-medium">Medium · Sales history</span>;
    }
    return <span className="text-[var(--pos-text-muted)]">Baseline · No recent sales</span>;
  };

  return (
    <div className="space-y-4">
      {/* Engine Controls */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[var(--pos-primary)] shrink-0" />
              <h3 className="text-sm font-semibold text-[var(--pos-text)]">
                Predictive Sales Velocity & Reorder Engine
              </h3>
            </div>
            <p className="text-xs text-[var(--pos-text-muted)] mt-0.5">
              Projects days until threshold from weighted recent sales and consumption history, factoring supplier lead times and target coverage.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Historical lookback window"
              style={{ borderRadius: 'var(--pos-radius)' }}
              className="inline-flex items-center gap-1 p-1 bg-[var(--pos-bg)] border border-[var(--pos-border)]"
            >
              <span className="px-2 text-[11px] font-medium text-[var(--pos-text-muted)]">
                History:
              </span>
              {([14, 30, 60] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setLookbackDays(d)}
                  className={`px-2 py-1 text-xs font-mono-num font-medium rounded cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                    lookbackDays === d
                      ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs border border-[var(--pos-border)]'
                      : 'text-[var(--pos-text-muted)] hover:text-[var(--pos-text)]'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>

            <div
              role="group"
              aria-label="Target coverage horizon"
              style={{ borderRadius: 'var(--pos-radius)' }}
              className="inline-flex items-center gap-1 p-1 bg-[var(--pos-bg)] border border-[var(--pos-border)]"
            >
              <span className="px-2 text-[11px] font-medium text-[var(--pos-text-muted)]">
                Cover:
              </span>
              {([14, 30, 45] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setCoverageDays(d)}
                  className={`px-2 py-1 text-xs font-mono-num font-medium rounded cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                    coverageDays === d
                      ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs border border-[var(--pos-border)]'
                      : 'text-[var(--pos-text-muted)] hover:text-[var(--pos-text)]'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>

            <Button
              size="sm"
              onClick={() => openReorderRequestModal('nearing_threshold')}
              disabled={nearingForecasts.length === 0}
            >
              <ClipboardList className="w-3.5 h-3.5" />
              Generate Reorder List ({nearingForecasts.length})
            </Button>
          </div>
        </div>
      </Card>

      {/* Summary KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <div className="text-xs font-medium text-[var(--pos-text-muted)]">
            Nearing / Below Threshold
          </div>
          <div
            className={`text-2xl font-bold font-mono-num mt-1 ${
              summary.nearingCount > 0
                ? 'text-[var(--pos-error)]'
                : 'text-[var(--pos-success)]'
            }`}
          >
            {summary.nearingCount}
          </div>
          <div className="text-[11px] text-[var(--pos-text-muted)] mt-1 font-mono-num">
            of {inventory.length} tracked SKUs
          </div>
        </Card>

        <Card>
          <div className="text-xs font-medium text-[var(--pos-text-muted)]">
            Velocity-Backed Alerts
          </div>
          <div className="text-2xl font-bold font-mono-num text-[var(--pos-text)] mt-1">
            {summary.velocityBackedCount}
          </div>
          <div className="text-[11px] text-[var(--pos-text-muted)] mt-1">
            Computed from {lookbackDays}-day sales &amp; usage
          </div>
        </Card>

        <Card>
          <div className="text-xs font-medium text-[var(--pos-text-muted)]">
            Earliest Stockout Runway
          </div>
          <div
            className={`text-2xl font-bold font-mono-num mt-1 ${
              summary.earliestStockout && (summary.earliestStockout.daysUntilStockout ?? 99) <= 7
                ? 'text-[var(--pos-error)]'
                : 'text-[var(--pos-text)]'
            }`}
          >
            {summary.earliestStockout
              ? `${summary.earliestStockout.daysUntilStockout}d`
              : '—'}
          </div>
          <div className="text-[11px] text-[var(--pos-text-muted)] mt-1 truncate">
            {summary.earliestStockout
              ? summary.earliestStockout.name
              : 'No active depletion risk'}
          </div>
        </Card>

        <Card>
          <div className="text-xs font-medium text-[var(--pos-text-muted)]">
            Forecasted Reorder Spend
          </div>
          <div className="text-2xl font-bold font-mono-num text-[var(--pos-primary)] mt-1">
            {formatCurrency(summary.totalEstimatedCost, taxCurr)}
          </div>
          <div className="text-[11px] text-[var(--pos-text-muted)] mt-1">
            For {coverageDays}-day stock coverage
          </div>
        </Card>
      </div>

      {/* Chart comparing Current Stock vs Suggested Replenishment */}
      {chartData.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--pos-text)]">
                On-Hand Stock vs. Suggested Replenishment ({coverageDays}-Day Target)
              </h3>
              <p className="text-xs text-[var(--pos-text-muted)]">
                Top items nearing or below threshold ranked by depletion urgency
              </p>
            </div>
          </div>
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--pos-border)" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: 'var(--pos-text-muted)' }}
                  axisLine={{ stroke: 'var(--pos-border)' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'var(--pos-text-muted)' }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip content={<ForecastChartTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: '12px', paddingTop: '6px' }}
                />
                <Bar
                  dataKey="currentStock"
                  name="Current Stock"
                  fill="var(--pos-warning)"
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="suggestedOrderQty"
                  name="Suggested Order Qty"
                  fill="var(--pos-primary)"
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Forecast Table */}
      <Card padded={false}>
        <div className="px-4 py-3 border-b border-[var(--pos-border)] flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold text-[var(--pos-text)]">
            {showAllItems
              ? `All Tracked Items (${forecasts.length})`
              : `Items Nearing or Below Threshold (${nearingForecasts.length})`}
          </div>
          <div
            role="group"
            aria-label="Forecast table filter"
            style={{ borderRadius: 'var(--pos-radius)' }}
            className="inline-flex items-center gap-1 p-0.5 bg-[var(--pos-bg)] border border-[var(--pos-border)]"
          >
            <button
              type="button"
              onClick={() => setShowAllItems(false)}
              className={`px-2.5 py-1 text-xs font-medium rounded cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                !showAllItems
                  ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs'
                  : 'text-[var(--pos-text-muted)] hover:text-[var(--pos-text)]'
              }`}
            >
              Nearing Threshold ({nearingForecasts.length})
            </button>
            <button
              type="button"
              onClick={() => setShowAllItems(true)}
              className={`px-2.5 py-1 text-xs font-medium rounded cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                showAllItems
                  ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs'
                  : 'text-[var(--pos-text-muted)] hover:text-[var(--pos-text)]'
              }`}
            >
              All Items ({forecasts.length})
            </button>
          </div>
        </div>

        {displayedForecasts.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Clock className="w-5 h-5" />}
              title="No items nearing threshold"
              description="Based on current sales velocity, all tracked materials have sufficient runway beyond your threshold buffer."
              actionLabel="Show All Items"
              onAction={() => setShowAllItems(true)}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--pos-border)] bg-[var(--pos-bg)] text-[var(--pos-text-muted)]">
                  <th className="py-2.5 px-4 font-semibold">Item &amp; Supplier</th>
                  <th className="py-2.5 px-3 font-semibold text-right">On Hand / Threshold</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Sales Velocity</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Runway</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Suggested Order</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--pos-border)]">
                {displayedForecasts.map((f) => {
                  const inv = inventoryMap.get(f.inventoryItemId);
                  return (
                    <tr
                      key={f.inventoryItemId}
                      onClick={() => {
                        if (inv && onInspectItem) onInspectItem(inv);
                      }}
                      className={`transition-colors ${
                        onInspectItem ? 'cursor-pointer' : ''
                      } ${
                        f.currentStock <= 0 || f.isBelowMinimum
                          ? 'bg-red-500/[0.08] hover:bg-red-500/[0.13]'
                          : f.isNearingThreshold
                            ? 'bg-[var(--pos-warning)]/[0.06] hover:bg-[var(--pos-warning)]/[0.11]'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-3 px-4 align-middle min-w-[200px]">
                        <div className="flex items-center gap-1.5 font-semibold text-[var(--pos-text)]">
                          {(f.isBelowMinimum || f.currentStock <= 0) && (
                            <AlertTriangle className="w-3.5 h-3.5 text-[var(--pos-error)] shrink-0" />
                          )}
                          <span>{f.name}</span>
                        </div>
                        <div className="text-[11px] text-[var(--pos-text-muted)] mt-0.5">
                          <span className="font-mono-num">{f.sku}</span> · {f.supplierName} ·{' '}
                          <span className="font-mono-num">{f.leadTimeDays}d lead</span>
                        </div>
                      </td>

                      <td className="py-3 px-3 align-middle text-right font-mono-num whitespace-nowrap">
                        <div
                          className={`font-semibold ${
                            f.currentStock <= 0 || f.isBelowMinimum
                              ? 'text-[var(--pos-error)]'
                              : f.isAtReorder
                                ? 'text-[var(--pos-warning)]'
                                : 'text-[var(--pos-text)]'
                          }`}
                        >
                          {f.currentStock} {f.unit}
                        </div>
                        <div className="text-[11px] text-[var(--pos-text-muted)]">
                          {f.minimumThreshold > 0
                            ? `Min ${f.minimumThreshold} · Reorder ${f.reorderLevel}`
                            : `Reorder ${f.reorderLevel}`}
                        </div>
                      </td>

                      <td className="py-3 px-3 align-middle text-right whitespace-nowrap">
                        <div className="font-mono-num font-semibold text-[var(--pos-text)]">
                          {f.weightedDailyVelocity > 0
                            ? `${f.weightedDailyVelocity} ${f.unit}/day`
                            : '0 /day'}
                        </div>
                        <div className="text-[11px] mt-0.5">
                          {f.weightedDailyVelocity > 0 ? (
                            <span className="font-mono-num text-[var(--pos-text-muted)]">
                              ~{f.weeklyDemand}/wk · {renderConfidenceLabel(f)}
                            </span>
                          ) : (
                            renderConfidenceLabel(f)
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-3 align-middle text-right font-mono-num whitespace-nowrap">
                        {f.daysUntilStockout !== null ? (
                          <div>
                            <StatusIndicator
                              tone={
                                f.isBelowMinimum || f.daysUntilStockout <= f.leadTimeDays
                                  ? 'error'
                                  : f.isNearingThreshold
                                    ? 'warning'
                                    : 'success'
                              }
                              label={
                                f.currentStock <= 0
                                  ? 'Out of stock'
                                  : f.daysUntilThreshold === 0
                                    ? `Crossed · ${f.daysUntilStockout}d left`
                                    : `${f.daysUntilThreshold}d to threshold`
                              }
                            />
                            <div className="text-[11px] text-[var(--pos-text-muted)] mt-0.5">
                              Stockout ~{f.daysUntilStockout}d
                            </div>
                          </div>
                        ) : (
                          <StatusIndicator
                            tone={
                              f.currentStock <= 0 || f.isBelowMinimum
                                ? 'error'
                                : f.isAtReorder
                                  ? 'warning'
                                  : 'neutral'
                            }
                            label={
                              f.currentStock <= 0
                                ? 'Out of stock'
                                : f.isBelowMinimum
                                  ? 'Below minimum'
                                  : f.isAtReorder
                                    ? 'At reorder'
                                    : 'No recent sales'
                            }
                          />
                        )}
                      </td>

                      <td className="py-3 px-3 align-middle text-right whitespace-nowrap">
                        {f.suggestedOrderQty > 0 ? (
                          <div>
                            <div className="font-mono-num font-bold text-sm text-[var(--pos-primary)]">
                              +{f.suggestedOrderQty} {f.unit}
                            </div>
                            <div className="text-[11px] font-mono-num text-[var(--pos-text-muted)]">
                              {formatCurrency(f.estimatedOrderCost, taxCurr)} ·{' '}
                              <span className="font-sans">{f.rationale}</span>
                            </div>
                          </div>
                        ) : (
                          <span className="text-[11px] text-[var(--pos-text-muted)]">
                            Sufficient stock
                          </span>
                        )}
                      </td>

                      <td
                        className="py-3 px-4 align-middle text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {inv && onAdjustStock && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onAdjustStock(inv)}
                          >
                            <ArrowUpDown className="w-3.5 h-3.5" />
                            Restock
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
