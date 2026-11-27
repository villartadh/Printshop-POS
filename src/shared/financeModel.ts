import { isBelowMinimumThreshold } from './inventoryModel.ts';
import type {
  Customer,
  ExpenseRecord,
  InventoryItem,
  PrintJob,
  PrintService,
  ServiceCategory,
  Transaction,
} from './types.ts';

function roundCurrency(value: number): number {
  return Number((Number.isFinite(value) ? value : 0).toFixed(2));
}

function safeNonNegative(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

/**
 * Attributes payments by method while netting out any cash change given back
 * to the customer so the sum of breakdown buckets matches collected revenue
 * (`amountPaid`) rather than gross cash tendered.
 */
export function allocateTransactionPaymentsByMethod(
  transactions: Transaction[],
): Map<string, number> {
  const paymentMap = new Map<string, number>();

  for (const t of transactions) {
    if (!t || !Array.isArray(t.payments) || t.payments.length === 0) continue;
    let remainingChange = safeNonNegative(t.changeAmount);

    for (const p of t.payments) {
      if (!p) continue;
      const grossAmount = safeNonNegative(p.amount);
      let netAmount = grossAmount;

      if (p.methodType === 'cash' && remainingChange > 0) {
        const deducted = Math.min(grossAmount, remainingChange);
        netAmount = roundCurrency(grossAmount - deducted);
        remainingChange = roundCurrency(remainingChange - deducted);
      }

      if (netAmount > 0) {
        const key = p.methodName || p.methodType || 'Other';
        paymentMap.set(key, roundCurrency((paymentMap.get(key) || 0) + netAmount));
      }
    }
  }

  return paymentMap;
}

function parseTimestampMs(raw: string | undefined): number {
  if (!raw) return Number.NaN;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function getExpenseTimestampMs(expense: ExpenseRecord): number {
  if (expense.expenseDate && /^\d{4}-\d{2}-\d{2}$/.test(expense.expenseDate)) {
    const [year, month, day] = expense.expenseDate.split('-').map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0).getTime();
  }
  return parseTimestampMs(expense.expenseDate || expense.createdAt);
}

export interface DashboardMetricsResult {
  todaySales: number;
  weeklySales: number;
  monthlySales: number;
  totalTransactions: number;
  grossProfit: number;
  netProfit: number;
  totalExpenses: number;
  outstandingBalances: number;
  pendingJobsCount: number;
  completedJobsCount: number;
  lowStockItems: InventoryItem[];
  trendPoints: Array<{ label: string; value: number }>;
  topServices: Array<{ label: string; value: number; subtitle: string }>;
  paymentBreakdown: Array<{ label: string; value: number }>;
}

export function computeDashboardMetrics(params: {
  validSales: Transaction[];
  expenses: ExpenseRecord[];
  customers: Customer[];
  printJobs: PrintJob[];
  inventory: InventoryItem[];
  range: 'today' | 'week' | 'month';
  nowMs?: number;
}): DashboardMetricsResult {
  const {
    validSales,
    expenses,
    customers,
    printJobs,
    inventory,
    range,
    nowMs = Date.now(),
  } = params;

  const startOfToday = new Date(nowMs);
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();
  const weekMs = nowMs - 7 * 86400000;
  const monthMs = nowMs - 30 * 86400000;
  const rangeStartMs = range === 'today' ? todayMs : range === 'week' ? weekMs : monthMs;

  let todaySales = 0;
  let weeklySales = 0;
  let monthlySales = 0;
  let totalCost = 0;

  const serviceMap = new Map<string, { label: string; value: number; count: number }>();
  const rangedSales: Transaction[] = [];

  for (const t of validSales) {
    const ts = parseTimestampMs(t.createdAt);
    if (!Number.isFinite(ts)) continue;
    const totalAmount = safeNonNegative(t.totalAmount);

    if (ts >= todayMs) todaySales += totalAmount;
    if (ts >= weekMs) weeklySales += totalAmount;
    if (ts >= monthMs) monthlySales += totalAmount;

    if (ts >= rangeStartMs) {
      rangedSales.push(t);
      for (const item of t.items) {
        totalCost += safeNonNegative(item.costTotal);
        const prev = serviceMap.get(item.serviceName) || {
          label: item.serviceName,
          value: 0,
          count: 0,
        };
        prev.value = roundCurrency(prev.value + safeNonNegative(item.lineTotal));
        prev.count += safeNonNegative(item.effectiveQuantity);
        serviceMap.set(item.serviceName, prev);
      }
    }
  }

  const totalExpenses = roundCurrency(
    expenses.reduce((sum, e) => {
      const ts = getExpenseTimestampMs(e);
      if (!Number.isFinite(ts) || ts < rangeStartMs || ts > nowMs + 86400000) {
        return sum;
      }
      return sum + safeNonNegative(e.amount);
    }, 0),
  );

  const activeSalesTotal = roundCurrency(
    range === 'today' ? todaySales : range === 'week' ? weeklySales : monthlySales,
  );
  const roundedCost = roundCurrency(totalCost);
  const grossProfit = roundCurrency(activeSalesTotal - roundedCost);
  const netProfit = roundCurrency(grossProfit - totalExpenses);
  const outstandingBalances = roundCurrency(
    customers.reduce((s, c) => s + safeNonNegative(c.outstandingBalance), 0),
  );

  const pendingJobsCount = printJobs.filter(
    (j) => !['completed', 'cancelled'].includes(j.productionStatus),
  ).length;
  const completedJobsCount = printJobs.filter((j) => j.productionStatus === 'completed').length;
  const lowStockItems = inventory.filter(
    (i) => i.quantityOnHand <= i.reorderLevel || isBelowMinimumThreshold(i),
  );

  const trendPoints: Array<{ label: string; value: number }> = [];
  for (let d = 6; d >= 0; d--) {
    const day = new Date(nowMs - d * 86400000);
    const dayStr = day.toISOString().slice(0, 10);
    const label = day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const sum = roundCurrency(
      validSales
        .filter((t) => (t.createdAt || '').slice(0, 10) === dayStr)
        .reduce((s, t) => s + safeNonNegative(t.totalAmount), 0),
    );
    trendPoints.push({ label, value: sum });
  }

  const topServices = Array.from(serviceMap.values())
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
    .map((s) => ({
      label: s.label,
      value: roundCurrency(s.value),
      subtitle: `${Math.round(s.count)} units`,
    }));

  const paymentMap = allocateTransactionPaymentsByMethod(rangedSales);
  const paymentBreakdown = Array.from(paymentMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value: roundCurrency(value) }));

  return {
    todaySales: roundCurrency(todaySales),
    weeklySales: roundCurrency(weeklySales),
    monthlySales: roundCurrency(monthlySales),
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
}

