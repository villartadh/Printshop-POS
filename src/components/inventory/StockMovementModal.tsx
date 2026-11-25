import React, { useId, useMemo } from 'react';
import { ArrowUpDown, Edit2, TrendingDown, TrendingUp } from 'lucide-react';
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrency } from '../../shared/pricingEngine.ts';
import {
  extractSupplierInfo,
  getAvailableStock,
  getInventoryStockStatus,
  getSuggestedRestockQuantity,
  isBelowMinimumThreshold,
  STOCK_MOVEMENT_LABELS,
} from '../../shared/inventoryModel.ts';
import type { InventoryItem, StockMovement } from '../../types/inventory.ts';
import type { TaxAndCurrencyConfig } from '../../shared/types.ts';
import { Button, StatusIndicator } from '../ui/Primitives.tsx';
import { DataTable } from '../ui/DataTable.tsx';
import { Modal } from '../ui/Overlays.tsx';

export interface StockMovementModalProps {
  open: boolean;
  onClose: () => void;
  item: InventoryItem | null;
  movements: StockMovement[];
  taxCurrency: TaxAndCurrencyConfig;
  canEdit?: boolean;
  onEditItem?: (item: InventoryItem) => void;
  onAdjustStock?: (item: InventoryItem) => void;
}

interface CostHistoryPoint {
  id: string;
  dateLabel: string;
  fullDate: string;
  unitCost: number;
  sourceLabel: string;
  reference: string;
}

interface CostSparklineTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: CostHistoryPoint }>;
  taxCurrency: TaxAndCurrencyConfig;
  unit: string;
}

const CostSparklineTooltip: React.FC<CostSparklineTooltipProps> = ({
  active,
  payload,
  taxCurrency,
  unit,
}) => {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;

  return (
    <div
      style={{ borderRadius: 'var(--pos-radius)' }}
      className="px-2.5 py-2 border border-[var(--pos-border)] bg-[var(--pos-surface)] shadow-md text-xs"
    >
      <div className="font-mono-num font-semibold text-[var(--pos-text)]">
        {formatCurrency(pt.unitCost, taxCurrency)} / {unit}
      </div>
      <div className="text-[11px] text-[var(--pos-text-muted)] mt-0.5">
        {pt.sourceLabel}
        {pt.reference ? ` · ${pt.reference}` : ''}
      </div>
      <div className="text-[11px] text-[var(--pos-text-muted)] font-mono-num">
        {pt.fullDate}
      </div>
    </div>
  );
};

