import React from 'react';
import { Button, Input } from '../ui/Primitives.tsx';
import { Modal } from '../ui/Overlays.tsx';

export interface SupplierFormState {
  id?: string;
  previousName?: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  defaultLeadTimeDays: string;
  paymentTerms: string;
  notes: string;
  syncToLinkedItems: boolean;
}

interface SupplierFormModalProps {
  open: boolean;
  saving: boolean;
  formState: SupplierFormState;
  onChange: React.Dispatch<React.SetStateAction<SupplierFormState>>;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const SupplierFormModal: React.FC<SupplierFormModalProps> = ({
  open,
  saving,
  formState,
  onChange,
  onClose,
  onSubmit,
}) => {
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!saving) onClose();
      }}
      title={formState.id ? `Edit Supplier · ${formState.previousName}` : 'Add Supplier Profile'}
      subtitle="Maintain contact details, delivery lead times, and payment terms for procurement planning"
      maxWidth="md"
    >
      <form onSubmit={onSubmit} className="space-y-3.5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Supplier Name *"
            placeholder="e.g. PaperOne Supply"
            value={formState.name}
            onChange={(e) => onChange((prev) => ({ ...prev, name: e.target.value }))}
            required
          />
          <Input
            label="Contact Person"
            placeholder="e.g. Ana Mendoza"
            value={formState.contactPerson}
            onChange={(e) => onChange((prev) => ({ ...prev, contactPerson: e.target.value }))}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Phone Number"
            placeholder="e.g. +63 2 8810 2200"
            value={formState.phone}
            onChange={(e) => onChange((prev) => ({ ...prev, phone: e.target.value }))}
          />
          <Input
            label="Email Address"
            type="email"
            placeholder="e.g. orders@vendor.local"
            value={formState.email}
            onChange={(e) => onChange((prev) => ({ ...prev, email: e.target.value }))}
          />
        </div>

        <Input
          label="Warehouse / Office Address"
          placeholder="Street, city, dispatch hub"
          value={formState.address}
          onChange={(e) => onChange((prev) => ({ ...prev, address: e.target.value }))}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Default Lead Time (days)"
            type="number"
            min="0"
            max="365"
            className="font-mono-num"
            value={formState.defaultLeadTimeDays}
            onChange={(e) =>
              onChange((prev) => ({ ...prev, defaultLeadTimeDays: e.target.value }))
            }
          />
          <Input
            label="Payment Terms"
            placeholder="e.g. Net 15, Net 30, COD"
            value={formState.paymentTerms}
            onChange={(e) => onChange((prev) => ({ ...prev, paymentTerms: e.target.value }))}
          />
        </div>

        <Input
          label="Procurement Notes"
          placeholder="Cut-off times, minimum order values, delivery terms..."
          value={formState.notes}
          onChange={(e) => onChange((prev) => ({ ...prev, notes: e.target.value }))}
        />

        <label className="flex items-center gap-2 text-xs text-[var(--pos-text)] p-2.5 rounded-lg border border-[var(--pos-border)] cursor-pointer">
          <input
            type="checkbox"
            checked={formState.syncToLinkedItems}
            onChange={(e) =>
              onChange((prev) => ({ ...prev, syncToLinkedItems: e.target.checked }))
            }
            className="h-4 w-4 accent-[var(--pos-primary)]"
          />
          <span>
            Sync supplier name, primary contact, and default lead time onto linked inventory SKUs
          </span>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {formState.id ? 'Save Changes' : 'Save Supplier'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
