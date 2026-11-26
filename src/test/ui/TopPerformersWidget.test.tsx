import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TopPerformersWidget } from '../../components/suppliers/TopPerformersWidget.tsx';
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

describe('TopPerformersWidget', () => {
  it('ranks suppliers by total spend with progress bars and supports sort, limit, and selection', async () => {
    const user = userEvent.setup();
    const onSelectSupplier = vi.fn();

    render(
      <TopPerformersWidget
        suppliers={suppliers}
        selectedKey={suppliers[0].key}
        onSelectSupplier={onSelectSupplier}
        taxCurrency={DEFAULT_SETTINGS.taxAndCurrency}
      />,
    );

    expect(screen.getByText('Top Performers')).toBeInTheDocument();

    const rows = screen.getAllByRole('row').slice(1); // skip header
    expect(rows).toHaveLength(6);
    expect(screen.getAllByRole('progressbar')).toHaveLength(6);

    // Top-ranked spend supplier is SignCraft Media (600 units * ~7.25 = 4,350)
    expect(within(rows[0]).getByText('#1')).toBeInTheDocument();
    expect(within(rows[0]).getByText('SignCraft Media')).toBeInTheDocument();

    // Flip sort direction to ascending -> #6 is now first row
    await user.click(screen.getByRole('button', { name: /Sort spending volume ascending/i }));
    const ascRows = screen.getAllByRole('row').slice(1);
    expect(within(ascRows[0]).getByText('#6')).toBeInTheDocument();

    // Flip back to descending and limit to Top 5
    await user.click(screen.getByRole('button', { name: /Sort spending volume descending/i }));
    await user.click(screen.getByRole('button', { name: 'Top 5' }));
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(5);

    // Click row selects supplier
    await user.click(screen.getByText('SignCraft Media'));
    expect(onSelectSupplier).toHaveBeenCalledWith('signcraft media');
  });
});
