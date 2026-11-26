import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SupplierComparisonView } from '../../components/suppliers/SupplierComparisonView.tsx';
import { buildSupplierDirectory } from '../../shared/supplierModel.ts';
import {
  DEFAULT_SETTINGS,
  DEMO_INVENTORY,
  DEMO_STOCK_MOVEMENTS,
  DEMO_SUPPLIERS,
} from '../../shared/defaults.ts';

const suppliers = buildSupplierDirectory({
  suppliers: DEMO_SUPPLIERS,
  inventory: DEMO_INVENTORY,
  stockMovements: DEMO_STOCK_MOVEMENTS,
  forecasts: [],
});

describe('SupplierComparisonView', () => {
  it('renders side-by-side metrics and invokes selection, swap, and inspect callbacks', async () => {
    const user = userEvent.setup();
    const onChangeSupplierA = vi.fn();
    const onChangeSupplierB = vi.fn();
    const onSwapSuppliers = vi.fn();
    const onInspectSupplier = vi.fn();

    render(
      <SupplierComparisonView
        suppliers={suppliers}
        supplierAKey={suppliers[0].key}
        supplierBKey={suppliers[1].key}
        onChangeSupplierA={onChangeSupplierA}
        onChangeSupplierB={onChangeSupplierB}
        onSwapSuppliers={onSwapSuppliers}
        onInspectSupplier={onInspectSupplier}
        taxCurrency={DEFAULT_SETTINGS.taxAndCurrency}
      />,
    );

    expect(screen.getByText(/Compare Two Suppliers Side-by-Side/i)).toBeInTheDocument();
    expect(screen.getByText(/Target Lead Time/i)).toBeInTheDocument();
    expect(screen.getByText(/Avg Catalog Unit Cost/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Supplier A'), suppliers[2].key);
    expect(onChangeSupplierA).toHaveBeenCalledWith(suppliers[2].key);

    await user.click(screen.getByRole('button', { name: /Swap compared suppliers/i }));
    expect(onSwapSuppliers).toHaveBeenCalledTimes(1);

    const profileButtons = screen.getAllByRole('button', { name: /Profile/i });
    await user.click(profileButtons[0]);
    expect(onInspectSupplier).toHaveBeenCalledWith(suppliers[0].key);
  });

  it('shows warning indicator when the same supplier is chosen in both slots', () => {
    render(
      <SupplierComparisonView
        suppliers={suppliers}
        supplierAKey={suppliers[0].key}
        supplierBKey={suppliers[0].key}
        onChangeSupplierA={vi.fn()}
        onChangeSupplierB={vi.fn()}
        onSwapSuppliers={vi.fn()}
        onInspectSupplier={vi.fn()}
        taxCurrency={DEFAULT_SETTINGS.taxAndCurrency}
      />,
    );

    expect(
      screen.getByText(/Select two different suppliers for comparison/i),
    ).toBeInTheDocument();
  });
});
