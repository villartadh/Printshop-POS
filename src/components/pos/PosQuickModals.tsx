import React from 'react';
import { formatCurrency } from '../../shared/pricingEngine.ts';
import type { TaxAndCurrencyConfig, Transaction } from '../../shared/types.ts';
import { Button, Input, Select } from '../ui/Primitives.tsx';
import { EmptyState, Modal } from '../ui/Overlays.tsx';

interface PosQuickModalsProps {
  taxCurrency: TaxAndCurrencyConfig;
  // Custom item modal
  customItemOpen: boolean;
  onCloseCustomItem: () => void;
  customName: string;
  onChangeCustomName: (val: string) => void;
  customPrice: string;
  onChangeCustomPrice: (val: string) => void;
  customQty: string;
  onChangeCustomQty: (val: string) => void;
  onSubmitCustomItem: (e: React.FormEvent) => void;
  // Order discount modal
  discountModalOpen: boolean;
  onCloseDiscountModal: () => void;
  orderDiscountType: 'none' | 'percent' | 'fixed';
  onChangeOrderDiscountType: (val: 'none' | 'percent' | 'fixed') => void;
  orderDiscountValue: number;
  onChangeOrderDiscountValue: (val: number) => void;
  // Recall held orders modal
  recallModalOpen: boolean;
  onCloseRecallModal: () => void;
  heldOrders: Transaction[];
  onRecallOrder: (held: Transaction) => Promise<void>;
  // Quick add customer modal
  quickCustomerOpen: boolean;
  onCloseQuickCustomer: () => void;
  newCustName: string;
  onChangeNewCustName: (val: string) => void;
  newCustPhone: string;
  onChangeNewCustPhone: (val: string) => void;
  onSubmitQuickCustomer: () => Promise<void>;
  // Scanner lookup modal
  scannerOpen: boolean;
  onCloseScanner: () => void;
  searchQuery: string;
  onChangeSearchQuery: (val: string) => void;
  onScannerKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export const PosQuickModals: React.FC<PosQuickModalsProps> = ({
  taxCurrency,
  customItemOpen,
  onCloseCustomItem,
  customName,
  onChangeCustomName,
  customPrice,
  onChangeCustomPrice,
  customQty,
  onChangeCustomQty,
  onSubmitCustomItem,
  discountModalOpen,
  onCloseDiscountModal,
  orderDiscountType,
  onChangeOrderDiscountType,
  orderDiscountValue,
  onChangeOrderDiscountValue,
  recallModalOpen,
  onCloseRecallModal,
  heldOrders,
  onRecallOrder,
  quickCustomerOpen,
  onCloseQuickCustomer,
  newCustName,
  onChangeNewCustName,
  newCustPhone,
  onChangeNewCustPhone,
  onSubmitQuickCustomer,
  scannerOpen,
  onCloseScanner,
  searchQuery,
  onChangeSearchQuery,
  onScannerKeyDown,
}) => {
  return (
    <>
      <Modal
        open={customItemOpen}
        onClose={onCloseCustomItem}
        title="Add Custom Service"
        subtitle="One-off print job or manual line item"
        maxWidth="sm"
      >
        <form onSubmit={onSubmitCustomItem} className="space-y-3.5">
          <Input
            label="Service / Item Description"
            placeholder="e.g. Custom Die-Cut Vinyl Sticker"
            value={customName}
            onChange={(e) => onChangeCustomName(e.target.value)}
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={`Unit Price (${taxCurrency.currencySymbol})`}
              type="number"
              min="1"
              step="0.01"
              value={customPrice}
              onChange={(e) => onChangeCustomPrice(e.target.value)}
              required
            />
            <Input
              label="Quantity"
              type="number"
              min="1"
              value={customQty}
              onChange={(e) => onChangeCustomQty(e.target.value)}
              required
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={onCloseCustomItem}>
              Cancel
            </Button>
            <Button type="submit">Add to Order</Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={discountModalOpen}
        onClose={onCloseDiscountModal}
        title="Order Discount"
        maxWidth="sm"
        footer={
          <Button size="sm" onClick={onCloseDiscountModal}>
            Apply
          </Button>
        }
      >
        <div className="space-y-3">
          <Select
            label="Discount Type"
            value={orderDiscountType}
            onChange={(e) =>
              onChangeOrderDiscountType(e.target.value as 'none' | 'percent' | 'fixed')
            }
            options={[
              { value: 'none', label: 'No Discount' },
              { value: 'percent', label: 'Percentage (%)' },
              { value: 'fixed', label: `Fixed Amount (${taxCurrency.currencySymbol})` },
            ]}
          />
          {orderDiscountType !== 'none' && (
            <Input
              label={orderDiscountType === 'percent' ? 'Discount (%)' : 'Discount Amount'}
              type="number"
              min="0"
              step="0.01"
              value={orderDiscountValue}
              onChange={(e) =>
                onChangeOrderDiscountValue(Math.max(0, Number(e.target.value) || 0))
              }
            />
          )}
        </div>
      </Modal>

      <Modal
        open={recallModalOpen}
        onClose={onCloseRecallModal}
        title="Recall Held Orders"
        maxWidth="md"
      >
        {heldOrders.length === 0 ? (
          <EmptyState
            title="No held orders"
            description="Orders put on hold during checkout will appear here."
          />
        ) : (
          <div className="space-y-2.5">
            {heldOrders.map((h) => (
              <div
                key={h.id}
                className="p-3 rounded-lg border border-[var(--pos-border)] flex items-center justify-between gap-3"
              >
                <div>
                  <div className="text-sm font-semibold text-[var(--pos-text)]">
                    {h.receiptNumber} · {h.customerName}
                  </div>
                  <div className="text-xs text-[var(--pos-text-muted)]">
                    {h.items.length} item(s) · {formatCurrency(h.totalAmount, taxCurrency)}
                  </div>
                </div>
                <Button size="sm" onClick={() => void onRecallOrder(h)}>
                  Recall
                </Button>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={quickCustomerOpen}
        onClose={onCloseQuickCustomer}
        title="Quick Add Customer"
        maxWidth="sm"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await onSubmitQuickCustomer();
          }}
          className="space-y-3"
        >
          <Input
            label="Customer Name"
            value={newCustName}
            onChange={(e) => onChangeNewCustName(e.target.value)}
            required
          />
          <Input
            label="Phone Number"
            value={newCustPhone}
            onChange={(e) => onChangeNewCustPhone(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={onCloseQuickCustomer}>
              Cancel
            </Button>
            <Button type="submit">Save &amp; Select</Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={scannerOpen}
        onClose={onCloseScanner}
        title="SKU & Barcode Lookup"
        subtitle="Scan with a USB/Bluetooth barcode wedge or enter SKU manually"
        maxWidth="sm"
      >
        <div className="space-y-3">
          <Input
            label="Barcode / SKU"
            placeholder="e.g. PRT-BW-01"
            autoFocus
            value={searchQuery}
            onChange={(e) => onChangeSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onScannerKeyDown(e);
                onCloseScanner();
              }
            }}
          />
          <p className="text-xs text-[var(--pos-text-muted)]">
            {typeof window !== 'undefined' && 'BarcodeDetector' in window
              ? 'Native BarcodeDetector API is available on this device.'
              : 'Hardware keyboard-wedge scanners work directly in the search field; press Enter after scanning.'}
          </p>
        </div>
      </Modal>
    </>
  );
};
