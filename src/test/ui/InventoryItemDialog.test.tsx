import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InventoryItemDialog } from '../../components/inventory/InventoryItemDialog.tsx';
import { DEFAULT_SUPPLY_CATEGORIES, DEMO_INVENTORY } from '../../shared/defaults.ts';

describe('InventoryItemDialog', () => {
  it('auto-updates suggested SKU from category and supplier, supports manual override, and validates duplicates', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <InventoryItemDialog
        open={true}
        onClose={onClose}
        existingItems={DEMO_INVENTORY}
        supplyCategories={DEFAULT_SUPPLY_CATEGORIES}
        onSave={onSave}
      />,
    );

    const skuInput = screen.getByLabelText(/Product SKU/i) as HTMLInputElement;
    expect(skuInput.value).toBe('PAP-GEN-001');

    // Change supply category to Ink & Toner -> updates SKU prefix and default unit
    await user.selectOptions(screen.getByLabelText(/Supply Category/i), 'sup-cat-ink-toner');
    expect(skuInput.value).toBe('INK-GEN-001');
    expect((screen.getByLabelText(/Stock Unit/i) as HTMLInputElement).value).toBe('bottle');

    // Enter supplier -> updates SKU supplier code
    await user.type(screen.getByLabelText(/Supplier Name/i), 'Epson Partner Hub');
    expect(skuInput.value).toBe('INK-EPP-001');

    // Enable manual override and type duplicate SKU from DEMO_INVENTORY
    await user.click(screen.getByRole('button', { name: /Manual Override/i }));
    await user.clear(skuInput);
    await user.type(skuInput, 'MAT-PAP-A4');
    expect(screen.getByText(/is already used by/i)).toBeInTheDocument();

    // Reset back to auto-generated SKU
    await user.click(screen.getByRole('button', { name: /Use Auto/i }));
    expect(skuInput.value).toBe('INK-EPP-001');

    // Fill name and submit
    await user.type(screen.getByLabelText(/Item Name/i), 'Cyan Dye Ink 1L');
    await user.click(screen.getByRole('button', { name: /Save Item/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const savedPayload = onSave.mock.calls[0][0];
    expect(savedPayload).toMatchObject({
      name: 'Cyan Dye Ink 1L',
      sku: 'INK-EPP-001',
      categoryId: 'sup-cat-ink-toner',
      unit: 'bottle',
      supplier: 'Epson Partner Hub',
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
