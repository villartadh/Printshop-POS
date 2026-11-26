import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('html5-qrcode', () => ({
  Html5QrcodeSupportedFormats: {
    QR_CODE: 0,
    CODE_128: 1,
    CODE_39: 2,
    CODE_93: 3,
    EAN_13: 4,
    EAN_8: 5,
    UPC_A: 6,
    UPC_E: 7,
    ITF: 8,
    CODABAR: 9,
    DATA_MATRIX: 10,
    PDF_417: 11,
    AZTEC: 12,
  },
  Html5Qrcode: class MockHtml5Qrcode {
    isScanning = false;
    static getCameras = vi.fn().mockResolvedValue([]);
    start = vi.fn().mockRejectedValue(new Error('No camera in test environment'));
    stop = vi.fn().mockResolvedValue(undefined);
    clear = vi.fn();
    scanFileV2 = vi.fn();
  },
}));

import { BarcodeReceivingScannerModal } from '../../components/inventory/BarcodeReceivingScannerModal.tsx';
import { DEMO_INVENTORY } from '../../shared/defaults.ts';

describe('BarcodeReceivingScannerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('looks up QR JSON payloads, adds preset quantity, and submits stock adjustments', async () => {
    const user = userEvent.setup();
    const onAdjustStock = vi.fn().mockResolvedValue({
      id: 'mov-test-1',
      inventoryItemId: 'inv-lam-film',
      itemName: 'Laminating Film A4 (125mic)',
      movementType: 'purchase',
      quantityBefore: 75,
      quantityDelta: 60,
      balanceAfter: 135,
      unitCostAtMovement: 4.4,
      referenceType: 'purchase_order',
      reference: 'RCV-2026',
      performedById: 'u1',
      performedBy: 'Admin',
      note: 'Scanned batch',
      occurredAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    render(
      <BarcodeReceivingScannerModal
        open={true}
        onClose={vi.fn()}
        inventory={DEMO_INVENTORY}
        canEditCatalog={true}
        onAdjustStock={onAdjustStock}
      />,
    );

    const lookupInput = screen.getByLabelText(/Manual \/ USB Scanner Input/i);
    await user.click(lookupInput);
    await user.paste(JSON.stringify({ barcode: '480001001003', qty: 50, unitCost: 4.4 }));
    await user.click(screen.getByRole('button', { name: 'Lookup' }));

    expect(screen.getByText('Laminating Film A4 (125mic)')).toBeInTheDocument();
    expect(screen.getByText(/Matched by Barcode/i)).toBeInTheDocument();

    // Add +10 preset to suggested 50 -> 60
    await user.click(screen.getByRole('button', { name: '+10' }));
    await user.click(screen.getByRole('button', { name: /Confirm & Update Stock/i }));

    await waitFor(() => expect(onAdjustStock).toHaveBeenCalledTimes(1));
    expect(onAdjustStock).toHaveBeenCalledWith(
      'inv-lam-film',
      expect.objectContaining({
        movementType: 'purchase',
        quantityDelta: 60,
        unitCost: 4.4,
      }),
    );

    // Session log reflects updated balance
    expect(screen.getByText(/Received This Session \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText('75 → 135')).toBeInTheDocument();
  });

  it('allows linking an unrecognized barcode to an existing inventory item', async () => {
    const user = userEvent.setup();
    const onAssignBarcode = vi.fn().mockResolvedValue({
      ...DEMO_INVENTORY[0],
      barcode: '480777888999',
    });

    render(
      <BarcodeReceivingScannerModal
        open={true}
        onClose={vi.fn()}
        inventory={DEMO_INVENTORY}
        canEditCatalog={true}
        onAdjustStock={vi.fn()}
        onAssignBarcode={onAssignBarcode}
      />,
    );

    await user.type(screen.getByLabelText(/Manual \/ USB Scanner Input/i), '480777888999');
    await user.click(screen.getByRole('button', { name: 'Lookup' }));

    expect(screen.getByText(/No matching inventory item found/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Link Barcode to Item/i }));

    await waitFor(() =>
      expect(onAssignBarcode).toHaveBeenCalledWith(DEMO_INVENTORY[0].id, '480777888999'),
    );
  });
});
