import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock,
  Edit2,
  Mail,
  MapPin,
  Package,
  Paperclip,
  Phone,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  Truck,
  UserCheck,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext.tsx';
import { formatCurrency } from '../../shared/pricingEngine.ts';
import {
  extractSupplierInfo,
  getInventoryStockStatus,
  getSuggestedRestockQuantity,
  isBelowMinimumThreshold,
} from '../../shared/inventoryModel.ts';
import { computePredictiveReorderForecasts } from '../../shared/predictiveReorderEngine.ts';
import {
  buildSupplierDirectory,
  type SupplierProfile,
} from '../../shared/supplierModel.ts';
import type { SupplierSavePayload } from '../../types/inventory.ts';
import {
  Button,
  Card,
  Input,
  Select,
  StatusIndicator,
} from '../../components/ui/Primitives.tsx';
import { Modal } from '../../components/ui/Overlays.tsx';
import { SupplierAnalyticsDashboard } from '../../components/suppliers/SupplierAnalyticsDashboard.tsx';
import { SupplierComparisonView } from '../../components/suppliers/SupplierComparisonView.tsx';
import { SupplierDocumentsPanel } from '../../components/suppliers/SupplierDocumentsPanel.tsx';
import {
  SupplierFormModal,
  type SupplierFormState,
} from '../../components/suppliers/SupplierFormModal.tsx';
import {
  SupplierPurchaseOrderModal,
  type PurchaseOrderLineDraft,
} from '../../components/suppliers/SupplierPurchaseOrderModal.tsx';

type SupplierFilterMode = 'all' | 'needs_reorder' | 'has_orders';
type SupplierDetailTab = 'materials' | 'orders' | 'forecast' | 'documents';
type SupplierViewMode = 'overview' | 'compare';

const EMPTY_FORM: SupplierFormState = {
  name: '',
  contactPerson: '',
  phone: '',
  email: '',
  address: '',
  defaultLeadTimeDays: '3',
  paymentTerms: 'Net 15',
  notes: '',
  syncToLinkedItems: true,
};

function generateSuggestedPoReference(): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(100 + Math.random() * 900);
  return `PO-${stamp}-${rand}`;
}