export const StockMovementModal: React.FC<StockMovementModalProps> = ({
  open,
  onClose,
  item,
  movements,
  taxCurrency,
  canEdit = false,
  onEditItem,
  onAdjustStock,
}) => {
  const rawId = useId();
  const gradientId = `costSpark_${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const sortedMovements = useMemo(
    () =>
      [...movements].sort((a, b) => {
        const ta = Date.parse(a.occurredAt || a.createdAt) || 0;
        const tb = Date.parse(b.occurredAt || b.createdAt) || 0;
        return tb - ta;
      }),
    [movements],
  );

  const costHistory = useMemo(() => {
    if (!item) {
      return {
        points: [] as CostHistoryPoint[],
        minCost: 0,
        maxCost: 0,
        deltaCost: 0,
        deltaPct: 0,
        yDomain: [0, 1] as [number, number],
        hasMultiplePoints: false,
      };
    }

    const chronological = [...sortedMovements].reverse();
    const rawPoints: CostHistoryPoint[] = [];

    for (const mov of chronological) {
      const costVal = Number(mov.unitCostAtMovement);
      const hasRecordedCost =
        mov.unitCostAtMovement !== undefined &&
        Number.isFinite(costVal) &&
        (costVal > 0 || item.unitCost === 0);
      if (!hasRecordedCost) continue;

      const stamp = mov.occurredAt || mov.createdAt;
      const d = new Date(stamp);
      rawPoints.push({
        id: mov.id,
        dateLabel: Number.isNaN(d.getTime())
          ? stamp
          : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        fullDate: Number.isNaN(d.getTime()) ? stamp : d.toLocaleString(),
        unitCost: Number(costVal.toFixed(2)),
        sourceLabel: STOCK_MOVEMENT_LABELS[mov.movementType] || mov.movementType,
        reference: mov.reference || '',
      });
    }

    const currentCost = Number((Number(item.unitCost) || 0).toFixed(2));
    const currentStamp = item.updatedAt || new Date().toISOString();
    const currentDate = new Date(currentStamp);
    const lastRecorded = rawPoints[rawPoints.length - 1];

    if (rawPoints.length === 0) {
      const createdStamp = item.createdAt || currentStamp;
      const createdDate = new Date(createdStamp);
      rawPoints.push({
        id: 'cost-initial',
        dateLabel: Number.isNaN(createdDate.getTime())
          ? 'Initial'
          : createdDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        fullDate: Number.isNaN(createdDate.getTime())
          ? createdStamp
          : createdDate.toLocaleString(),
        unitCost: currentCost,
        sourceLabel: 'Catalog Unit Cost',
        reference: '',
      });
    } else if (Math.abs(lastRecorded.unitCost - currentCost) > 0.001) {
      rawPoints.push({
        id: 'cost-current',
        dateLabel: 'Current',
        fullDate: Number.isNaN(currentDate.getTime())
          ? currentStamp
          : currentDate.toLocaleString(),
        unitCost: currentCost,
        sourceLabel: 'Current Catalog Cost',
        reference: '',
      });
    }

    const hasMultiplePoints = rawPoints.length > 1;
    const chartPoints: CostHistoryPoint[] =
      rawPoints.length === 1
        ? [
            rawPoints[0],
            {
              ...rawPoints[0],
              id: `${rawPoints[0].id}-current`,
              dateLabel: 'Current',
              fullDate: Number.isNaN(currentDate.getTime())
                ? currentStamp
                : currentDate.toLocaleString(),
              sourceLabel: 'Current Unit Cost',
            },
          ]
        : rawPoints;

    const costs = rawPoints.map((p) => p.unitCost);
    const minCost = Math.min(...costs);
    const maxCost = Math.max(...costs);
    const firstCost = rawPoints[0].unitCost;
    const lastCost = rawPoints[rawPoints.length - 1].unitCost;
    const deltaCost = Number((lastCost - firstCost).toFixed(2));
    const deltaPct = firstCost > 0 ? ((lastCost - firstCost) / firstCost) * 100 : 0;

    const spread = maxCost - minCost;
    const pad = spread > 0 ? spread * 0.25 : Math.max(maxCost * 0.15, 0.5);
    const domainMin = Math.max(0, Number((minCost - pad).toFixed(2)));
    const domainMax = Number((maxCost + pad).toFixed(2));

    return {
      points: chartPoints,
      minCost,
      maxCost,
      deltaCost,
      deltaPct,
      yDomain: [domainMin, domainMax > domainMin ? domainMax : domainMin + 1] as [number, number],
      hasMultiplePoints,
    };
  }, [item, sortedMovements]);

  return (
    <Modal
      open={Boolean(open && item)}
      onClose={onClose}
      title={item ? item.name : ''}
      subtitle={
        item
          ? `${item.sku} · ${item.category}${
              item.storageLocation ? ` · ${item.storageLocation}` : ''
            }`
          : ''
      }
      maxWidth="lg"
      footer={
        item ? (
          <>
            {canEdit && onEditItem && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  onClose();
                  onEditItem(item);
                }}
              >
                <Edit2 className="w-3.5 h-3.5" />
                Edit Item
              </Button>
            )}
            {onAdjustStock && (
              <Button
                size="sm"
                onClick={() => {
                  onClose();
                  onAdjustStock(item);
                }}
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
                Adjust Stock
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {item && (() => {
        const sup = extractSupplierInfo(item);
        const status = getInventoryStockStatus(item);
        const avail = getAvailableStock(item);
        const suggested = getSuggestedRestockQuantity(item);
        const stockCount = item.currentStock ?? item.quantityOnHand;
        const threshold = item.reorderThreshold ?? item.reorderLevel;
        const minThreshold = Math.max(0, Number(item.minimumThreshold) || 0);
        const isBelowMin = isBelowMinimumThreshold(item);

        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div
                style={{ borderRadius: 'var(--pos-radius)' }}
                className="p-3 border border-[var(--pos-border)] bg-[var(--pos-bg)]"
              >
                <div className="text-[11px] text-[var(--pos-text-muted)]">On Hand</div>
                <div
                  className={`text-lg font-bold font-mono-num mt-0.5 ${
                    status === 'out_of_stock' || isBelowMin
                      ? 'text-[var(--pos-error)]'
                      : 'text-[var(--pos-text)]'
                  }`}
                >
                  {stockCount} {item.unit}
                </div>
              </div>
              <div
                style={{ borderRadius: 'var(--pos-radius)' }}
                className="p-3 border border-[var(--pos-border)] bg-[var(--pos-bg)]"
              >
                <div className="text-[11px] text-[var(--pos-text-muted)]">Available</div>
                <div className="text-lg font-bold font-mono-num text-[var(--pos-text)] mt-0.5">
                  {avail} {item.unit}
                </div>
              </div>
              <div
                style={{ borderRadius: 'var(--pos-radius)' }}
                className="p-3 border border-[var(--pos-border)] bg-[var(--pos-bg)]"
              >
                <div className="text-[11px] text-[var(--pos-text-muted)]">Reorder / Min</div>
                <div className="text-lg font-bold font-mono-num text-[var(--pos-text)] mt-0.5">
                  {threshold} {item.unit}
                </div>
                {minThreshold > 0 && (
                  <div
                    className={`text-[11px] font-mono-num mt-0.5 ${
                      isBelowMin
                        ? 'text-[var(--pos-error)] font-semibold'
                        : 'text-[var(--pos-text-muted)]'
                    }`}
                  >
                    Min: {minThreshold} {item.unit}
                  </div>
                )}
              </div>
              <div
                style={{ borderRadius: 'var(--pos-radius)' }}
                className="p-3 border border-[var(--pos-border)] bg-[var(--pos-bg)]"
              >
                <div className="text-[11px] text-[var(--pos-text-muted)]">Status</div>
                <div className="mt-1.5">
                  <StatusIndicator
                    tone={
                      status === 'out_of_stock' || isBelowMin
                        ? 'error'
                        : status === 'low_stock'
                          ? 'warning'
                          : 'success'
                    }
                    label={
                      status === 'out_of_stock'
                        ? 'Out of Stock'
                        : isBelowMin
                          ? 'Below Min'
                          : status === 'low_stock'
                            ? 'Low Stock'
                            : 'In Stock'
                    }
                  />
                </div>
              </div>
            </div>

            <div
              style={{ borderRadius: 'var(--pos-radius)' }}
              className="p-3.5 border border-[var(--pos-border)] grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs"
            >
              <div>
                <div className="text-[var(--pos-text-muted)]">Supplier</div>
                <div className="font-medium text-[var(--pos-text)] mt-0.5">
                  {sup.name || 'No supplier set'}
                </div>
                {sup.contact && (
                  <div className="text-[var(--pos-text-muted)] mt-0.5">{sup.contact}</div>
                )}
              </div>
              <div>
                <div className="text-[var(--pos-text-muted)]">Unit Cost & Valuation</div>
                <div className="font-mono-num font-medium text-[var(--pos-text)] mt-0.5">
                  {formatCurrency(item.unitCost, taxCurrency)} / {item.unit}
                </div>
                <div className="font-mono-num text-[var(--pos-text-muted)] mt-0.5">
                  Total: {formatCurrency(stockCount * item.unitCost, taxCurrency)}
                </div>
              </div>
              <div>
                <div className="text-[var(--pos-text-muted)]">Restock Guidance</div>
                <div className="font-mono-num font-medium text-[var(--pos-text)] mt-0.5">
                  {suggested > 0
                    ? `Suggested +${suggested} ${item.unit}`
                    : `Standard order ${item.reorderQuantity || 0} ${item.unit}`}
                </div>
                <div className="text-[var(--pos-text-muted)] mt-0.5">
                  {item.lastRestockedAt
                    ? `Last restocked ${new Date(item.lastRestockedAt).toLocaleDateString()}`
                    : 'No restock recorded'}
                </div>
              </div>
            </div>

            {/* Cost Price History Sparkline */}
            <div
              style={{ borderRadius: 'var(--pos-radius)' }}
              className="p-3.5 border border-[var(--pos-border)] space-y-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold text-[var(--pos-text)]">
                    Cost Price History
                  </h3>
                  <p className="text-[11px] text-[var(--pos-text-muted)] font-mono-num mt-0.5">
                    {costHistory.hasMultiplePoints
                      ? `${costHistory.points.length} recorded snapshots · Low ${formatCurrency(costHistory.minCost, taxCurrency)} · High ${formatCurrency(costHistory.maxCost, taxCurrency)}`
                      : `Current cost ${formatCurrency(item.unitCost, taxCurrency)} / ${item.unit} · No prior price changes`}
                  </p>
                </div>

                <div className="flex items-center gap-3 font-mono-num text-xs">
                  {costHistory.deltaCost !== 0 ? (
                    <span
                      className={`inline-flex items-center gap-1 font-semibold ${
                        costHistory.deltaCost > 0
                          ? 'text-[var(--pos-warning)]'
                          : 'text-[var(--pos-success)]'
                      }`}
                    >
                      {costHistory.deltaCost > 0 ? (
                        <TrendingUp className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <TrendingDown className="w-3.5 h-3.5 shrink-0" />
                      )}
                      <span>
                        {costHistory.deltaCost > 0 ? '+' : ''}
                        {formatCurrency(costHistory.deltaCost, taxCurrency)}
                        {costHistory.deltaPct !== 0
                          ? ` (${costHistory.deltaPct > 0 ? '+' : ''}${costHistory.deltaPct.toFixed(1)}%)`
                          : ''}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[11px] text-[var(--pos-text-muted)]">
                      Steady at {formatCurrency(item.unitCost, taxCurrency)}
                    </span>
                  )}
                </div>
              </div>

              <div className="h-[72px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={costHistory.points}
                    margin={{ top: 6, right: 6, left: 6, bottom: 2 }}
                  >
                    <defs>
                      <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--pos-primary)" stopOpacity={0.22} />
                        <stop offset="100%" stopColor="var(--pos-primary)" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="dateLabel" hide />
                    <YAxis domain={costHistory.yDomain} hide />
                    <Tooltip
                      content={
                        <CostSparklineTooltip
                          taxCurrency={taxCurrency}
                          unit={item.unit}
                        />
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="unitCost"
                      stroke="var(--pos-primary)"
                      strokeWidth={2}
                      fill={`url(#${gradientId})`}
                      dot={
                        costHistory.points.length <= 12
                          ? {
                              r: 2.5,
                              fill: 'var(--pos-surface)',
                              stroke: 'var(--pos-primary)',
                              strokeWidth: 1.5,
                            }
                          : false
                      }
                      activeDot={{
                        r: 4,
                        fill: 'var(--pos-primary)',
                        stroke: 'var(--pos-surface)',
                        strokeWidth: 2,
                      }}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-[var(--pos-text)] mb-2">
                Stock Movements ({sortedMovements.length})
              </div>
              <DataTable
                rows={sortedMovements.slice(0, 50)}
                rowKey={(m) => m.id}
                emptyTitle="No movement history for this item"
                emptyDescription="Restocks, print job deductions, and manual counts will appear here."
                columns={[
                  {
                    key: 'type',
                    label: 'Movement',
                    render: (m) => (
                      <div>
                        <div className="text-xs font-medium text-[var(--pos-text)]">
                          {STOCK_MOVEMENT_LABELS[m.movementType] || m.movementType}
                        </div>
                        <div className="text-[11px] text-[var(--pos-text-muted)]">
                          {m.performedBy}
                          {m.reference ? ` · ${m.reference}` : ''}
                          {m.note ? ` · ${m.note}` : ''}
                        </div>
                      </div>
                    ),
                  },
                  {
                    key: 'date',
                    label: 'Date',
                    render: (m) => (
                      <span className="font-mono-num text-xs text-[var(--pos-text-muted)]">
                        {new Date(m.occurredAt || m.createdAt).toLocaleString()}
                      </span>
                    ),
                  },
                  {
                    key: 'delta',
                    label: 'Delta',
                    align: 'right',
                    render: (m) => (
                      <span
                        className={`font-mono-num font-semibold text-xs ${
                          m.quantityDelta >= 0
                            ? 'text-[var(--pos-success)]'
                            : 'text-[var(--pos-error)]'
                        }`}
                      >
                        {m.quantityDelta >= 0 ? `+${m.quantityDelta}` : m.quantityDelta}
                      </span>
                    ),
                  },
                  {
                    key: 'balance',
                    label: 'Balance',
                    align: 'right',
                    render: (m) => (
                      <span className="font-mono-num text-xs font-semibold text-[var(--pos-text)]">
                        {m.balanceAfter} {item.unit}
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          </div>
        );
      })()}
    </Modal>
  );
};
