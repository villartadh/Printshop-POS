import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test-utils.ts';
import { ServiceEditorModal } from '../../components/services/ServiceEditorModal.tsx';
import { ServiceConfigurator } from '../../modules/pos/ServiceConfigurator.tsx';
import { DEFAULT_SETTINGS, DEMO_CATEGORIES, DEMO_INVENTORY, DEMO_SERVICES } from '../../shared/defaults.ts';
import type { PrintService } from '../../shared/types.ts';

describe('Dynamic & Reusable Services UI Flows', () => {
  it('builds a dynamic service from a blueprint, adds custom option group, bulk tier, and multiple consumables', async () => {
    const onSave = vi.fn(async (payload: Partial<PrintService> & { id?: string }) => ({
      id: 'srv-saved-1',
      updatedAt: new Date().toISOString(),
      sku: payload.sku || 'SRV-1',
      name: payload.name || 'Saved',
      categoryId: payload.categoryId || 'cat-merch',
      description: payload.description || '',
      iconName: payload.iconName || 'Tag',
      pricingMethod: payload.pricingMethod || 'tiered_bulk',
      basePrice: payload.basePrice ?? 100,
      unitLabel: payload.unitLabel || 'pc',
      costEstimate: payload.costEstimate ?? 30,
      requiresConfiguration: payload.requiresConfiguration ?? true,
      requiresProductionJob: payload.requiresProductionJob ?? false,
      allowCustomDimensions: payload.allowCustomDimensions ?? false,
      allowPagesAndCopies: payload.allowPagesAndCopies ?? false,
      allowRushFee: payload.allowRushFee ?? true,
      rushFeePercent: payload.rushFeePercent ?? 25,
      defaultDesignFee: payload.defaultDesignFee ?? 0,
      bulkTiers: payload.bulkTiers || [],
      formulaExpression: payload.formulaExpression || '',
      attributeGroups: payload.attributeGroups || [],
      consumables: payload.consumables || [],
      isFavorite: payload.isFavorite ?? false,
      isArchived: payload.isArchived ?? false,
    }));
    const onClose = vi.fn();

    const { user } = renderWithProviders(
      <ServiceEditorModal
        open={true}
        onClose={onClose}
        editingService={null}
        categories={DEMO_CATEGORIES}
        services={DEMO_SERVICES}
        inventory={DEMO_INVENTORY}
        taxCurrency={DEFAULT_SETTINGS.taxAndCurrency}
        onSave={onSave}
      />,
    );

    // Apply Merchandise & Sublimation blueprint
    await user.click(screen.getByRole('button', { name: /Merch & Sublimation/i }));
    const nameInput = screen.getByLabelText(/Service Name/i) as HTMLInputElement;
    expect(nameInput.value).toBe('Merch & Sublimation');

    await user.clear(nameInput);
    await user.type(nameInput, 'Custom Mug Print');

    // Switch to Dynamic Options tab & insert a reusable preset group
    await user.click(screen.getByRole('button', { name: /Dynamic Options/i }));
    await user.click(screen.getByRole('button', { name: /Insert Preset/i }));
    expect(screen.getByDisplayValue('Paper Size')).toBeInTheDocument();

    // Switch to Tiers & Formula tab & verify preloaded bulk tiers
    await user.click(screen.getByRole('button', { name: /Tiers & Formula/i }));
    expect(screen.getByLabelText('Tier 1 minimum quantity')).toHaveValue(10);

    // Switch to Materials & Simulator tab & attach two inventory consumables
    await user.click(screen.getByRole('button', { name: /Materials & Simulator/i }));
    await user.click(screen.getByRole('button', { name: /Add Material/i }));
    await user.click(screen.getByRole('button', { name: /Add Material/i }));

    // Save service
    await user.click(screen.getByRole('button', { name: /Create Service/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    const savedPayload = onSave.mock.calls[0][0];
    expect(savedPayload.name).toBe('Custom Mug Print');
    expect(savedPayload.bulkTiers?.length).toBe(3);
    expect(savedPayload.attributeGroups?.length).toBe(2);
    expect(savedPayload.consumables?.length).toBe(2);
  });

  it('renders custom dynamic option groups and priceMultiplier badges in POS ServiceConfigurator', async () => {
    const dynamicService: PrintService = {
      id: 'srv-dyn-pos',
      sku: 'DYN-POS-01',
      name: 'Foil Brochure',
      categoryId: 'cat-print',
      description: 'Dynamic test service',
      iconName: 'BookOpen',
      pricingMethod: 'per_piece',
      basePrice: 50,
      unitLabel: 'pc',
      costEstimate: 15,
      requiresConfiguration: true,
      requiresProductionJob: false,
      allowCustomDimensions: false,
      allowPagesAndCopies: false,
      allowRushFee: false,
      rushFeePercent: 0,
      defaultDesignFee: 0,
      bulkTiers: [],
      attributeGroups: [
        {
          key: 'laminationType',
          label: 'Lamination Finish',
          defaultOptionId: 'std',
          options: [
            { id: 'std', label: 'Uncoated', priceDelta: 0, priceMultiplier: 1 },
            { id: 'velvet', label: 'Soft Velvet + Foil', priceDelta: 10, priceMultiplier: 1.5 },
          ],
        },
      ],
      consumables: [],
      isFavorite: false,
      isArchived: false,
      updatedAt: new Date().toISOString(),
    };

    const onConfirm = vi.fn();
    const { user } = renderWithProviders(
      <ServiceConfigurator
        open={true}
        service={dynamicService}
        onClose={vi.fn()}
        onConfirm={onConfirm}
        isMobileLayout={false}
      />,
    );

    expect(screen.getByText('Lamination Finish')).toBeInTheDocument();
    expect(screen.getByText('×1.5')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Soft Velvet \+ Foil/i }));
    // (50 + 10) * 1.5 = 90.00
    await user.click(screen.getByRole('button', { name: /Add to Order/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][1].selectedAttributes.laminationType).toBe('velvet');
  });
});