export interface ProfitAndLossReportResult {
  revenue: number;
  cashReceived: number;
  receivables: number;
  estimatedMaterialCost: number;
  operatingExpenses: number;
  grossProfit: number;
  netProfit: number;
  byCategory: Array<{ label: string; value: number }>;
  byService: Array<{ label: string; value: number }>;
  byCashier: Array<{ label: string; value: number }>;
  byPayment: Array<{ label: string; value: number }>;
}

export function computeProfitAndLossReport(params: {
  rangedTxns: Transaction[];
  rangedExpenses: ExpenseRecord[];
  customers: Customer[];
  services: PrintService[];
  categories: ServiceCategory[];
}): ProfitAndLossReportResult {
  const { rangedTxns, rangedExpenses, customers, services, categories } = params;

  const active = rangedTxns.filter(
    (t) => t.type === 'sale' && t.paymentStatus !== 'voided' && t.paymentStatus !== 'refunded',
  );
  const revenue = roundCurrency(
    active.reduce((s, t) => s + safeNonNegative(t.totalAmount), 0),
  );
  const cashReceived = roundCurrency(
    active.reduce((s, t) => s + safeNonNegative(t.amountPaid), 0),
  );
  const receivables = roundCurrency(
    customers.reduce((s, c) => s + safeNonNegative(c.outstandingBalance), 0),
  );
  const estimatedMaterialCost = roundCurrency(
    active.reduce(
      (s, t) => s + t.items.reduce((is, i) => is + safeNonNegative(i.costTotal), 0),
      0,
    ),
  );
  const operatingExpenses = roundCurrency(
    rangedExpenses.reduce((s, e) => s + safeNonNegative(e.amount), 0),
  );
  const grossProfit = roundCurrency(revenue - estimatedMaterialCost);
  const netProfit = roundCurrency(grossProfit - operatingExpenses);

  const byCategory = new Map<string, number>();
  const byService = new Map<string, number>();
  const byCashier = new Map<string, number>();

  for (const t of active) {
    byCashier.set(
      t.cashierName,
      roundCurrency((byCashier.get(t.cashierName) || 0) + safeNonNegative(t.totalAmount)),
    );
    for (const i of t.items) {
      const lineTotal = safeNonNegative(i.lineTotal);
      byService.set(
        i.serviceName,
        roundCurrency((byService.get(i.serviceName) || 0) + lineTotal),
      );
      const srv = services.find((s) => s.id === i.serviceId);
      const catName =
        categories.find((c) => c.id === srv?.categoryId)?.name || 'Other / Custom';
      byCategory.set(catName, roundCurrency((byCategory.get(catName) || 0) + lineTotal));
    }
  }

  const byPaymentMap = allocateTransactionPaymentsByMethod(active);

  return {
    revenue,
    cashReceived,
    receivables,
    estimatedMaterialCost,
    operatingExpenses,
    grossProfit,
    netProfit,
    byCategory: Array.from(byCategory.entries()).map(([label, value]) => ({
      label,
      value: roundCurrency(value),
    })),
    byService: Array.from(byService.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value: roundCurrency(value) })),
    byCashier: Array.from(byCashier.entries()).map(([label, value]) => ({
      label,
      value: roundCurrency(value),
    })),
    byPayment: Array.from(byPaymentMap.entries()).map(([label, value]) => ({
      label,
      value: roundCurrency(value),
    })),
  };
}
