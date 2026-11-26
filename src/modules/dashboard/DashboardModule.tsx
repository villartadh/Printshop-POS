import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Eye,
  EyeOff,
  SlidersHorizontal,
} from 'lucide-react';
import { useApp } from '../../context/AppContext.tsx';
import { isBelowMinimumThreshold } from '../../shared/inventoryModel.ts';
import { computePredictiveReorderForecasts } from '../../shared/predictiveReorderEngine.ts';
import { formatCurrency } from '../../shared/pricingEngine.ts';
import type { Transaction } from '../../shared/types.ts';
import { Button, Card, StatusIndicator } from '../../components/ui/Primitives.tsx';
import { BreakdownBarList, SalesTrendChart } from '../../components/ui/Charts.tsx';
import { InventorySupplierChart } from '../../components/dashboard/InventorySupplierChart.tsx';
import { DataTable } from '../../components/ui/DataTable.tsx';
import { Modal } from '../../components/ui/Overlays.tsx';
import { ReceiptModal } from '../receipts/ReceiptModal.tsx';

export const DashboardModule: React.FC = () => {
  const {
    settings,
    transactions,
    printJobs,
    inventory,
    services,
    stockMovements,
    expenses,
    customers,
    setActiveModule,
    saveSettings,
    voidTransaction,
    refundTransaction,
    session,
    belowMinimumItems,
    hasSimultaneousThresholdBreach,
    openReorderRequestModal,
  } = useApp();

  const taxCurr = settings.taxAndCurrency;
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null);
  const [range, setRange] = useState<'today' | 'week' | 'month'>('month');

  const widgets = useMemo(
    () => [...settings.dashboardWidgets].sort((a, b) => a.order - b.order),
    [settings.dashboardWidgets],
  );

  const validSales = useMemo(
    () =>
      transactions.filter(
        (t) => t.type === 'sale' && t.paymentStatus !== 'voided' && t.paymentStatus !== 'refunded',
      ),
    [transactions],
  );

  const metrics = useMemo(() => {
    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayMs = startOfToday.getTime();
    const weekMs = now - 7 * 86400000;
    const monthMs = now - 30 * 86400000;

    let todaySales = 0;
    let weeklySales = 0;
    let monthlySales = 0;
    let totalCost = 0;

    const serviceMap = new Map<string, { label: string; value: number; count: number }>();
    const paymentMap = new Map<string, number>();

    for (const t of validSales) {
      const ts = new Date(t.createdAt).getTime();
      if (ts >= todayMs) todaySales += t.totalAmount;
      if (ts >= weekMs) weeklySales += t.totalAmount;
      if (ts >= monthMs) monthlySales += t.totalAmount;

      const inSelectedRange =
        range === 'today' ? ts >= todayMs : range === 'week' ? ts >= weekMs : ts >= monthMs;

      if (inSelectedRange) {
        for (const item of t.items) {
          totalCost += item.costTotal || 0;
          const prev = serviceMap.get(item.serviceName) || {
            label: item.serviceName,
            value: 0,
            count: 0,
          };
          prev.value += item.lineTotal;
          prev.count += item.effectiveQuantity;
          serviceMap.set(item.serviceName, prev);
        }
        for (const p of t.payments) {
          paymentMap.set(p.methodName, (paymentMap.get(p.methodName) || 0) + p.amount);
        }
      }
    }

    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
    const activeSalesTotal =
      range === 'today' ? todaySales : range === 'week' ? weeklySales : monthlySales;
    const grossProfit = activeSalesTotal - totalCost;
    const netProfit = grossProfit - totalExpenses;
    const outstandingBalances = customers.reduce((s, c) => s + c.outstandingBalance, 0);
    const pendingJobsCount = printJobs.filter(
      (j) => !['completed', 'cancelled'].includes(j.productionStatus),
    ).length;
    const completedJobsCount = printJobs.filter((j) => j.productionStatus === 'completed').length;
    const lowStockItems = inventory.filter(
      (i) => i.quantityOnHand <= i.reorderLevel || isBelowMinimumThreshold(i),
    );

    // Build 7-day trend
    const trendPoints: Array<{ label: string; value: number }> = [];
    for (let d = 6; d >= 0; d--) {
      const day = new Date(Date.now() - d * 86400000);
      const dayStr = day.toISOString().slice(0, 10);
      const label = day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const sum = validSales
        .filter((t) => t.createdAt.slice(0, 10) === dayStr)
        .reduce((s, t) => s + t.totalAmount, 0);
      trendPoints.push({ label, value: sum });
    }

    const topServices = Array.from(serviceMap.values())
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
      .map((s) => ({
        label: s.label,
        value: s.value,
        subtitle: `${Math.round(s.count)} units`,
      }));

    const paymentBreakdown = Array.from(paymentMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value }));

    return {
      todaySales,
      weeklySales,
      monthlySales,
      totalTransactions: validSales.length,
      grossProfit,
      netProfit,
      totalExpenses,
      outstandingBalances,
      pendingJobsCount,
      completedJobsCount,
      lowStockItems,
      trendPoints,
      topServices,
      paymentBreakdown,
    };
  }, [validSales, expenses, customers, printJobs, inventory, range]);

  const predictiveForecasts = useMemo(
    () =>
      computePredictiveReorderForecasts({
        inventory,
        transactions,
        services,
        stockMovements,
      }),
    [inventory, transactions, services, stockMovements],
  );

  const nearingForecasts = useMemo(
    () => predictiveForecasts.filter((f) => f.isNearingThreshold),
    [predictiveForecasts],
  );

  const forecastMap = useMemo(
    () => new Map(predictiveForecasts.map((f) => [f.inventoryItemId, f])),
    [predictiveForecasts],
  );

  const toggleWidget = async (id: string) => {
    const nextWidgets = settings.dashboardWidgets.map((w) =>
      w.id === id ? { ...w, visible: !w.visible } : w,
    );
    await saveSettings({ ...settings, dashboardWidgets: nextWidgets });
  };

  const moveWidget = async (id: string, dir: -1 | 1) => {
    const ordered = [...widgets];
    const idx = ordered.findIndex((w) => w.id === id);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= ordered.length) return;
    const temp = ordered[idx];
    ordered[idx] = ordered[swapIdx];
    ordered[swapIdx] = temp;
    const reindexed = ordered.map((w, i) => ({ ...w, order: i }));
    await saveSettings({ ...settings, dashboardWidgets: reindexed });
  };

  const isVisible = (id: string) => widgets.find((w) => w.id === id)?.visible !== false;

  const canManage = session?.user.role === 'admin' || session?.user.role === 'manager';

  return (
    <div className="space-y-5">
      {/* Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--pos-text)]">
            {settings.branding.businessName} Overview
          </h1>
          <p className="text-xs text-[var(--pos-text-muted)]">
            Live print shop sales, production queue, and inventory health
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            {(['today', 'week', 'month'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`px-3 py-1 text-xs font-medium rounded-md capitalize cursor-pointer ${
                  range === r
                    ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs'
                    : 'text-[var(--pos-text-muted)]'
                }`}
              >
                {r === 'today' ? 'Today' : r === 'week' ? '7 Days' : '30 Days'}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              openReorderRequestModal(
                belowMinimumItems.length > 0 ? 'below_minimum' : 'all_low_stock',
              )
            }
            className={
              hasSimultaneousThresholdBreach
                ? 'border-[var(--pos-error)]/40 text-[var(--pos-error)] hover:bg-[var(--pos-error)]/10'
                : ''
            }
          >
            <ClipboardList className="w-3.5 h-3.5" />
            Generate Reorder List
            {(belowMinimumItems.length > 0 || metrics.lowStockItems.length > 0) && (
              <span className="font-mono-num">
                ({belowMinimumItems.length > 0 ? belowMinimumItems.length : metrics.lowStockItems.length})
              </span>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCustomizeOpen(true)}>
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Customize
          </Button>
          <Button size="sm" onClick={() => setActiveModule('pos')}>
            Quick Sale
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Simultaneous Minimum Threshold Alert Banner */}
      {hasSimultaneousThresholdBreach && (
        <div
          role="alert"
          style={{ borderRadius: 'var(--pos-radius)' }}
          className="px-4 py-3 border border-[var(--pos-error)]/30 bg-[var(--pos-error)]/[0.07] flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <AlertTriangle className="w-4 h-4 text-[var(--pos-error)] shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[var(--pos-error)]">
                {belowMinimumItems.length} Inventory Items Simultaneously Below Minimum Threshold
              </div>
              <div className="text-xs text-[var(--pos-text-muted)] mt-0.5">
                {belowMinimumItems
                  .map((item) => `${item.name} (${item.quantityOnHand}/${item.minimumThreshold} ${item.unit})`)
                  .join(' · ')}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActiveModule('inventory')}
            >
              Inspect Stock
            </Button>
            <Button
              size="sm"
              onClick={() => openReorderRequestModal('below_minimum')}
            >
              <ClipboardList className="w-3.5 h-3.5" />
              Generate Reorder List
            </Button>
          </div>
        </div>
      )}

      {/* Render Widgets in Configured Order */}
      {widgets.map((widget) => {
        if (!widget.visible) return null;

        if (widget.id === 'kpis') {
          return (
            <div key={widget.id} className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card>
                <div className="text-xs text-[var(--pos-text-muted)]">Today&apos;s Sales</div>
                <div className="text-xl font-bold font-mono-num text-[var(--pos-text)] mt-1">
                  {formatCurrency(metrics.todaySales, taxCurr)}
                </div>
                <div className="text-[11px] text-[var(--pos-text-muted)] mt-1">
                  Weekly {formatCurrency(metrics.weeklySales, taxCurr)}
                </div>
              </Card>
              <Card>
                <div className="text-xs text-[var(--pos-text-muted)]">Monthly Sales</div>
                <div className="text-xl font-bold font-mono-num text-[var(--pos-text)] mt-1">
                  {formatCurrency(metrics.monthlySales, taxCurr)}
                </div>
                <div className="text-[11px] text-[var(--pos-text-muted)] mt-1">
                  {metrics.totalTransactions} completed sales
                </div>
              </Card>
              <Card>
                <div className="text-xs text-[var(--pos-text-muted)]">Gross / Net Profit</div>
                <div className="text-xl font-bold font-mono-num text-[#16A34A] mt-1">
                  {formatCurrency(metrics.netProfit, taxCurr)}
                </div>
                <div className="text-[11px] text-[var(--pos-text-muted)] mt-1">
                  Gross {formatCurrency(metrics.grossProfit, taxCurr)} · Exp{' '}
                  {formatCurrency(metrics.totalExpenses, taxCurr)}
                </div>
              </Card>
              <Card>
                <div className="text-xs text-[var(--pos-text-muted)]">Jobs & Receivables</div>
                <div className="text-xl font-bold font-mono-num text-[var(--pos-text)] mt-1">
                  {metrics.pendingJobsCount} active
                </div>
                <div className="text-[11px] text-[var(--pos-text-muted)] mt-1">
                  {metrics.completedJobsCount} done · {formatCurrency(metrics.outstandingBalances, taxCurr)} due
                </div>
              </Card>
            </div>
          );
        }

        if (widget.id === 'sales_trend') {
          return (
            <Card key={widget.id}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-[var(--pos-text)]">
                  7-Day Sales Trend
                </h2>
                <span className="text-xs text-[var(--pos-text-muted)]">Actual posted sales</span>
              </div>
              <SalesTrendChart points={metrics.trendPoints} taxCurrency={taxCurr} />
            </Card>
          );
        }

        if (widget.id === 'top_services' && isVisible('top_services')) {
          return (
            <div key={widget.id} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <h2 className="text-sm font-semibold text-[var(--pos-text)] mb-3">
                  Best-Selling Services
                </h2>
                <BreakdownBarList items={metrics.topServices} taxCurrency={taxCurr} />
              </Card>

              {isVisible('payment_breakdown') && (
                <Card>
                  <h2 className="text-sm font-semibold text-[var(--pos-text)] mb-3">
                    Payment Method Breakdown
                  </h2>
                  <BreakdownBarList items={metrics.paymentBreakdown} taxCurrency={taxCurr} />
                </Card>
              )}
            </div>
          );
        }

        if (widget.id === 'payment_breakdown' && !isVisible('top_services')) {
          return (
            <Card key={widget.id}>
              <h2 className="text-sm font-semibold text-[var(--pos-text)] mb-3">
                Payment Method Breakdown
              </h2>
              <BreakdownBarList items={metrics.paymentBreakdown} taxCurrency={taxCurr} />
            </Card>
          );
        }

        if (widget.id === 'pending_jobs') {
          const activeJobs = printJobs
            .filter((j) => !['completed', 'cancelled'].includes(j.productionStatus))
            .slice(0, 5);
          return (
            <Card key={widget.id}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-[var(--pos-text)]">
                  Pending Print Jobs ({metrics.pendingJobsCount})
                </h2>
                <Button variant="ghost" size="sm" onClick={() => setActiveModule('jobs')}>
                  Open Queue
                </Button>
              </div>
              {activeJobs.length === 0 ? (
                <p className="text-xs text-[var(--pos-text-muted)] py-4">
                  No pending print jobs in the production queue.
                </p>
              ) : (
                <div className="divide-y divide-[var(--pos-border)]">
                  {activeJobs.map((job) => (
                    <div key={job.id} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[var(--pos-text)] truncate">
                          {job.jobOrderNumber} · {job.title}
                        </div>
                        <div className="text-xs text-[var(--pos-text-muted)] truncate">
                          {job.customerName} · Due {new Date(job.deadline).toLocaleDateString()}
                        </div>
                      </div>
                      <StatusIndicator
                        tone={job.productionStatus === 'ready_for_pickup' ? 'success' : 'warning'}
                        label={job.productionStatus.replace(/_/g, ' ')}
                      />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        }

        if (widget.id === 'low_stock') {
          const displayedAlerts =
            nearingForecasts.length > 0
              ? nearingForecasts
              : metrics.lowStockItems.map((item) => forecastMap.get(item.id)).filter(Boolean);

          return (
            <Card key={widget.id}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--pos-text)]">
                    Predictive Reorder &amp; Low-Stock Alerts ({displayedAlerts.length})
                  </h2>
                  <p className="text-[11px] text-[var(--pos-text-muted)]">
                    Velocity-based reorder suggestions for items nearing or below threshold
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {displayedAlerts.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        openReorderRequestModal(
                          belowMinimumItems.length >= 2
                            ? 'below_minimum'
                            : 'nearing_threshold',
                        )
                      }
                    >
                      <ClipboardList className="w-3.5 h-3.5" />
                      Reorder Request List
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setActiveModule('inventory')}>
                    Manage Stock
                  </Button>
                </div>
              </div>
              {displayedAlerts.length === 0 ? (
                <p className="text-xs text-[var(--pos-text-muted)] py-3">
                  All consumables and supplies have healthy runway above reorder thresholds.
                </p>
              ) : (
                <div className="divide-y divide-[var(--pos-border)]">
                  {displayedAlerts.map((f) => {
                    if (!f) return null;
                    return (
                      <div
                        key={f.inventoryItemId}
                        className="py-2.5 flex flex-wrap items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-[var(--pos-text)] truncate">
                            {f.name}
                          </div>
                          <div className="text-xs text-[var(--pos-text-muted)] font-mono-num">
                            {f.sku} · Reorder {f.reorderLevel} {f.unit}
                            {f.minimumThreshold > 0 ? ` · Min ${f.minimumThreshold} ${f.unit}` : ''}
                            {f.weightedDailyVelocity > 0
                              ? ` · ${f.weightedDailyVelocity}/day (${
                                  f.daysUntilStockout !== null ? `~${f.daysUntilStockout}d left` : 'active'
                                })`
                              : ''}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {f.suggestedOrderQty > 0 && (
                            <span className="text-xs font-mono-num font-semibold text-[var(--pos-primary)]">
                              Suggest +{f.suggestedOrderQty} {f.unit}
                            </span>
                          )}
                          <StatusIndicator
                            tone={
                              f.currentStock <= 0 || f.isBelowMinimum
                                ? 'error'
                                : 'warning'
                            }
                            label={
                              f.currentStock <= 0
                                ? `Out of stock (${f.currentStock} ${f.unit})`
                                : f.isBelowMinimum
                                  ? `Below min (${f.currentStock} ${f.unit})`
                                  : f.isAtReorder
                                    ? `Low (${f.currentStock} ${f.unit})`
                                    : `${f.daysUntilThreshold ?? 0}d to threshold (${f.currentStock} ${f.unit})`
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        }

        if (widget.id === 'inventory_by_supplier') {
          return (
            <Card key={widget.id}>
              <InventorySupplierChart
                items={inventory}
                taxCurrency={taxCurr}
                onManageInventory={() => setActiveModule('inventory')}
              />
            </Card>
          );
        }

        if (widget.id === 'recent_transactions') {
          return (
            <div key={widget.id} className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[var(--pos-text)]">
                  Recent Transactions
                </h2>
                <span className="text-xs text-[var(--pos-text-muted)]">
                  Click any row for receipt or void/refund
                </span>
              </div>
              <DataTable
                rows={transactions.filter((t) => t.type === 'sale').slice(0, 8)}
                rowKey={(t) => t.id}
                onRowClick={(t) => setSelectedTxn(t)}
                columns={[
                  {
                    key: 'receipt',
                    label: 'Order #',
                    render: (t) => (
                      <div>
                        <div className="font-mono-num font-semibold text-xs">{t.receiptNumber}</div>
                        <div className="text-[11px] text-[var(--pos-text-muted)]">
                          {new Date(t.createdAt).toLocaleString()}
                        </div>
                      </div>
                    ),
                  },
                  {
                    key: 'customer',
                    label: 'Customer',
                    render: (t) => <span>{t.customerName}</span>,
                  },
                  {
                    key: 'items',
                    label: 'Items',
                    hideOnMobile: true,
                    render: (t) => (
                      <span className="text-xs text-[var(--pos-text-muted)]">
                        {t.items.length} item(s)
                      </span>
                    ),
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    render: (t) => (
                      <StatusIndicator
                        tone={
                          t.paymentStatus === 'paid'
                            ? 'success'
                            : t.paymentStatus === 'partial'
                              ? 'warning'
                              : 'error'
                        }
                        label={t.paymentStatus}
                      />
                    ),
                  },
                  {
                    key: 'total',
                    label: 'Total',
                    align: 'right',
                    render: (t) => (
                      <span className="font-mono-num font-semibold">
                        {formatCurrency(t.totalAmount, taxCurr)}
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          );
        }

        return null;
      })}

      {/* Customize Widgets Modal */}
      <Modal
        open={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        title="Customize Dashboard Widgets"
        subtitle="Reorder or hide dashboard cards"
        maxWidth="sm"
        footer={
          <Button size="sm" onClick={() => setCustomizeOpen(false)}>
            Done
          </Button>
        }
      >
        <div className="space-y-2">
          {widgets.map((w, idx) => (
            <div
              key={w.id}
              className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-[var(--pos-border)]"
            >
              <span className="text-sm font-medium text-[var(--pos-text)]">{w.label}</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => void moveWidget(w.id, -1)}
                  className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 cursor-pointer"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={idx === widgets.length - 1}
                  onClick={() => void moveWidget(w.id, 1)}
                  className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 cursor-pointer"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void toggleWidget(w.id)}
                  className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  {w.visible ? (
                    <Eye className="w-4 h-4 text-[var(--pos-primary)]" />
                  ) : (
                    <EyeOff className="w-4 h-4 text-[var(--pos-text-muted)]" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {/* Transaction Action / Receipt Modal */}
      <ReceiptModal
        open={Boolean(selectedTxn)}
        onClose={() => setSelectedTxn(null)}
        transaction={selectedTxn}
      />

      {selectedTxn && canManage && selectedTxn.paymentStatus === 'paid' && (
        <div className="hidden">
          <button
            type="button"
            onClick={() => void voidTransaction(selectedTxn.id, 'Voided from dashboard')}
          />
          <button
            type="button"
            onClick={() => void refundTransaction(selectedTxn.id, 'Refunded from dashboard')}
          />
        </div>
      )}
    </div>
  );
};
