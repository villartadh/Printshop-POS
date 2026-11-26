import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Award, ShoppingBag } from 'lucide-react';
import { formatCurrency } from '../../shared/pricingEngine.ts';
import type { SupplierProfile } from '../../shared/supplierModel.ts';
import type { TaxAndCurrencyConfig } from '../../shared/types.ts';
import { Card, StatusIndicator } from '../ui/Primitives.tsx';

export interface TopPerformersWidgetProps {
  suppliers: SupplierProfile[];
  selectedKey: string;
  onSelectSupplier: (key: string) => void;
  taxCurrency: TaxAndCurrencyConfig;
}

export const TopPerformersWidget: React.FC<TopPerformersWidgetProps> = ({
  suppliers,
  selectedKey,
  onSelectSupplier,
  taxCurrency,
}) => {
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [limitMode, setLimitMode] = useState<'all' | 'top5'>('all');

  const { rankedRows, totalSpend, maxSpend } = useMemo(() => {
    const descSorted = [...suppliers].sort(
      (a, b) =>
        b.totalOrderSpend - a.totalOrderSpend ||
        b.totalOrderCount - a.totalOrderCount ||
        a.name.localeCompare(b.name),
    );

    const total = Number(
      descSorted.reduce((sum, s) => sum + s.totalOrderSpend, 0).toFixed(2),
    );
    const highest = descSorted.length > 0 ? descSorted[0].totalOrderSpend : 0;

    const withRanks = descSorted.map((supplier, idx) => ({
      supplier,
      rank: idx + 1,
      sharePct: total > 0 ? (supplier.totalOrderSpend / total) * 100 : 0,
      barPct:
        highest > 0
          ? Math.max(
              supplier.totalOrderSpend > 0 ? 4 : 0,
              (supplier.totalOrderSpend / highest) * 100,
            )
          : 0,
    }));

    const ordered =
      sortDir === 'desc' ? withRanks : [...withRanks].reverse();

    const visible =
      limitMode === 'top5' && sortDir === 'desc'
        ? ordered.slice(0, 5)
        : limitMode === 'top5'
          ? withRanks.slice(0, 5).reverse()
          : ordered;

    return {
      rankedRows: visible,
      totalSpend: total,
      maxSpend: highest,
    };
  }, [suppliers, sortDir, limitMode]);

  if (suppliers.length === 0) {
    return null;
  }

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--pos-border)] flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-[var(--pos-primary)]" />
            <h3 className="text-sm font-semibold text-[var(--pos-text)]">
              Top Performers
            </h3>
          </div>
          <p className="text-xs text-[var(--pos-text-muted)] mt-0.5">
            Suppliers ranked by total purchase order spending volume across{' '}
            <span className="font-mono-num font-semibold text-[var(--pos-text)]">
              {formatCurrency(totalSpend, taxCurrency)}
            </span>{' '}
            total spend
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {suppliers.length > 5 && (
            <div
              style={{ borderRadius: 'var(--pos-radius)' }}
              className="inline-flex items-center gap-1 p-0.5 bg-[var(--pos-bg)] border border-[var(--pos-border)] text-[11px]"
            >
              <button
                type="button"
                onClick={() => setLimitMode('top5')}
                className={`px-2 py-1 rounded font-medium cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                  limitMode === 'top5'
                    ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs border border-[var(--pos-border)]'
                    : 'text-[var(--pos-text-muted)] hover:text-[var(--pos-text)]'
                }`}
              >
                Top 5
              </button>
              <button
                type="button"
                onClick={() => setLimitMode('all')}
                className={`px-2 py-1 rounded font-medium cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                  limitMode === 'all'
                    ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs border border-[var(--pos-border)]'
                    : 'text-[var(--pos-text-muted)] hover:text-[var(--pos-text)]'
                }`}
              >
                All ({suppliers.length})
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
            aria-label={`Sort spending volume ${
              sortDir === 'desc' ? 'ascending' : 'descending'
            }`}
            style={{ borderRadius: 'var(--pos-radius)' }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium border border-[var(--pos-border)] bg-[var(--pos-surface)] text-[var(--pos-text)] hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer whitespace-nowrap shrink-0"
          >
            {sortDir === 'desc' ? (
              <ArrowDown className="w-3.5 h-3.5 text-[var(--pos-primary)]" />
            ) : (
              <ArrowUp className="w-3.5 h-3.5 text-[var(--pos-primary)]" />
            )}
            <span>{sortDir === 'desc' ? 'Highest Spend' : 'Lowest Spend'}</span>
          </button>
        </div>
      </div>

      {totalSpend <= 0 ? (
        <div className="py-10 px-4 text-center space-y-2">
          <ShoppingBag className="w-7 h-7 mx-auto text-[var(--pos-text-muted)] opacity-45" />
          <div className="text-sm font-semibold text-[var(--pos-text)]">
            No purchase order spending recorded yet
          </div>
          <p className="text-xs text-[var(--pos-text-muted)]">
            Log purchase orders for suppliers to rank top performers by total spending volume.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--pos-border)] text-[11px] uppercase tracking-wider text-[var(--pos-text-muted)] bg-[var(--pos-bg)]">
                <th className="py-2.5 px-4 font-semibold w-16">Rank</th>
                <th className="py-2.5 px-3 font-semibold">Supplier</th>
                <th className="py-2.5 px-3 font-semibold min-w-[210px]">
                  Spending Volume &amp; Share
                </th>
                <th className="py-2.5 px-3 font-semibold text-right">POs</th>
                <th className="py-2.5 px-3 font-semibold text-right">On-Time</th>
                <th className="py-2.5 px-4 font-semibold text-right">
                  <button
                    type="button"
                    onClick={() =>
                      setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'))
                    }
                    className="inline-flex items-center justify-end gap-1 font-semibold uppercase tracking-wider hover:text-[var(--pos-text)] cursor-pointer ml-auto"
                  >
                    <span>Total Spend</span>
                    {sortDir === 'desc' ? (
                      <ArrowDown className="w-3 h-3" />
                    ) : (
                      <ArrowUp className="w-3 h-3" />
                    )}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--pos-border)] text-xs">
              {rankedRows.map(({ supplier, rank, sharePct, barPct }) => {
                const isSelected = supplier.key === selectedKey;
                const avgOrderValue =
                  supplier.totalOrderCount > 0
                    ? supplier.totalOrderSpend / supplier.totalOrderCount
                    : 0;
                const onTimeRate = supplier.onTimeDeliveryRate;
                const onTimeTone =
                  onTimeRate === null
                    ? 'neutral'
                    : onTimeRate >= 90
                      ? 'success'
                      : onTimeRate >= 70
                        ? 'warning'
                        : 'error';

                const barColorClass =
                  rank === 1
                    ? 'bg-[var(--pos-primary)]'
                    : rank <= 3
                      ? 'bg-teal-600/80 dark:bg-teal-400/80'
                      : 'bg-slate-400 dark:bg-slate-500';

                return (
                  <tr
                    key={supplier.key}
                    onClick={() => onSelectSupplier(supplier.key)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-[var(--pos-primary)]/10'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <td className="py-2.5 px-4 font-mono-num">
                      <span
                        className={`font-bold ${
                          rank === 1
                            ? 'text-[var(--pos-primary)]'
                            : rank <= 3
                              ? 'text-[var(--pos-text)]'
                              : 'text-[var(--pos-text-muted)]'
                        }`}
                      >
                        #{rank}
                      </span>
                    </td>

                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-[var(--pos-text)]">
                        {supplier.name}
                      </div>
                      <div className="text-[11px] text-[var(--pos-text-muted)] font-mono-num">
                        {supplier.items.length} SKU{supplier.items.length === 1 ? '' : 's'} ·{' '}
                        {supplier.effectiveLeadTimeDays}d lead
                      </div>
                    </td>

                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="flex-1 h-2 rounded-full bg-[var(--pos-bg)] border border-[var(--pos-border)] overflow-hidden"
                          role="progressbar"
                          aria-valuenow={Math.round(sharePct)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${supplier.name} spend volume share ${sharePct.toFixed(1)}%`}
                        >
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${barColorClass}`}
                            style={{
                              width: `${maxSpend > 0 ? Math.min(100, barPct) : 0}%`,
                            }}
                          />
                        </div>
                        <span className="w-12 text-right font-mono-num text-[11px] font-semibold text-[var(--pos-text-muted)] shrink-0">
                          {sharePct.toFixed(1)}%
                        </span>
                      </div>
                    </td>

                    <td className="py-2.5 px-3 text-right font-mono-num">
                      <div className="font-medium text-[var(--pos-text)]">
                        {supplier.totalOrderCount}
                      </div>
                      {supplier.totalOrderCount > 0 && (
                        <div className="text-[11px] text-[var(--pos-text-muted)]">
                          avg {formatCurrency(avgOrderValue, taxCurrency)}
                        </div>
                      )}
                    </td>

                    <td className="py-2.5 px-3 text-right font-mono-num">
                      {onTimeRate !== null ? (
                        <StatusIndicator
                          tone={onTimeTone}
                          label={`${onTimeRate.toFixed(0)}%`}
                        />
                      ) : (
                        <span className="text-[var(--pos-text-muted)]">—</span>
                      )}
                    </td>

                    <td className="py-2.5 px-4 text-right font-mono-num font-bold text-[var(--pos-text)]">
                      {formatCurrency(supplier.totalOrderSpend, taxCurrency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};
