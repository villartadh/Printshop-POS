import React from 'react';
import { formatCurrency } from '../../shared/pricingEngine.ts';
import type { TaxAndCurrencyConfig } from '../../shared/types.ts';
import { Button, Input } from '../ui/Primitives.tsx';
import { Modal } from '../ui/Overlays.tsx';

export interface PurchaseOrderLineDraft {
  inventoryItemId: string;
  name: string;
  sku: string;
  unit: string;
  currentStock: number;
  selected: boolean;
  quantity: string;
  unitCost: string;
}

interface SupplierPurchaseOrderModalProps {
  open: boolean;
  submitting: boolean;
  supplierName: string;
  reference: string;
  orderedDate: string;
  expectedDate: string;
  receivedDate: string;
  note: string;
  showAllItems: boolean;
  visibleLines: PurchaseOrderLineDraft[];
  totalSummary: { count: number; totalCost: number };
  taxCurrency: TaxAndCurrencyConfig;
  onChangeReference: (value: string) => void;
  onChangeOrderedDate: (value: string) => void;
  onChangeExpectedDate: (value: string) => void;
  onChangeReceivedDate: (value: string) => void;
  onChangeNote: (value: string) => void;
  onChangeShowAllItems: (value: boolean) => void;
  onUpdateLines: React.Dispatch<React.SetStateAction<PurchaseOrderLineDraft[]>>;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const SupplierPurchaseOrderModal: React.FC<SupplierPurchaseOrderModalProps> = ({
  open,
  submitting,
  supplierName,
  reference,
  orderedDate,
  expectedDate,
  receivedDate,
  note,
  showAllItems,
  visibleLines,
  totalSummary,
  taxCurrency,
  onChangeReference,
  onChangeOrderedDate,
  onChangeExpectedDate,
  onChangeReceivedDate,
  onChangeNote,
  onChangeShowAllItems,
  onUpdateLines,
  onClose,
  onSubmit,
}) => {
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      title={`Log Purchase Order · ${supplierName}`}
      subtitle="Record received vendor deliveries to update stock levels, unit costs, and supplier PO history"
      maxWidth="lg"
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Input
            label="PO Reference # *"
            className="font-mono-num"
            value={reference}
            onChange={(e) => onChangeReference(e.target.value)}
            required
          />
          <Input
            label="Order Placed Date"
            type="date"
            className="font-mono-num"
            value={orderedDate}
            onChange={(e) => onChangeOrderedDate(e.target.value)}
          />
          <Input
            label="Expected Delivery"
            type="date"
            className="font-mono-num"
            value={expectedDate}
            onChange={(e) => onChangeExpectedDate(e.target.value)}
          />
          <Input
            label="Received Date"
            type="date"
            className="font-mono-num"
            value={receivedDate}
            onChange={(e) => onChangeReceivedDate(e.target.value)}
          />
        </div>

        <Input
          label="Notes / Invoice Ref"
          placeholder="Optional delivery remarks or supplier invoice number"
          value={note}
          onChange={(e) => onChangeNote(e.target.value)}
        />

        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-[var(--pos-text)]">
            Order Line Items ({totalSummary.count} selected)
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--pos-text-muted)] cursor-pointer">
            <input
              type="checkbox"
              checked={showAllItems}
              onChange={(e) => onChangeShowAllItems(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--pos-primary)]"
            />
            Show all inventory items
          </label>
        </div>

        <div className="border border-[var(--pos-border)] rounded-lg overflow-hidden max-h-72 overflow-y-auto">
          {visibleLines.length === 0 ? (
            <div className="p-6 text-center text-xs text-[var(--pos-text-muted)]">
              No inventory items linked to this supplier yet. Enable &ldquo;Show all inventory items&rdquo; above to select materials.
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--pos-border)] text-[11px] uppercase tracking-wider text-[var(--pos-text-muted)] bg-[var(--pos-bg)]">
                  <th className="py-2 px-3 w-8"></th>
                  <th className="py-2 px-3 font-semibold">Material</th>
                  <th className="py-2 px-3 font-semibold text-right">Stock</th>
                  <th className="py-2 px-3 font-semibold text-right w-28">Order Qty</th>
                  <th className="py-2 px-3 font-semibold text-right w-28">
                    Unit Cost ({taxCurrency.currencySymbol})
                  </th>
                  <th className="py-2 px-3 font-semibold text-right">Line Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--pos-border)] text-xs">
                {visibleLines.map((line) => {
                  const lineTotal = (Number(line.quantity) || 0) * (Number(line.unitCost) || 0);
                  return (
                    <tr
                      key={line.inventoryItemId}
                      className={line.selected ? 'bg-[var(--pos-primary)]/5' : ''}
                    >
                      <td className="py-2 px-3">
                        <input
                          type="checkbox"
                          checked={line.selected}
                          aria-label={`Include ${line.name}`}
                          onChange={(e) =>
                            onUpdateLines((prev) =>
                              prev.map((row) =>
                                row.inventoryItemId === line.inventoryItemId
                                  ? { ...row, selected: e.target.checked }
                                  : row,
                              ),
                            )
                          }
                          className="h-4 w-4 accent-[var(--pos-primary)]"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <div className="font-medium text-[var(--pos-text)]">{line.name}</div>
                        <div className="text-[11px] text-[var(--pos-text-muted)] font-mono-num">
                          {line.sku} · {line.unit}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right font-mono-num text-[var(--pos-text-muted)]">
                        {line.currentStock}
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          min="0.1"
                          step="0.1"
                          disabled={!line.selected}
                          aria-label={`Quantity for ${line.name}`}
                          value={line.quantity}
                          onChange={(e) =>
                            onUpdateLines((prev) =>
                              prev.map((row) =>
                                row.inventoryItemId === line.inventoryItemId
                                  ? { ...row, quantity: e.target.value }
                                  : row,
                              ),
                            )
                          }
                          className="w-full px-2 py-1 text-right font-mono-num text-xs rounded border border-[var(--pos-border)] bg-[var(--pos-surface)] disabled:opacity-40"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          disabled={!line.selected}
                          aria-label={`Unit cost for ${line.name}`}
                          value={line.unitCost}
                          onChange={(e) =>
                            onUpdateLines((prev) =>
                              prev.map((row) =>
                                row.inventoryItemId === line.inventoryItemId
                                  ? { ...row, unitCost: e.target.value }
                                  : row,
                              ),
                            )
                          }
                          className="w-full px-2 py-1 text-right font-mono-num text-xs rounded border border-[var(--pos-border)] bg-[var(--pos-surface)] disabled:opacity-40"
                        />
                      </td>
                      <td className="py-2 px-3 text-right font-mono-num font-semibold text-[var(--pos-text)]">
                        {line.selected ? formatCurrency(lineTotal, taxCurrency) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[var(--pos-border)]">
          <div className="text-xs text-[var(--pos-text-muted)]">
            PO Total:{' '}
            <strong className="text-sm font-mono-num text-[var(--pos-text)]">
              {formatCurrency(totalSummary.totalCost, taxCurrency)}
            </strong>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" type="button" disabled={submitting} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Receive PO &amp; Update Stock
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
};
