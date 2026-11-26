import React from 'react';
import type { InventoryItem, StockMovementType } from '../../types/inventory.ts';
import { Button, Input, Select } from '../ui/Primitives.tsx';
import { Modal } from '../ui/Overlays.tsx';

interface StockAdjustmentModalProps {
  target: InventoryItem | null;
  currencySymbol: string;
  movementType: StockMovementType;
  delta: string;
  unitCost: string;
  reference: string;
  note: string;
  submitting: boolean;
  onChangeMovementType: (value: StockMovementType) => void;
  onChangeDelta: (value: string) => void;
  onChangeUnitCost: (value: string) => void;
  onChangeReference: (value: string) => void;
  onChangeNote: (value: string) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const StockAdjustmentModal: React.FC<StockAdjustmentModalProps> = ({
  target,
  currencySymbol,
  movementType,
  delta,
  unitCost,
  reference,
  note,
  submitting,
  onChangeMovementType,
  onChangeDelta,
  onChangeUnitCost,
  onChangeReference,
  onChangeNote,
  onClose,
  onSubmit,
}) => {
  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      title={target ? `Adjust Stock · ${target.name}` : ''}
      subtitle={
        target
          ? `On hand: ${target.quantityOnHand} ${target.unit} · Reorder level: ${target.reorderLevel} ${target.unit}`
          : ''
      }
      maxWidth="sm"
    >
      <form onSubmit={onSubmit} className="space-y-3.5">
        <Select
          label="Movement Type"
          value={movementType}
          onChange={(e) => onChangeMovementType(e.target.value as StockMovementType)}
          options={[
            { value: 'purchase', label: 'Purchase / Restock (+)' },
            { value: 'job_usage', label: 'Print Job Usage (-)' },
            { value: 'adjustment', label: 'Manual Adjustment (+/-)' },
            { value: 'wastage', label: 'Production Wastage (-)' },
            { value: 'damaged', label: 'Damaged Stock (-)' },
            { value: 'return', label: 'Supplier / Customer Return (+)' },
          ]}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label={`Quantity (${target?.unit || 'units'})`}
            type="number"
            step="0.1"
            className="font-mono-num"
            value={delta}
            onChange={(e) => onChangeDelta(e.target.value)}
            required
          />
          <Input
            label={`Unit Cost (${currencySymbol})`}
            type="number"
            min="0"
            step="0.01"
            className="font-mono-num"
            value={unitCost}
            onChange={(e) => onChangeUnitCost(e.target.value)}
          />
        </div>
        <Input
          label="Reference # (PO / Job / Receipt)"
          placeholder="e.g. PO-2026-042 or JO-261124-102"
          value={reference}
          onChange={(e) => onChangeReference(e.target.value)}
        />
        <Input
          label="Reason / Notes"
          placeholder="e.g. Monthly delivery or misprint wastage"
          value={note}
          onChange={(e) => onChangeNote(e.target.value)}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" disabled={submitting} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Apply Stock Update
          </Button>
        </div>
      </form>
    </Modal>
  );
};
