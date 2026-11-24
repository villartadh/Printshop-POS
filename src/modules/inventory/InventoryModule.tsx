import React, { useMemo, useState } from 'react';
import { ArrowUpDown, Edit2, Plus, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext.tsx';
import { formatCurrency } from '../../shared/pricingEngine.ts';
import {
  filterInventoryItems,
  getAvailableStock,
  getInventoryStockStatus,
  getSuggestedRestockQuantity,
  resolveSupplyCategory,
  STOCK_MOVEMENT_LABELS,
} from '../../shared/inventoryModel.ts';
import type {
  InventoryItem,
  StockMovementType,
  SupplyCategory,
} from '../../types/inventory.ts';
import { Button, Card, Input, Select, StatusIndicator } from '../../components/ui/Primitives.tsx';
import { DataTable } from '../../components/ui/DataTable.tsx';
import { Modal } from '../../components/ui/Overlays.tsx';

export const InventoryModule: React.FC = () => {
  const {
    session,
    settings,
    inventoryState,
    loadInventory,
    createInventoryItem,
    updateInventoryItem,
    trackStockChange,
  } = useApp();
  const {
    items: inventory,
    stockMovements,
    supplyCategories,
    lowStockItems: lowStock,
    totalValuation,
    loading: loadingInventory,
    error: inventoryError,
  } = inventoryState;
  const taxCurr = settings.taxAndCurrency;
  const canEditCatalog =
    session?.user.role === 'admin' || session?.user.role === 'manager';

  const [tab, setTab] = useState<'items' | 'low_stock' | 'movements'>('items');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<InventoryItem | null>(null);

  // Add/Edit item form
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState(
    supplyCategories[0]?.id || 'sup-cat-paper',
  );
  const [categoryName, setCategoryName] = useState(supplyCategories[0]?.name || 'Paper');
  const [itemType, setItemType] = useState<'consumable' | 'finished_product'>('consumable');
  const [unit, setUnit] = useState(supplyCategories[0]?.defaultUnit || 'sheet');
  const [qty, setQty] = useState('100');
  const [reorder, setReorder] = useState('50');
  const [reorderQty, setReorderQty] = useState('200');
  const [cost, setCost] = useState('1.50');
  const [supplier, setSupplier] = useState('');
  const [supplierContact, setSupplierContact] = useState('');
  const [supplierSku, setSupplierSku] = useState('');
  const [storageLocation, setStorageLocation] = useState('');

  // Adjust form
  const [movementType, setMovementType] = useState<StockMovementType>('purchase');
  const [delta, setDelta] = useState('50');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  const visibleItems = useMemo(() => {
    const base = tab === 'low_stock' ? lowStock : inventory;
    return filterInventoryItems(
      base,
      {
        search,
        categoryId: categoryFilter,
      },
      supplyCategories,
    );
  }, [tab, lowStock, inventory, search, categoryFilter, supplyCategories]);

  const handleSelectSupplyCategory = (catId: string, applyDefaultUnit: boolean) => {
    setSelectedCategoryId(catId);
    const matched: SupplyCategory | undefined = resolveSupplyCategory(supplyCategories, catId);
    if (matched) {
      setCategoryName(matched.name);
      if (applyDefaultUnit) {
        setUnit(matched.defaultUnit);
      }
    }
  };

  const openNewItemModal = () => {
    const firstCat = supplyCategories[0];
    setEditingItem(null);
    setName('');
    setSku('');
    setSelectedCategoryId(firstCat?.id || 'sup-cat-paper');
    setCategoryName(firstCat?.name || 'Paper');
    setItemType('consumable');
    setUnit(firstCat?.defaultUnit || 'sheet');
    setQty('100');
    setReorder('50');
    setReorderQty('200');
    setCost('1.50');
    setSupplier('');
    setSupplierContact('');
    setSupplierSku('');
    setStorageLocation('');
    setItemModalOpen(true);
  };

  const openEditItemModal = (item: InventoryItem) => {
    const matched = resolveSupplyCategory(
      supplyCategories,
      item.categoryId || item.category,
    );
    const sup = item.supplierInfo;
    setEditingItem(item);
    setName(item.name);
    setSku(item.sku);
    setSelectedCategoryId(matched?.id || 'custom');
    setCategoryName(item.category);
    setItemType(item.itemType);
    setUnit(item.unit);
    setQty(String(item.quantityOnHand));
    setReorder(String(item.reorderLevel));
    setReorderQty(String(item.reorderQuantity ?? Math.max(item.reorderLevel * 2, 0)));
    setCost(String(item.unitCost));
    setSupplier(sup?.name || item.supplier || '');
    setSupplierContact(sup?.contact || item.supplierContact || '');
    setSupplierSku(sup?.supplierSku || item.supplierSku || '');
    setStorageLocation(item.storageLocation || '');
    setItemModalOpen(true);
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const resolvedCatId =
      selectedCategoryId === 'custom' ? undefined : selectedCategoryId;
    const supplierInfoPayload = supplier.trim()
      ? {
          name: supplier.trim(),
          contact: supplierContact.trim(),
          supplierSku: supplierSku.trim(),
        }
      : undefined;

    if (editingItem) {
      await updateInventoryItem(editingItem.id, {
        name,
        sku,
        categoryId: resolvedCatId,
        category: categoryName,
        itemType,
        unit,
        reorderLevel: Number(reorder) || 0,
        reorderQuantity: Number(reorderQty) || 0,
        unitCost: Number(cost) || 0,
        supplier,
        supplierContact,
        supplierSku,
        supplierInfo: supplierInfoPayload,
        storageLocation,
      });
    } else {
      await createInventoryItem({
        name,
        sku: sku || `MAT-${Date.now().toString().slice(-4)}`,
        categoryId: resolvedCatId,
        category: categoryName,
        itemType,
        unit,
        quantityOnHand: Number(qty) || 0,
        reorderLevel: Number(reorder) || 0,
        reorderQuantity: Number(reorderQty) || 0,
        unitCost: Number(cost) || 0,
        supplier,
        supplierContact,
        supplierSku,
        supplierInfo: supplierInfoPayload,
        storageLocation,
      });
    }
    setItemModalOpen(false);
    setEditingItem(null);
  };

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustTarget) return;
    await trackStockChange(adjustTarget.id, {
      movementType,
      quantityDelta: Number(delta) || 0,
      reference,
      note,
    });
    setAdjustTarget(null);
    setReference('');
    setNote('');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--pos-text)]">Inventory & Consumables</h1>
          <p className="text-xs text-[var(--pos-text-muted)]">
            Track stock counts, supply categories, reorder levels, suppliers, and usage movements
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="whitespace-nowrap shrink-0"
            disabled={loadingInventory}
            onClick={() => void loadInventory()}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingInventory ? 'animate-spin' : ''}`} />
            {loadingInventory ? 'Refreshing...' : 'Refresh'}
          </Button>
          {canEditCatalog && (
            <Button size="sm" className="whitespace-nowrap shrink-0" onClick={openNewItemModal}>
              <Plus className="w-4 h-4" />
              Add Material / Product
            </Button>
          )}
        </div>
      </div>

      {inventoryError && (
        <div className="px-3 py-2 text-xs font-medium text-[#DC2626] bg-[#DC2626]/10 border border-[#DC2626]/25 rounded-lg">
          {inventoryError}
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <div className="text-xs text-[var(--pos-text-muted)]">Total Tracked SKUs</div>
          <div className="text-xl font-bold font-mono-num mt-1">{inventory.length}</div>
        </Card>
        <Card>
          <div className="text-xs text-[var(--pos-text-muted)]">Low-Stock Alerts</div>
          <div className="text-xl font-bold font-mono-num text-[#D97706] mt-1">
            {lowStock.length}
          </div>
        </Card>
        <Card>
          <div className="text-xs text-[var(--pos-text-muted)]">Inventory Valuation</div>
          <div className="text-xl font-bold font-mono-num text-[var(--pos-text)] mt-1">
            {formatCurrency(totalValuation, taxCurr)}
          </div>
        </Card>
      </div>

      {/* Tabs, SupplyCategory Filter & Search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
          <button
            type="button"
            onClick={() => setTab('items')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap ${
              tab === 'items'
                ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs'
                : 'text-[var(--pos-text-muted)]'
            }`}
          >
            All Stock ({inventory.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('low_stock')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap ${
              tab === 'low_stock'
                ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs'
                : 'text-[var(--pos-text-muted)]'
            }`}
          >
            Low Stock ({lowStock.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('movements')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap ${
              tab === 'movements'
                ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs'
                : 'text-[var(--pos-text-muted)]'
            }`}
          >
            Stock Movements
          </button>
        </div>

        {tab !== 'movements' && (
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <div className="w-full sm:w-44">
              <Select
                aria-label="Filter by supply category"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                options={[
                  { value: 'all', label: 'All Supply Categories' },
                  ...supplyCategories.map((sc) => ({
                    value: sc.id,
                    label: sc.name,
                  })),
                ]}
              />
            </div>
            <div className="w-full sm:w-60">
              <Input
                placeholder="Search SKU, material, supplier..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      {tab === 'movements' ? (
        <DataTable
          rows={stockMovements}
          rowKey={(m) => m.id}
          columns={[
            {
              key: 'item',
              label: 'Material / Reference',
              render: (m) => (
                <div>
                  <div className="text-sm font-medium">{m.itemName}</div>
                  <div className="text-[11px] text-[var(--pos-text-muted)]">
                    {m.performedBy}
                    {m.reference ? ` · Ref: ${m.reference}` : ''}
                    {m.note ? ` · ${m.note}` : ''}
                  </div>
                </div>
              ),
            },
            {
              key: 'type',
              label: 'Movement',
              render: (m) => (
                <div>
                  <div className="text-xs font-medium text-[var(--pos-text)]">
                    {STOCK_MOVEMENT_LABELS[m.movementType] || m.movementType}
                  </div>
                  <div className="text-[11px] text-[var(--pos-text-muted)]">
                    {new Date(m.occurredAt || m.createdAt).toLocaleString()}
                  </div>
                </div>
              ),
            },
            {
              key: 'delta',
              label: 'Change',
              align: 'right',
              render: (m) => (
                <span
                  className={`font-mono-num font-semibold ${
                    m.quantityDelta >= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]'
                  }`}
                >
                  {m.quantityDelta >= 0 ? `+${m.quantityDelta}` : m.quantityDelta}
                </span>
              ),
            },
            {
              key: 'after',
              label: 'Before → After',
              align: 'right',
              render: (m) => (
                <span className="font-mono-num text-xs">
                  {m.quantityBefore !== undefined ? `${m.quantityBefore} → ` : ''}
                  <strong className="font-semibold text-[var(--pos-text)]">{m.balanceAfter}</strong>
                </span>
              ),
            },
          ]}
        />
      ) : (
        <DataTable
          rows={visibleItems}
          rowKey={(i) => i.id}
          columns={[
            {
              key: 'name',
              label: 'Item & Supplier',
              render: (i) => {
                const supName = i.supplierInfo?.name || i.supplier || 'No supplier';
                const supContact = i.supplierInfo?.contact || i.supplierContact;
                return (
                  <div>
                    <div className="text-sm font-semibold">{i.name}</div>
                    <div className="text-[11px] text-[var(--pos-text-muted)]">
                      {i.sku} · {i.category}
                      {i.storageLocation ? ` · ${i.storageLocation}` : ''}
                    </div>
                    <div className="text-[11px] text-[var(--pos-text-muted)]">
                      {supName}
                      {supContact ? ` · ${supContact}` : ''}
                    </div>
                  </div>
                );
              },
            },
            {
              key: 'qty',
              label: 'On Hand / Reorder',
              align: 'right',
              render: (i) => {
                const avail = getAvailableStock(i);
                return (
                  <div>
                    <div className="font-mono-num font-semibold">
                      {i.quantityOnHand} {i.unit}
                    </div>
                    <div className="text-[11px] text-[var(--pos-text-muted)] font-mono-num">
                      Min {i.reorderLevel}
                      {(i.reservedQuantity || 0) > 0 ? ` · Avail ${avail}` : ''}
                    </div>
                  </div>
                );
              },
            },
            {
              key: 'cost',
              label: 'Unit Cost',
              align: 'right',
              hideOnMobile: true,
              render: (i) => (
                <span className="font-mono-num">{formatCurrency(i.unitCost, taxCurr)}</span>
              ),
            },
            {
              key: 'status',
              label: 'Status',
              render: (i) => {
                const status = getInventoryStockStatus(i);
                return (
                  <StatusIndicator
                    tone={
                      status === 'out_of_stock'
                        ? 'error'
                        : status === 'low_stock'
                          ? 'warning'
                          : 'success'
                    }
                    label={
                      status === 'out_of_stock'
                        ? 'Out of Stock'
                        : status === 'low_stock'
                          ? 'Low Stock'
                          : 'In Stock'
                    }
                  />
                );
              },
            },
            {
              key: 'action',
              label: 'Actions',
              align: 'right',
              render: (i) => (
                <div className="inline-flex items-center justify-end gap-1.5">
                  {canEditCatalog && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditItemModal(i)}
                      title="Edit item & supplier details"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const suggested = getSuggestedRestockQuantity(i);
                      setAdjustTarget(i);
                      setMovementType('purchase');
                      setDelta(String(suggested > 0 ? suggested : 50));
                      setReference('');
                      setNote('');
                    }}
                  >
                    <ArrowUpDown className="w-3.5 h-3.5" />
                    Stock
                  </Button>
                </div>
              ),
            },
          ]}
        />
      )}

      {/* Add / Edit Material Modal */}
      <Modal
        open={itemModalOpen}
        onClose={() => setItemModalOpen(false)}
        title={editingItem ? `Edit Item · ${editingItem.name}` : 'Add Inventory Material or Product'}
        maxWidth="md"
      >
        <form onSubmit={handleSaveItem} className="space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Item Name" value={name} onChange={(e) => setName(e.target.value)} required />
            <Input
              label="SKU"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="Auto if empty"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Select
              label="Type"
              value={itemType}
              onChange={(e) => setItemType(e.target.value as typeof itemType)}
              options={[
                { value: 'consumable', label: 'Consumable Material' },
                { value: 'finished_product', label: 'Finished Product' },
              ]}
            />
            <Select
              label="Supply Category"
              value={selectedCategoryId}
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'custom') {
                  setSelectedCategoryId('custom');
                } else {
                  handleSelectSupplyCategory(val, !editingItem);
                }
              }}
              options={[
                ...supplyCategories.map((sc) => ({
                  value: sc.id,
                  label: `${sc.name} (${sc.defaultUnit})`,
                })),
                { value: 'custom', label: 'Custom Category' },
              ]}
            />
            <Input
              label="Unit (sheet, pc, sq ft)"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              required
            />
          </div>
          {selectedCategoryId === 'custom' && (
            <Input
              label="Custom Category Name"
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
              required
            />
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {!editingItem && (
              <Input
                label="Initial Stock"
                type="number"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            )}
            <Input
              label="Reorder Level"
              type="number"
              value={reorder}
              onChange={(e) => setReorder(e.target.value)}
            />
            <Input
              label="Reorder Qty"
              type="number"
              value={reorderQty}
              onChange={(e) => setReorderQty(e.target.value)}
            />
            <Input
              label={`Unit Cost (${taxCurr.currencySymbol})`}
              type="number"
              step="0.01"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Supplier Name"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
            />
            <Input
              label="Supplier Contact (Phone / Email)"
              value={supplierContact}
              onChange={(e) => setSupplierContact(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Supplier SKU / Code"
              value={supplierSku}
              onChange={(e) => setSupplierSku(e.target.value)}
            />
            <Input
              label="Storage Location (Rack / Shelf)"
              value={storageLocation}
              onChange={(e) => setStorageLocation(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setItemModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">{editingItem ? 'Save Changes' : 'Save Item'}</Button>
          </div>
        </form>
      </Modal>

      {/* Stock Adjustment Modal */}
      <Modal
        open={Boolean(adjustTarget)}
        onClose={() => setAdjustTarget(null)}
        title={adjustTarget ? `Adjust Stock · ${adjustTarget.name}` : ''}
        subtitle={
          adjustTarget
            ? `On hand: ${adjustTarget.quantityOnHand} ${adjustTarget.unit} · Reorder level: ${adjustTarget.reorderLevel}`
            : ''
        }
        maxWidth="sm"
      >
        <form onSubmit={handleAdjust} className="space-y-3.5">
          <Select
            label="Movement Type"
            value={movementType}
            onChange={(e) => setMovementType(e.target.value as StockMovementType)}
            options={[
              { value: 'purchase', label: 'Purchase / Restock (+)' },
              { value: 'job_usage', label: 'Print Job Usage (-)' },
              { value: 'adjustment', label: 'Manual Adjustment (+/-)' },
              { value: 'wastage', label: 'Production Wastage (-)' },
              { value: 'damaged', label: 'Damaged Stock (-)' },
              { value: 'return', label: 'Supplier / Customer Return (+)' },
            ]}
          />
          <Input
            label={`Quantity (${adjustTarget?.unit || 'units'})`}
            type="number"
            step="0.1"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            required
          />
          <Input
            label="Reference # (PO / Job / Receipt)"
            placeholder="e.g. PO-2026-042 or JO-261124-102"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          <Input
            label="Reason / Notes"
            placeholder="e.g. Monthly delivery or misprint wastage"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setAdjustTarget(null)}>
              Cancel
            </Button>
            <Button type="submit">Apply Stock Update</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
