import React, { useMemo, useState } from 'react';
import { ArrowUpDown, Plus } from 'lucide-react';
import { useApp } from '../../context/AppContext.tsx';
import { formatCurrency } from '../../shared/pricingEngine.ts';
import type { InventoryItem, StockMovement } from '../../shared/types.ts';
import { Button, Card, Input, Select, StatusIndicator } from '../../components/ui/Primitives.tsx';
import { DataTable } from '../../components/ui/DataTable.tsx';
import { Modal } from '../../components/ui/Overlays.tsx';

export const InventoryModule: React.FC = () => {
  const { settings, inventory, stockMovements, createInventoryItem, adjustInventory } = useApp();
  const taxCurr = settings.taxAndCurrency;

  const [tab, setTab] = useState<'items' | 'low_stock' | 'movements'>('items');
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<InventoryItem | null>(null);

  // Add item form
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [category, setCategory] = useState('Paper');
  const [itemType, setItemType] = useState<'consumable' | 'finished_product'>('consumable');
  const [unit, setUnit] = useState('sheet');
  const [qty, setQty] = useState('100');
  const [reorder, setReorder] = useState('50');
  const [cost, setCost] = useState('1.50');
  const [supplier, setSupplier] = useState('');

  // Adjust form
  const [movementType, setMovementType] = useState<StockMovement['movementType']>('purchase');
  const [delta, setDelta] = useState('50');
  const [note, setNote] = useState('');

  const lowStock = useMemo(
    () => inventory.filter((i) => i.quantityOnHand <= i.reorderLevel),
    [inventory],
  );
  const totalValuation = useMemo(
    () => inventory.reduce((s, i) => s + i.quantityOnHand * i.unitCost, 0),
    [inventory],
  );

  const visibleItems = useMemo(() => {
    const base = tab === 'low_stock' ? lowStock : inventory;
    const q = search.trim().toLowerCase();
    return q
      ? base.filter(
          (i) =>
            i.name.toLowerCase().includes(q) ||
            i.sku.toLowerCase().includes(q) ||
            i.supplier.toLowerCase().includes(q),
        )
      : base;
  }, [tab, lowStock, inventory, search]);

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    await createInventoryItem({
      name,
      sku: sku || `MAT-${Date.now().toString().slice(-4)}`,
      category,
      itemType,
      unit,
      quantityOnHand: Number(qty) || 0,
      reorderLevel: Number(reorder) || 0,
      unitCost: Number(cost) || 0,
      supplier,
    });
    setName('');
    setSku('');
    setSupplier('');
    setAddOpen(false);
  };

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustTarget) return;
    await adjustInventory(adjustTarget.id, {
      movementType,
      quantityDelta: Number(delta) || 0,
      note,
    });
    setAdjustTarget(null);
    setNote('');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--pos-text)]">Inventory & Consumables</h1>
          <p className="text-xs text-[var(--pos-text-muted)]">
            Track printing paper, ink, tarpaulin rolls, finished goods, and stock wastage
          </p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="w-4 h-4" />
          Add Material / Product
        </Button>
      </div>

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

      {/* Tabs & Search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
          <button
            type="button"
            onClick={() => setTab('items')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
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
            className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
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
            className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
              tab === 'movements'
                ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs'
                : 'text-[var(--pos-text-muted)]'
            }`}
          >
            Stock Movements
          </button>
        </div>
        {tab !== 'movements' && (
          <div className="w-full sm:w-64">
            <Input
              placeholder="Search SKU, material, supplier..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
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
              label: 'Material / Product',
              render: (m) => (
                <div>
                  <div className="text-sm font-medium">{m.itemName}</div>
                  <div className="text-[11px] text-[var(--pos-text-muted)]">
                    {m.performedBy} · {new Date(m.createdAt).toLocaleString()}
                  </div>
                </div>
              ),
            },
            {
              key: 'type',
              label: 'Type',
              render: (m) => (
                <span className="text-xs capitalize text-[var(--pos-text-muted)]">
                  {m.movementType.replace(/_/g, ' ')}
                </span>
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
              label: 'Balance',
              align: 'right',
              render: (m) => <span className="font-mono-num">{m.balanceAfter}</span>,
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
              label: 'Item',
              render: (i) => (
                <div>
                  <div className="text-sm font-semibold">{i.name}</div>
                  <div className="text-[11px] text-[var(--pos-text-muted)]">
                    {i.sku} · {i.category} · {i.supplier || 'No supplier'}
                  </div>
                </div>
              ),
            },
            {
              key: 'qty',
              label: 'On Hand',
              align: 'right',
              render: (i) => (
                <span className="font-mono-num font-semibold">
                  {i.quantityOnHand} {i.unit}
                </span>
              ),
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
              render: (i) => (
                <StatusIndicator
                  tone={
                    i.quantityOnHand <= 0
                      ? 'error'
                      : i.quantityOnHand <= i.reorderLevel
                        ? 'warning'
                        : 'success'
                  }
                  label={
                    i.quantityOnHand <= 0
                      ? 'Out of Stock'
                      : i.quantityOnHand <= i.reorderLevel
                        ? 'Low Stock'
                        : 'In Stock'
                  }
                />
              ),
            },
            {
              key: 'action',
              label: 'Adjust',
              align: 'right',
              render: (i) => (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setAdjustTarget(i);
                    setMovementType('purchase');
                    setDelta('50');
                  }}
                >
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  Stock
                </Button>
              ),
            },
          ]}
        />
      )}

      {/* Add Material Modal */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add Inventory Material or Product"
        maxWidth="md"
      >
        <form onSubmit={handleAddItem} className="space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Item Name" value={name} onChange={(e) => setName(e.target.value)} required />
            <Input label="SKU" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Auto if empty" />
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
            <Input label="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
            <Input label="Unit (sheet, pc, sq ft)" value={unit} onChange={(e) => setUnit(e.target.value)} required />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input label="Initial Stock" type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
            <Input label="Reorder Level" type="number" value={reorder} onChange={(e) => setReorder(e.target.value)} />
            <Input
              label={`Unit Cost (${taxCurr.currencySymbol})`}
              type="number"
              step="0.01"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </div>
          <Input label="Supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Save Item</Button>
          </div>
        </form>
      </Modal>

      {/* Stock Adjustment Modal */}
      <Modal
        open={Boolean(adjustTarget)}
        onClose={() => setAdjustTarget(null)}
        title={adjustTarget ? `Adjust Stock · ${adjustTarget.name}` : ''}
        subtitle={
          adjustTarget ? `Current on hand: ${adjustTarget.quantityOnHand} ${adjustTarget.unit}` : ''
        }
        maxWidth="sm"
      >
        <form onSubmit={handleAdjust} className="space-y-3.5">
          <Select
            label="Movement Type"
            value={movementType}
            onChange={(e) => setMovementType(e.target.value as StockMovement['movementType'])}
            options={[
              { value: 'purchase', label: 'Purchase / Restock (+)' },
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
            label="Reason / Reference"
            placeholder="e.g. PO #1024 or Misprint wastage"
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