function addDaysToDateInput(dateStr: string, days: number): string {
  const base = new Date(`${dateStr}T12:00:00Z`);
  if (Number.isNaN(base.getTime())) return new Date().toISOString().slice(0, 10);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function formatSignedPercent(val: number | null): string {
  if (val === null) return '—';
  return `${val > 0 ? '+' : ''}${val.toFixed(1)}%`;
}

export const SuppliersModule: React.FC = () => {
  const {
    session,
    settings,
    suppliers,
    supplierDocuments,
    inventory,
    stockMovements,
    transactions,
    services,
    saveSupplier,
    deleteSupplier,
    uploadSupplierDocument,
    deleteSupplierDocument,
    recordSupplierOrder,
    setActiveModule,
    notify,
  } = useApp();

  const taxCurr = settings.taxAndCurrency;
  const canManageSuppliers =
    session?.user.role === 'admin' || session?.user.role === 'manager';

  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<SupplierFilterMode>('all');
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [detailTab, setDetailTab] = useState<SupplierDetailTab>('materials');
  const [showAnalytics, setShowAnalytics] = useState(true);
  const [viewMode, setViewMode] = useState<SupplierViewMode>('overview');
  const [compareAKey, setCompareAKey] = useState<string>('');
  const [compareBKey, setCompareBKey] = useState<string>('');

  // Add / Edit Supplier Modal
  const [formOpen, setFormOpen] = useState(false);
  const [formState, setFormState] = useState<SupplierFormState>(EMPTY_FORM);
  const [savingSupplier, setSavingSupplier] = useState(false);

  // Delete Supplier Modal
  const [deleteTarget, setDeleteTarget] = useState<SupplierProfile | null>(null);
  const [deletingSupplier, setDeletingSupplier] = useState(false);

  // Log Purchase Order Modal
  const [poModalOpen, setPoModalOpen] = useState(false);
  const [poSupplierName, setPoSupplierName] = useState('');
  const [poReference, setPoReference] = useState('');
  const [poOrderedDate, setPoOrderedDate] = useState(() =>
    addDaysToDateInput(new Date().toISOString().slice(0, 10), -3),
  );
  const [poExpectedDate, setPoExpectedDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [poDate, setPoDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [poNote, setPoNote] = useState('');
  const [poShowAllItems, setPoShowAllItems] = useState(false);
  const [poLines, setPoLines] = useState<PurchaseOrderLineDraft[]>([]);
  const [submittingPo, setSubmittingPo] = useState(false);

  const forecasts = useMemo(
    () =>
      computePredictiveReorderForecasts({
        inventory,
        transactions,
        services,
        stockMovements,
      }),
    [inventory, transactions, services, stockMovements],
  );

  const directory = useMemo(
    () =>
      buildSupplierDirectory({
        suppliers,
        inventory,
        stockMovements,
        forecasts,
        supplierDocuments,
      }),
    [suppliers, inventory, stockMovements, forecasts, supplierDocuments],
  );

  const filteredSuppliers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return directory.filter((sup) => {
      if (filterMode === 'needs_reorder') {
        if (sup.lowStockCount === 0 && sup.urgentForecastCount === 0) return false;
      } else if (filterMode === 'has_orders') {
        if (sup.totalOrderCount === 0) return false;
      }

      if (!q) return true;
      return (
        sup.name.toLowerCase().includes(q) ||
        sup.contactPerson.toLowerCase().includes(q) ||
        sup.phone.toLowerCase().includes(q) ||
        sup.email.toLowerCase().includes(q) ||
        sup.paymentTerms.toLowerCase().includes(q) ||
        sup.items.some(
          (i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q),
        ) ||
        sup.historicalOrders.some((o) => o.reference.toLowerCase().includes(q)) ||
        sup.documents.some(
          (d) =>
            d.title.toLowerCase().includes(q) ||
            (d.referenceNumber || '').toLowerCase().includes(q),
        )
      );
    });
  }, [directory, filterMode, search]);

  useEffect(() => {
    if (filteredSuppliers.length === 0) {
      setSelectedKey('');
      return;
    }
    const stillVisible = filteredSuppliers.some((s) => s.key === selectedKey);
    if (!stillVisible) {
      setSelectedKey(filteredSuppliers[0].key);
    }
  }, [filteredSuppliers, selectedKey]);

  const selectedSupplier = useMemo(
    () => directory.find((s) => s.key === selectedKey) ?? null,
    [directory, selectedKey],
  );

  useEffect(() => {
    if (directory.length === 0) {
      if (compareAKey) setCompareAKey('');
      if (compareBKey) setCompareBKey('');
      return;
    }
    const keys = new Set(directory.map((s) => s.key));
    const nextA = keys.has(compareAKey)
      ? compareAKey
      : keys.has(selectedKey)
        ? selectedKey
        : directory[0].key;
    const nextB = keys.has(compareBKey)
      ? compareBKey
      : (directory.find((s) => s.key !== nextA)?.key ?? directory[0].key);

    if (nextA !== compareAKey) setCompareAKey(nextA);
    if (nextB !== compareBKey) setCompareBKey(nextB);
  }, [directory, compareAKey, compareBKey, selectedKey]);

  // KPI metrics across supplier directory
  const kpiStats = useMemo(() => {
    const totalSuppliers = directory.length;
    const savedProfiles = directory.filter((s) => Boolean(s.record)).length;
    const leadTimes = directory
      .map((s) => s.effectiveLeadTimeDays)
      .filter((d) => d > 0);
    const avgLeadTime =
      leadTimes.length > 0
        ? Number((leadTimes.reduce((sum, d) => sum + d, 0) / leadTimes.length).toFixed(1))
        : 0;
    const atRiskSuppliers = directory.filter(
      (s) => s.leadTimeRiskCount > 0 || s.belowMinimumCount > 0,
    ).length;
    const totalOrders = directory.reduce((sum, s) => sum + s.totalOrderCount, 0);
    const totalPoSpend = Number(
      directory.reduce((sum, s) => sum + s.totalOrderSpend, 0).toFixed(2),
    );

    const trackedDeliveries = directory.reduce((sum, s) => sum + s.trackedDeliveryCount, 0);
    const onTimeDeliveries = directory.reduce((sum, s) => sum + s.onTimeDeliveryCount, 0);
    const fleetOnTimeRate =
      trackedDeliveries > 0
        ? Number(((onTimeDeliveries / trackedDeliveries) * 100).toFixed(1))
        : null;

    const allVarianceLines = directory.flatMap((s) =>
      s.historicalOrders
        .flatMap((o) => o.lines)
        .filter((l) => l.costVariancePct !== null),
    );
    const fleetAvgCostVariancePct =
      allVarianceLines.length > 0
        ? Number(
            (
              allVarianceLines.reduce(
                (sum, l) => sum + (l.costVariancePct ?? 0),
                0,
              ) / allVarianceLines.length
            ).toFixed(1),
          )
        : null;

    return {
      totalSuppliers,
      savedProfiles,
      avgLeadTime,
      atRiskSuppliers,
      totalOrders,
      totalPoSpend,
      trackedDeliveries,
      onTimeDeliveries,
      fleetOnTimeRate,
      fleetAvgCostVariancePct,
      varianceLineCount: allVarianceLines.length,
    };
  }, [directory]);

  const openNewSupplierModal = () => {
    setFormState(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEditSupplierModal = (profile: SupplierProfile) => {
    setFormState({
      id: profile.record?.id,
      previousName: profile.name,
      name: profile.name,
      contactPerson: profile.contactPerson,
      phone: profile.phone,
      email: profile.email,
      address: profile.address,
      defaultLeadTimeDays: String(profile.effectiveLeadTimeDays || 3),
      paymentTerms: profile.paymentTerms || 'Net 15',
      notes: profile.notes,
      syncToLinkedItems: true,
    });
    setFormOpen(true);
  };

  const handleSaveSupplierForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.name.trim()) {
      notify('Supplier name is required.', 'error');
      return;
    }
    setSavingSupplier(true);
    try {
      const payload: SupplierSavePayload = {
        id: formState.id,
        previousName: formState.previousName,
        name: formState.name.trim(),
        contactPerson: formState.contactPerson.trim(),
        phone: formState.phone.trim(),
        email: formState.email.trim(),
        address: formState.address.trim(),
        defaultLeadTimeDays: Math.max(
          0,
          Math.round(Number(formState.defaultLeadTimeDays) || 0),
        ),
        paymentTerms: formState.paymentTerms.trim(),
        notes: formState.notes.trim(),
        syncToLinkedItems: formState.syncToLinkedItems,
      };
      const saved = await saveSupplier(payload);
      setSelectedKey(saved.name.trim().toLowerCase());
      setFormOpen(false);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to save supplier.', 'error');
    } finally {
      setSavingSupplier(false);
    }
  };

  const handleConfirmDeleteSupplier = async () => {
    if (!deleteTarget?.record) return;
    setDeletingSupplier(true);
    try {
      await deleteSupplier(deleteTarget.record.id);
      setDeleteTarget(null);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to delete supplier.', 'error');
    } finally {
      setDeletingSupplier(false);
    }
  };

  const openPurchaseOrderModal = (
    profile: SupplierProfile,
    mode: 'standard' | 'from_forecast' = 'standard',
  ) => {
    const forecastMap = new Map(profile.forecasts.map((f) => [f.inventoryItemId, f]));
    const supplierItems = profile.items;
    const extraItems = inventory.filter(
      (item) => extractSupplierInfo(item).name.trim().toLowerCase() !== profile.key,
    );

    const buildLine = (item: (typeof inventory)[number], fromSupplier: boolean): PurchaseOrderLineDraft => {
      const forecast = forecastMap.get(item.id);
      const suggested =
        forecast && forecast.suggestedOrderQty > 0
          ? forecast.suggestedOrderQty
          : getSuggestedRestockQuantity(item) || Math.max(10, item.reorderQuantity || 20);
      const shouldPreselect =
        fromSupplier &&
        (mode === 'from_forecast'
          ? Boolean(forecast?.isNearingThreshold)
          : isBelowMinimumThreshold(item) || getInventoryStockStatus(item) !== 'in_stock');

      return {
        inventoryItemId: item.id,
        name: item.name,
        sku: item.sku,
        unit: item.unit,
        currentStock: item.quantityOnHand,
        selected: shouldPreselect,
        quantity: String(suggested),
        unitCost: String(item.unitCost),
      };
    };

    const lines = [
      ...supplierItems.map((i) => buildLine(i, true)),
      ...extraItems.map((i) => buildLine(i, false)),
    ];

    // If none were auto-selected yet and supplier has items, select the first item for convenience
    if (!lines.some((l) => l.selected) && supplierItems.length > 0) {
      lines[0].selected = true;
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const leadDays = Math.max(1, profile.effectiveLeadTimeDays || 3);
    const orderedDefault = addDaysToDateInput(todayStr, -leadDays);

    setPoSupplierName(profile.name);
    setPoReference(generateSuggestedPoReference());
    setPoOrderedDate(orderedDefault);
    setPoExpectedDate(todayStr);
    setPoDate(todayStr);
    setPoNote(
      mode === 'from_forecast'
        ? `Forecast-backed replenishment for ${profile.name}`
        : `Stock replenishment order from ${profile.name}`,
    );
    setPoShowAllItems(supplierItems.length === 0);
    setPoLines(lines);
    setPoModalOpen(true);
  };

  const poSupplierItemIds = useMemo(
    () => new Set((selectedSupplier?.items ?? []).map((i) => i.id)),
    [selectedSupplier],
  );

  const visiblePoLines = useMemo(() => {
    if (poShowAllItems) return poLines;
    return poLines.filter((l) => poSupplierItemIds.has(l.inventoryItemId) || l.selected);
  }, [poLines, poShowAllItems, poSupplierItemIds]);

  const poTotalSummary = useMemo(() => {
    const selected = poLines.filter((l) => l.selected && Number(l.quantity) > 0);
    const totalCost = selected.reduce(
      (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0),
      0,
    );
    return {
      count: selected.length,
      totalCost: Number(totalCost.toFixed(2)),
    };
  }, [poLines]);

  const handleSubmitPo = async (e: React.FormEvent) => {
    e.preventDefault();
    const selectedLines = poLines
      .filter((l) => l.selected && Number(l.quantity) > 0)
      .map((l) => ({
        inventoryItemId: l.inventoryItemId,
        quantity: Number(l.quantity),
        unitCost:
          l.unitCost.trim() !== '' && Number.isFinite(Number(l.unitCost))
            ? Number(l.unitCost)
            : undefined,
      }));

    if (selectedLines.length === 0) {
      notify('Select at least one material with a positive quantity.', 'error');
      return;
    }
    if (!poReference.trim()) {
      notify('Purchase order reference # is required.', 'error');
      return;
    }

    setSubmittingPo(true);
    try {
      const isoDate = poDate
        ? new Date(`${poDate}T12:00:00`).toISOString()
        : new Date().toISOString();
      const orderedIso = poOrderedDate
        ? new Date(`${poOrderedDate}T09:00:00`).toISOString()
        : undefined;
      const expectedIso = poExpectedDate
        ? new Date(`${poExpectedDate}T12:00:00`).toISOString()
        : undefined;
      await recordSupplierOrder({
        supplierName: poSupplierName,
        reference: poReference.trim(),
        occurredAt: isoDate,
        orderedAt: orderedIso,
        expectedDeliveryAt: expectedIso,
        note: poNote.trim(),
        items: selectedLines,
      });
      setPoModalOpen(false);
      setDetailTab('orders');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to log purchase order.', 'error');
    } finally {
      setSubmittingPo(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header Zone */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[var(--pos-text)] tracking-tight">
            Supplier Management
          </h2>
          <p className="text-xs text-[var(--pos-text-muted)] mt-0.5">
            Track vendor contact info, delivery lead times, procurement risk, and historical purchase orders
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {viewMode === 'overview' && (
            <Button
              variant="outline"
              size="sm"
              className="whitespace-nowrap shrink-0"
              onClick={() => setShowAnalytics((prev) => !prev)}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              {showAnalytics ? 'Hide Analytics' : 'Show Analytics'}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="whitespace-nowrap shrink-0"
            onClick={() => setActiveModule('inventory')}
          >
            <Package className="w-3.5 h-3.5" />
            View Inventory
          </Button>
          {canManageSuppliers && (
            <Button
              size="sm"
              className="whitespace-nowrap shrink-0"
              onClick={openNewSupplierModal}
            >
              <Plus className="w-4 h-4" />
              Add Supplier
            </Button>
          )}
        </div>
      </div>

      {/* Secondary View Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Supplier dashboard views"
          style={{ borderRadius: 'var(--pos-radius)' }}
          className="inline-flex items-center gap-1 p-1 bg-[var(--pos-bg)] border border-[var(--pos-border)]"
        >
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'overview'}
            onClick={() => setViewMode('overview')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
              viewMode === 'overview'
                ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs border border-[var(--pos-border)]'
                : 'text-[var(--pos-text-muted)] hover:text-[var(--pos-text)]'
            }`}
          >
            <Truck className="w-3.5 h-3.5" />
            Directory &amp; Analytics
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'compare'}
            onClick={() => setViewMode('compare')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
              viewMode === 'compare'
                ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs border border-[var(--pos-border)]'
                : 'text-[var(--pos-text-muted)] hover:text-[var(--pos-text)]'
            }`}
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            Compare Suppliers
          </button>
        </div>
      </div>

      {viewMode === 'compare' ? (
        <SupplierComparisonView
          suppliers={directory}
          supplierAKey={compareAKey}
          supplierBKey={compareBKey}
          onChangeSupplierA={setCompareAKey}
          onChangeSupplierB={setCompareBKey}
          onSwapSuppliers={() => {
            setCompareAKey(compareBKey);
            setCompareBKey(compareAKey);
          }}
          onInspectSupplier={(key) => {
            setSelectedKey(key);
            setViewMode('overview');
          }}
          taxCurrency={taxCurr}
        />
      ) : (
        <>
          {/* 4-Card KPI Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <div className="text-xs font-medium text-[var(--pos-text-muted)]">
            Active Suppliers
          </div>
          <div className="text-2xl font-bold font-mono-num text-[var(--pos-text)] mt-1">
            {kpiStats.totalSuppliers}
          </div>
          <div className="text-[11px] text-[var(--pos-text-muted)] mt-1 font-mono-num">
            Avg {kpiStats.avgLeadTime}d lead · {kpiStats.atRiskSuppliers} at risk
          </div>
        </Card>

        <Card>
          <div className="text-xs font-medium text-[var(--pos-text-muted)]">
            On-Time Delivery Rate
          </div>
          <div
            className={`text-2xl font-bold font-mono-num mt-1 ${
              kpiStats.fleetOnTimeRate === null
                ? 'text-[var(--pos-text)]'
                : kpiStats.fleetOnTimeRate >= 90
                  ? 'text-[var(--pos-success)]'
                  : kpiStats.fleetOnTimeRate >= 70
                    ? 'text-[var(--pos-warning)]'
                    : 'text-[var(--pos-error)]'
            }`}
          >
            {kpiStats.fleetOnTimeRate !== null
              ? `${kpiStats.fleetOnTimeRate.toFixed(1)}%`
              : '—'}
          </div>
          <div className="text-[11px] text-[var(--pos-text-muted)] mt-1 font-mono-num">
            {kpiStats.trackedDeliveries > 0
              ? `${kpiStats.onTimeDeliveries} of ${kpiStats.trackedDeliveries} tracked POs on schedule`
              : 'No scheduled delivery POs logged yet'}
          </div>
        </Card>

        <Card>
          <div className="text-xs font-medium text-[var(--pos-text-muted)]">
            Avg Cost Variance
          </div>
          <div
            className={`text-2xl font-bold font-mono-num mt-1 ${
              kpiStats.fleetAvgCostVariancePct === null
                ? 'text-[var(--pos-text)]'
                : kpiStats.fleetAvgCostVariancePct <= 0
                  ? 'text-[var(--pos-success)]'
                  : kpiStats.fleetAvgCostVariancePct <= 5
                    ? 'text-[var(--pos-warning)]'
                    : 'text-[var(--pos-error)]'
            }`}
          >
            {formatSignedPercent(kpiStats.fleetAvgCostVariancePct)}
          </div>
          <div className="text-[11px] text-[var(--pos-text-muted)] mt-1 font-mono-num">
            {kpiStats.varianceLineCount > 0
              ? `Across ${kpiStats.varianceLineCount} PO price benchmark${
                  kpiStats.varianceLineCount === 1 ? '' : 's'
                }`
              : 'Log repeat POs to track cost variance'}
          </div>
        </Card>

        <Card>
          <div className="text-xs font-medium text-[var(--pos-text-muted)]">
            Historical PO Spend
          </div>
          <div className="text-2xl font-bold font-mono-num text-[var(--pos-text)] mt-1">
            {formatCurrency(kpiStats.totalPoSpend, taxCurr)}
          </div>
          <div className="text-[11px] text-[var(--pos-text-muted)] mt-1 font-mono-num">
            Across {kpiStats.totalOrders} logged purchase order
            {kpiStats.totalOrders === 1 ? '' : 's'}
          </div>
        </Card>
      </div>

      {/* Supplier Performance Analytics Dashboard */}
      {showAnalytics && (
        <SupplierAnalyticsDashboard
          suppliers={directory}
          selectedKey={selectedKey}
          onSelectSupplier={(key) => setSelectedKey(key)}
          taxCurrency={taxCurr}
        />
      )}

      {/* Master-Detail Procurement Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left Directory */}
        <Card className="lg:col-span-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-[var(--pos-text)]">
              Supplier Directory ({filteredSuppliers.length})
            </h3>
          </div>

          <div className="space-y-2">
            <div className="relative">
              <Input
                aria-label="Search suppliers"
                leftIcon={<Search className="w-3.5 h-3.5" />}
                placeholder="Search vendor, contact, SKU, PO..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={search ? 'pr-8' : ''}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear supplier search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--pos-text-muted)] hover:text-[var(--pos-text)] cursor-pointer p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <Select
              aria-label="Filter suppliers"
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value as SupplierFilterMode)}
              options={[
                { value: 'all', label: `All Suppliers (${directory.length})` },
                {
                  value: 'needs_reorder',
                  label: `Needs Replenishment (${
                    directory.filter(
                      (s) => s.lowStockCount > 0 || s.urgentForecastCount > 0,
                    ).length
                  })`,
                },
                {
                  value: 'has_orders',
                  label: `With Order History (${
                    directory.filter((s) => s.totalOrderCount > 0).length
                  })`,
                },
              ]}
            />
          </div>

          <div className="divide-y divide-[var(--pos-border)] max-h-[540px] overflow-y-auto -mx-4 px-4">
            {filteredSuppliers.length === 0 ? (
              <div className="py-8 text-center text-xs text-[var(--pos-text-muted)] space-y-2">
                <Truck className="w-7 h-7 mx-auto opacity-40" />
                <div>No suppliers match your filter.</div>
              </div>
            ) : (
              filteredSuppliers.map((sup) => {
                const isSelected = sup.key === selectedKey;
                const statusTone =
                  sup.leadTimeRiskCount > 0 || sup.belowMinimumCount > 0
                    ? 'error'
                    : sup.lowStockCount > 0 || sup.urgentForecastCount > 0
                      ? 'warning'
                      : 'success';
                const statusLabel =
                  sup.leadTimeRiskCount > 0 || sup.belowMinimumCount > 0
                    ? 'Urgent'
                    : sup.lowStockCount > 0 || sup.urgentForecastCount > 0
                      ? 'Reorder'
                      : 'Healthy';

                return (
                  <button
                    key={sup.key}
                    type="button"
                    onClick={() => setSelectedKey(sup.key)}
                    className={`w-full py-3 px-2.5 -mx-2.5 text-left transition-colors cursor-pointer rounded-lg ${
                      isSelected
                        ? 'bg-[var(--pos-primary)]/10'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[var(--pos-text)] truncate">
                          {sup.name}
                        </div>
                        <div className="text-[11px] text-[var(--pos-text-muted)] truncate mt-0.5">
                          {sup.contactPerson || sup.phone || sup.email || 'No primary contact'}
                        </div>
                      </div>
                      <StatusIndicator tone={statusTone} label={statusLabel} />
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-2 text-[11px] text-[var(--pos-text-muted)] font-mono-num">
                      <span>
                        {sup.effectiveLeadTimeDays}d lead · {sup.items.length} SKU
                        {sup.items.length === 1 ? '' : 's'}
                      </span>
                      <span>
                        {sup.totalOrderCount} PO{sup.totalOrderCount === 1 ? '' : 's'} ·{' '}
                        {formatCurrency(sup.totalOrderSpend, taxCurr)}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </Card>

        {/* Right Detail Panel */}
        <div className="lg:col-span-8 space-y-4">
          {!selectedSupplier ? (
            <Card className="py-12 text-center space-y-3">
              <Truck className="w-8 h-8 mx-auto text-[var(--pos-text-muted)] opacity-50" />
              <div>
                <div className="text-sm font-semibold text-[var(--pos-text)]">
                  Select a supplier to inspect procurement details
                </div>
                <p className="text-xs text-[var(--pos-text-muted)] mt-1">
                  View contact info, lead-time coverage, supplied SKUs, and purchase order history.
                </p>
              </div>
              {canManageSuppliers && (
                <Button size="sm" onClick={openNewSupplierModal}>
                  <Plus className="w-4 h-4" />
                  Add First Supplier
                </Button>
              )}
            </Card>
          ) : (
            <>
              {/* Supplier Profile Summary Card */}
              <Card className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h3 className="text-lg font-bold text-[var(--pos-text)]">
                        {selectedSupplier.name}
                      </h3>
                      <StatusIndicator
                        tone={
                          selectedSupplier.leadTimeRiskCount > 0 ||
                          selectedSupplier.belowMinimumCount > 0
                            ? 'error'
                            : selectedSupplier.lowStockCount > 0
                              ? 'warning'
                              : 'success'
                        }
                        label={
                          selectedSupplier.leadTimeRiskCount > 0 ||
                          selectedSupplier.belowMinimumCount > 0
                            ? 'Action Required'
                            : selectedSupplier.lowStockCount > 0
                              ? 'Low Stock Watch'
                              : 'Supply Healthy'
                        }
                      />
                    </div>
                    <div className="text-xs text-[var(--pos-text-muted)]">
                      {selectedSupplier.record
                        ? `Saved Vendor Profile${
                            selectedSupplier.paymentTerms
                              ? ` · Terms: ${selectedSupplier.paymentTerms}`
                              : ''
                          }`
                        : 'Discovered from Inventory Records — click Edit / Save Profile to store full contact details'}
                    </div>
                  </div>

                  {canManageSuppliers && (
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        className="whitespace-nowrap shrink-0"
                        onClick={() => openPurchaseOrderModal(selectedSupplier, 'standard')}
                      >
                        <ShoppingBag className="w-3.5 h-3.5" />
                        Log Purchase Order
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="whitespace-nowrap shrink-0"
                        onClick={() => openEditSupplierModal(selectedSupplier)}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        {selectedSupplier.record ? 'Edit Info' : 'Save Profile'}
                      </Button>
                      {selectedSupplier.record && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove ${selectedSupplier.name}`}
                          onClick={() => setDeleteTarget(selectedSupplier)}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-[var(--pos-error)]" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {/* Contact & Lead Time Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2 border-t border-[var(--pos-border)] text-xs">
                  <div className="flex items-start gap-2.5">
                    <UserCheck className="w-4 h-4 text-[var(--pos-primary)] shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-[11px] text-[var(--pos-text-muted)]">
                        Contact Person
                      </div>
                      <div className="font-medium text-[var(--pos-text)] truncate">
                        {selectedSupplier.contactPerson || 'Not specified'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5">
                    <Phone className="w-4 h-4 text-[var(--pos-primary)] shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-[11px] text-[var(--pos-text-muted)]">Phone</div>
                      <div className="font-medium font-mono-num text-[var(--pos-text)] truncate">
                        {selectedSupplier.phone || 'Not specified'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5">
                    <Mail className="w-4 h-4 text-[var(--pos-primary)] shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-[11px] text-[var(--pos-text-muted)]">Email</div>
                      <div className="font-medium text-[var(--pos-text)] truncate">
                        {selectedSupplier.email || 'Not specified'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5">
                    <Clock className="w-4 h-4 text-[var(--pos-primary)] shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-[11px] text-[var(--pos-text-muted)]">
                        Delivery Lead Time
                      </div>
                      <div className="font-semibold font-mono-num text-[var(--pos-text)]">
                        {selectedSupplier.effectiveLeadTimeDays} day
                        {selectedSupplier.effectiveLeadTimeDays === 1 ? '' : 's'}
                        {selectedSupplier.minLeadTimeDays > 0 &&
                          selectedSupplier.maxLeadTimeDays > selectedSupplier.minLeadTimeDays && (
                            <span className="font-normal text-[var(--pos-text-muted)] ml-1">
                              (SKUs {selectedSupplier.minLeadTimeDays}–
                              {selectedSupplier.maxLeadTimeDays}d)
                            </span>
                          )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5">
                    <CalendarClock className="w-4 h-4 text-[var(--pos-primary)] shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-[11px] text-[var(--pos-text-muted)]">
                        Last Restock Order
                      </div>
                      <div className="font-medium font-mono-num text-[var(--pos-text)]">
                        {selectedSupplier.lastOrderDate
                          ? new Date(selectedSupplier.lastOrderDate).toLocaleDateString()
                          : 'No POs logged'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5">
                    <MapPin className="w-4 h-4 text-[var(--pos-primary)] shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-[11px] text-[var(--pos-text-muted)]">Address</div>
                      <div className="font-medium text-[var(--pos-text)] truncate">
                        {selectedSupplier.address || 'Not specified'}
                      </div>
                    </div>
                  </div>
                </div>

                {selectedSupplier.notes && (
                  <div
                    style={{ borderRadius: 'var(--pos-radius)' }}
                    className="px-3 py-2 text-xs bg-[var(--pos-bg)] border border-[var(--pos-border)] text-[var(--pos-text-muted)]"
                  >
                    <strong className="font-medium text-[var(--pos-text)]">Procurement Notes:</strong>{' '}
                    {selectedSupplier.notes}
                  </div>
                )}

                {/* Quick Metric Row */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 border-t border-[var(--pos-border)]">
                  <div>
                    <div className="text-[11px] text-[var(--pos-text-muted)]">Supplied SKUs</div>
                    <div className="text-base font-bold font-mono-num text-[var(--pos-text)]">
                      {selectedSupplier.items.length}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[var(--pos-text-muted)]">
                      On-Hand Stock Value
                    </div>
                    <div className="text-base font-bold font-mono-num text-[var(--pos-text)]">
                      {formatCurrency(selectedSupplier.totalStockValue, taxCurr)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[var(--pos-text-muted)]">
                      On-Time Delivery Rate
                    </div>
                    <div
                      className={`text-base font-bold font-mono-num ${
                        selectedSupplier.onTimeDeliveryRate === null
                          ? 'text-[var(--pos-text-muted)]'
                          : selectedSupplier.onTimeDeliveryRate >= 90
                            ? 'text-[var(--pos-success)]'
                            : selectedSupplier.onTimeDeliveryRate >= 70
                              ? 'text-[var(--pos-warning)]'
                              : 'text-[var(--pos-error)]'
                      }`}
                    >
                      {selectedSupplier.onTimeDeliveryRate !== null
                        ? `${selectedSupplier.onTimeDeliveryRate.toFixed(1)}% (${selectedSupplier.onTimeDeliveryCount}/${selectedSupplier.trackedDeliveryCount})`
                        : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[var(--pos-text-muted)]">
                      Avg Cost Variance
                    </div>
                    <div
                      className={`text-base font-bold font-mono-num ${
                        selectedSupplier.avgCostVariancePct === null
                          ? 'text-[var(--pos-text-muted)]'
                          : selectedSupplier.avgCostVariancePct <= 0
                            ? 'text-[var(--pos-success)]'
                            : selectedSupplier.avgCostVariancePct <= 5
                              ? 'text-[var(--pos-warning)]'
                              : 'text-[var(--pos-error)]'
                      }`}
                    >
                      {formatSignedPercent(selectedSupplier.avgCostVariancePct)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[var(--pos-text-muted)]">
                      Historical Orders
                    </div>
                    <div className="text-base font-bold font-mono-num text-[var(--pos-text)]">
                      {selectedSupplier.totalOrderCount} ·{' '}
                      {formatCurrency(selectedSupplier.totalOrderSpend, taxCurr)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[var(--pos-text-muted)]">
                      Next Suggested PO
                    </div>
                    <div
                      className={`text-base font-bold font-mono-num ${
                        selectedSupplier.recommendedOrderSpend > 0
                          ? 'text-[var(--pos-warning)]'
                          : 'text-[var(--pos-text)]'
                      }`}
                    >
                      {formatCurrency(selectedSupplier.recommendedOrderSpend, taxCurr)}
                    </div>
                  </div>
                </div>
              </Card>

              {/* Detail Sub-tabs */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div
                  role="tablist"
                  aria-label="Supplier details"
                  style={{ borderRadius: 'var(--pos-radius)' }}
                  className="inline-flex items-center gap-1 p-1 bg-[var(--pos-bg)] border border-[var(--pos-border)]"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={detailTab === 'materials'}
                    onClick={() => setDetailTab('materials')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                      detailTab === 'materials'
                        ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs border border-[var(--pos-border)]'
                        : 'text-[var(--pos-text-muted)] hover:text-[var(--pos-text)]'
                    }`}
                  >
                    Supplied Materials ({selectedSupplier.items.length})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={detailTab === 'orders'}
                    onClick={() => setDetailTab('orders')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                      detailTab === 'orders'
                        ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs border border-[var(--pos-border)]'
                        : 'text-[var(--pos-text-muted)] hover:text-[var(--pos-text)]'
                    }`}
                  >
                    Historical Orders ({selectedSupplier.historicalOrders.length})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={detailTab === 'forecast'}
                    onClick={() => setDetailTab('forecast')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                      detailTab === 'forecast'
                        ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs border border-[var(--pos-border)]'
                        : 'text-[var(--pos-text-muted)] hover:text-[var(--pos-text)]'
                    }`}
                  >
                    Procurement Forecast ({selectedSupplier.urgentForecastCount})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={detailTab === 'documents'}
                    onClick={() => setDetailTab('documents')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                      detailTab === 'documents'
                        ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs border border-[var(--pos-border)]'
                        : 'text-[var(--pos-text-muted)] hover:text-[var(--pos-text)]'
                    }`}
                  >
                    <Paperclip className="w-3.5 h-3.5" />
                    Contracts &amp; Invoices ({selectedSupplier.documents.length})
                  </button>
                </div>

                {detailTab === 'forecast' &&
                  canManageSuppliers &&
                  selectedSupplier.urgentForecastCount > 0 && (
                    <Button
                      size="sm"
                      className="whitespace-nowrap shrink-0"
                      onClick={() => openPurchaseOrderModal(selectedSupplier, 'from_forecast')}
                    >
                      <ClipboardList className="w-3.5 h-3.5" />
                      Create PO from Forecast
                    </Button>
                  )}
              </div>

              {/* Tab 1: Supplied Materials */}
              {detailTab === 'materials' && (
                <Card padded={false} className="overflow-hidden">
                  {selectedSupplier.items.length === 0 ? (
                    <div className="py-10 px-4 text-center text-xs text-[var(--pos-text-muted)] space-y-2">
                      <Package className="w-7 h-7 mx-auto opacity-40" />
                      <div>No inventory SKUs are currently linked to {selectedSupplier.name}.</div>
                      <div>
                        Assign this vendor inside Inventory Management or Import Suppliers CSV.
                      </div>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-[var(--pos-border)] text-[11px] uppercase tracking-wider text-[var(--pos-text-muted)] bg-[var(--pos-bg)]">
                            <th className="py-2.5 px-3 font-semibold">Material &amp; SKU</th>
                            <th className="py-2.5 px-3 font-semibold">Vendor SKU</th>
                            <th className="py-2.5 px-3 font-semibold text-right">On Hand</th>
                            <th className="py-2.5 px-3 font-semibold text-right">
                              Reorder / Min
                            </th>
                            <th className="py-2.5 px-3 font-semibold text-right">Lead Time</th>
                            <th className="py-2.5 px-3 font-semibold text-right">Unit Cost</th>
                            <th className="py-2.5 px-3 font-semibold text-right">Stock Value</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--pos-border)] text-xs">
                          {selectedSupplier.items.map((item) => {
                            const belowMin = isBelowMinimumThreshold(item);
                            const status = getInventoryStockStatus(item);
                            const supInfo = extractSupplierInfo(item);
                            const stockValue = Number(
                              (item.quantityOnHand * item.unitCost).toFixed(2),
                            );
                            return (
                              <tr
                                key={item.id}
                                className={
                                  belowMin
                                    ? 'bg-red-500/10 hover:bg-red-500/15'
                                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                                }
                              >
                                <td className="py-2.5 px-3">
                                  <div className="font-medium text-[var(--pos-text)]">
                                    {item.name}
                                  </div>
                                  <div className="text-[11px] text-[var(--pos-text-muted)] font-mono-num">
                                    {item.sku} · {item.category}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 font-mono-num text-[var(--pos-text-muted)]">
                                  {supInfo.supplierSku || '—'}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono-num">
                                  <span
                                    className={`font-semibold ${
                                      belowMin || status === 'out_of_stock'
                                        ? 'text-[var(--pos-error)]'
                                        : status === 'low_stock'
                                          ? 'text-[var(--pos-warning)]'
                                          : 'text-[var(--pos-text)]'
                                    }`}
                                  >
                                    {item.quantityOnHand} {item.unit}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono-num text-[var(--pos-text-muted)]">
                                  {item.reorderLevel} / {item.minimumThreshold || 0}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono-num text-[var(--pos-text)]">
                                  {supInfo.leadTimeDays || selectedSupplier.effectiveLeadTimeDays}d
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono-num text-[var(--pos-text)]">
                                  {formatCurrency(item.unitCost, taxCurr)}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono-num font-semibold text-[var(--pos-text)]">
                                  {formatCurrency(stockValue, taxCurr)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              )}

              {/* Tab 2: Historical Orders */}
              {detailTab === 'orders' && (
                <div className="space-y-3">
                  {selectedSupplier.historicalOrders.length === 0 ? (
                    <Card className="py-10 text-center space-y-3">
                      <ShoppingBag className="w-7 h-7 mx-auto text-[var(--pos-text-muted)] opacity-40" />
                      <div>
                        <div className="text-sm font-semibold text-[var(--pos-text)]">
                          No purchase orders logged for {selectedSupplier.name}
                        </div>
                        <p className="text-xs text-[var(--pos-text-muted)] mt-1">
                          Record incoming deliveries to track vendor pricing and lead-time cadence.
                        </p>
                      </div>
                      {canManageSuppliers && (
                        <Button
                          size="sm"
                          onClick={() => openPurchaseOrderModal(selectedSupplier, 'standard')}
                        >
                          <Plus className="w-4 h-4" />
                          Log First Purchase Order
                        </Button>
                      )}
                    </Card>
                  ) : (
                    selectedSupplier.historicalOrders.map((order) => (
                      <Card key={order.id} className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[var(--pos-border)]">
                          <div>
                            <div className="flex flex-wrap items-center gap-2.5">
                              <span className="text-sm font-bold font-mono-num text-[var(--pos-text)]">
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
                              {order.costVariancePct !== null && (
                                <span
                                  className={`text-[11px] font-mono-num font-semibold ${
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
                            <div className="text-[11px] text-[var(--pos-text-muted)] mt-0.5 font-mono-num">
                              Received {new Date(order.occurredAt).toLocaleDateString()}
                              {order.expectedDeliveryAt
                                ? ` · Expected ${new Date(
                                    order.expectedDeliveryAt,
                                  ).toLocaleDateString()}`
                                : ''}
                              {order.actualDeliveryDays !== null
                                ? ` · ${order.actualDeliveryDays}d transit`
                                : ''}
                              {' · '}Logged by {order.performedBy}
                              {order.note ? ` · ${order.note}` : ''}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-bold font-mono-num text-[var(--pos-text)]">
                              {formatCurrency(order.totalAmount, taxCurr)}
                            </div>
                            <div className="text-[11px] text-[var(--pos-text-muted)] font-mono-num">
                              {order.lines.length} line{order.lines.length === 1 ? '' : 's'} ·{' '}
                              {order.totalUnits} total units
                            </div>
                          </div>
                        </div>

                        <div className="divide-y divide-[var(--pos-border)] text-xs">
                          {order.lines.map((line) => (
                            <div
                              key={line.movementId}
                              className="py-1.5 flex items-center justify-between gap-3"
                            >
                              <div className="min-w-0">
                                <span className="font-medium text-[var(--pos-text)]">
                                  {line.itemName}
                                </span>
                                <span className="text-[11px] text-[var(--pos-text-muted)] font-mono-num ml-2">
                                  {line.sku}
                                </span>
                              </div>
                              <div className="font-mono-num text-[var(--pos-text)] shrink-0 flex items-center gap-3">
                                <span className="text-[var(--pos-text-muted)]">
                                  +{line.quantity} {line.unit} ×{' '}
                                  {formatCurrency(line.unitCost, taxCurr)}
                                </span>
                                {line.costVariancePct !== null && (
                                  <span
                                    className={`text-[11px] font-semibold ${
                                      line.costVariancePct <= 0
                                        ? 'text-[var(--pos-success)]'
                                        : line.costVariancePct <= 5
                                          ? 'text-[var(--pos-warning)]'
                                          : 'text-[var(--pos-error)]'
                                    }`}
                                  >
                                    {formatSignedPercent(line.costVariancePct)}
                                  </span>
                                )}
                                <span className="font-semibold">
                                  {formatCurrency(line.lineTotal, taxCurr)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </Card>
                    ))
                  )}
                </div>
              )}

              {/* Tab 3: Procurement Forecast */}
              {detailTab === 'forecast' && (
                <Card padded={false} className="overflow-hidden">
                  {selectedSupplier.forecasts.length === 0 ? (
                    <div className="py-10 px-4 text-center text-xs text-[var(--pos-text-muted)]">
                      Link inventory materials to {selectedSupplier.name} to view velocity-based procurement planning.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-[var(--pos-border)] text-[11px] uppercase tracking-wider text-[var(--pos-text-muted)] bg-[var(--pos-bg)]">
                            <th className="py-2.5 px-3 font-semibold">Material</th>
                            <th className="py-2.5 px-3 font-semibold text-right">Stock</th>
                            <th className="py-2.5 px-3 font-semibold text-right">
                              Daily Velocity
                            </th>
                            <th className="py-2.5 px-3 font-semibold text-right">
                              Runway vs. Lead ({selectedSupplier.effectiveLeadTimeDays}d)
                            </th>
                            <th className="py-2.5 px-3 font-semibold text-right">
                              Suggested Order
                            </th>
                            <th className="py-2.5 px-3 font-semibold text-right">Est. Cost</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--pos-border)] text-xs">
                          {selectedSupplier.forecasts.map((f) => {
                            const missesLeadTime =
                              f.currentStock <= 0 ||
                              (f.daysUntilStockout !== null &&
                                f.daysUntilStockout <= selectedSupplier.effectiveLeadTimeDays);

                            return (
                              <tr
                                key={f.inventoryItemId}
                                className={
                                  missesLeadTime || f.isBelowMinimum
                                    ? 'bg-red-500/10'
                                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                                }
                              >
                                <td className="py-2.5 px-3">
                                  <div className="font-medium text-[var(--pos-text)]">
                                    {f.name}
                                  </div>
                                  <div className="text-[11px] text-[var(--pos-text-muted)]">
                                    {f.rationale}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono-num">
                                  <span
                                    className={`font-semibold ${
                                      f.isBelowMinimum || f.currentStock <= 0
                                        ? 'text-[var(--pos-error)]'
                                        : f.isAtReorder
                                          ? 'text-[var(--pos-warning)]'
                                          : 'text-[var(--pos-text)]'
                                    }`}
                                  >
                                    {f.currentStock} {f.unit}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono-num text-[var(--pos-text)]">
                                  {f.weightedDailyVelocity > 0
                                    ? `${f.weightedDailyVelocity} / day`
                                    : '—'}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono-num">
                                  {f.daysUntilStockout !== null ? (
                                    <span
                                      className={`inline-flex items-center justify-end gap-1 font-semibold ${
                                        missesLeadTime
                                          ? 'text-[var(--pos-error)]'
                                          : f.isNearingThreshold
                                            ? 'text-[var(--pos-warning)]'
                                            : 'text-[var(--pos-success)]'
                                      }`}
                                    >
                                      {missesLeadTime ? (
                                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                      ) : (
                                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                      )}
                                      {f.daysUntilStockout}d left
                                    </span>
                                  ) : f.isNearingThreshold ? (
                                    <span className="text-[var(--pos-warning)] font-semibold">
                                      Below threshold
                                    </span>
                                  ) : (
                                    <span className="text-[var(--pos-text-muted)]">Healthy</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono-num font-semibold text-[var(--pos-text)]">
                                  {f.suggestedOrderQty > 0
                                    ? `${f.suggestedOrderQty} ${f.unit}`
                                    : '—'}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono-num font-semibold text-[var(--pos-text)]">
                                  {f.estimatedOrderCost > 0
                                    ? formatCurrency(f.estimatedOrderCost, taxCurr)
                                    : '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              )}

              {/* Tab 4: Digital Invoices & Supplier Contracts */}
              {detailTab === 'documents' && (
                <SupplierDocumentsPanel
                  supplier={selectedSupplier}
                  canManage={canManageSuppliers}
                  onUploadDocument={uploadSupplierDocument}
                  onDeleteDocument={deleteSupplierDocument}
                  onNotify={notify}
                />
              )}
            </>
          )}
        </div>
      </div>
        </>
      )}

      <SupplierFormModal
        open={formOpen}
        saving={savingSupplier}
        formState={formState}
        onChange={setFormState}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSaveSupplierForm}
      />

      <SupplierPurchaseOrderModal
        open={poModalOpen}
        submitting={submittingPo}
        supplierName={poSupplierName}
        reference={poReference}
        orderedDate={poOrderedDate}
        expectedDate={poExpectedDate}
        receivedDate={poDate}
        note={poNote}
        showAllItems={poShowAllItems}
        visibleLines={visiblePoLines}
        totalSummary={poTotalSummary}
        taxCurrency={taxCurr}
        onChangeReference={setPoReference}
        onChangeOrderedDate={setPoOrderedDate}
        onChangeExpectedDate={setPoExpectedDate}
        onChangeReceivedDate={setPoDate}
        onChangeNote={setPoNote}
        onChangeShowAllItems={setPoShowAllItems}
        onUpdateLines={setPoLines}
        onClose={() => setPoModalOpen(false)}
        onSubmit={handleSubmitPo}
      />

      {/* Delete Supplier Confirmation Modal */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (!deletingSupplier) setDeleteTarget(null);
        }}
        title="Remove Supplier Profile"
        subtitle={deleteTarget?.name || ''}
        maxWidth="sm"
        footer={
          <>
            <Button
              variant="secondary"
              type="button"
              disabled={deletingSupplier}
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              type="button"
              loading={deletingSupplier}
              onClick={() => void handleConfirmDeleteSupplier()}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Remove Profile
            </Button>
          </>
        }
      >
        {deleteTarget && (
          <p className="text-xs text-[var(--pos-text-muted)] leading-relaxed">
            Removing <strong className="text-[var(--pos-text)]">{deleteTarget.name}</strong>{' '}
            deletes its saved vendor profile and notes from the directory. Linked inventory items
            and historical stock movements are preserved.
          </p>
        )}
      </Modal>
    </div>
  );
};
