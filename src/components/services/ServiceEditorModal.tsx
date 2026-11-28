import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Calculator,
  Copy,
  Layers,
  Package,
  Plus,
  RefreshCw,
  Sliders,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  calculateServicePrice,
  evaluateFormulaExpression,
  formatCurrency,
  getDefaultServiceSelection,
} from '../../shared/pricingEngine.ts';
import {
  ATTRIBUTE_GROUP_PRESETS,
  BULK_TIER_PRESETS,
  FORMULA_VARIABLES,
  PRICING_METHOD_OPTIONS,
  SERVICE_BLUEPRINTS,
  buildBulkTiersFromPreset,
  cloneAttributeGroup,
  createAttributeGroupFromPreset,
  generateUniqueServiceSku,
  instantiateServiceFromBlueprint,
  normalizeAndValidateServicePayload,
  slugifyAttributeKey,
} from '../../shared/serviceTemplates.ts';
import type {
  BulkTier,
  InventoryItem,
  MaterialConsumptionBinding,
  PricingMethod,
  PrintService,
  ServiceAttributeGroup,
  ServiceCategory,
  ServiceConfigSelection,
  TaxAndCurrencyConfig,
} from '../../shared/types.ts';
import { Button, Input, Select } from '../ui/Primitives.tsx';
import { Modal } from '../ui/Overlays.tsx';
import { AVAILABLE_SERVICE_ICONS } from '../ui/ServiceIcon.tsx';

type EditorTab = 'basics' | 'pricing' | 'options' | 'materials';

interface ServiceEditorModalProps {
  open: boolean;
  onClose: () => void;
  editingService: PrintService | null;
  initialDraft?: Omit<PrintService, 'id' | 'updatedAt'> | null;
  categories: ServiceCategory[];
  services: PrintService[];
  inventory: InventoryItem[];
  taxCurrency: TaxAndCurrencyConfig;
  onSave: (payload: Partial<PrintService> & { id?: string }) => Promise<PrintService>;
}

interface DraftState {
  name: string;
  sku: string;
  categoryId: string;
  description: string;
  iconName: string;
  pricingMethod: PricingMethod;
  basePrice: string;
  unitLabel: string;
  costEstimate: string;
  defaultDesignFee: string;
  rushFeePercent: string;
  formulaExpression: string;
  requiresConfiguration: boolean;
  requiresProductionJob: boolean;
  allowCustomDimensions: boolean;
  allowPagesAndCopies: boolean;
  allowRushFee: boolean;
  isFavorite: boolean;
  isArchived: boolean;
  bulkTiers: BulkTier[];
  attributeGroups: ServiceAttributeGroup[];
  consumables: MaterialConsumptionBinding[];
}

function buildEmptyDraft(
  categories: ServiceCategory[],
  services: PrintService[],
): DraftState {
  return {
    name: '',
    sku: generateUniqueServiceSku('SRV-NEW-01', services),
    categoryId: categories[0]?.id || '',
    description: '',
    iconName: 'Printer',
    pricingMethod: 'per_page',
    basePrice: '5',
    unitLabel: 'page',
    costEstimate: '1',
    defaultDesignFee: '0',
    rushFeePercent: '25',
    formulaExpression: '',
    requiresConfiguration: true,
    requiresProductionJob: false,
    allowCustomDimensions: false,
    allowPagesAndCopies: true,
    allowRushFee: true,
    isFavorite: false,
    isArchived: false,
    bulkTiers: [],
    attributeGroups: [],
    consumables: [],
  };
}

function draftFromServiceData(
  data: Omit<PrintService, 'id' | 'updatedAt'>,
): DraftState {
  return {
    name: data.name,
    sku: data.sku,
    categoryId: data.categoryId,
    description: data.description || '',
    iconName: data.iconName || 'Printer',
    pricingMethod: data.pricingMethod,
    basePrice: String(data.basePrice ?? 0),
    unitLabel: data.unitLabel || 'pc',
    costEstimate: String(data.costEstimate ?? 0),
    defaultDesignFee: String(data.defaultDesignFee ?? 0),
    rushFeePercent: String(data.rushFeePercent ?? 25),
    formulaExpression: data.formulaExpression || '',
    requiresConfiguration: data.requiresConfiguration,
    requiresProductionJob: data.requiresProductionJob,
    allowCustomDimensions: data.allowCustomDimensions,
    allowPagesAndCopies: data.allowPagesAndCopies,
    allowRushFee: data.allowRushFee,
    isFavorite: data.isFavorite,
    isArchived: data.isArchived,
    bulkTiers: (data.bulkTiers || []).map((t) => ({ ...t })),
    attributeGroups: (data.attributeGroups || []).map(cloneAttributeGroup),
    consumables: (data.consumables || []).map((c) => ({ ...c })),
  };
}

export const ServiceEditorModal: React.FC<ServiceEditorModalProps> = ({
  open,
  onClose,
  editingService,
  initialDraft,
  categories,
  services,
  inventory,
  taxCurrency,
  onSave,
}) => {
  const [activeTab, setActiveTab] = useState<EditorTab>('basics');
  const [draft, setDraft] = useState<DraftState>(() => buildEmptyDraft(categories, services));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reuse pickers
  const [selectedPresetId, setSelectedPresetId] = useState(ATTRIBUTE_GROUP_PRESETS[0]?.id || '');
  const [copySourceServiceId, setCopySourceServiceId] = useState('');
  const [selectedTierPresetId, setSelectedTierPresetId] = useState(BULK_TIER_PRESETS[0]?.id || '');

  // Simulator config
  const [simConfig, setSimConfig] = useState<ServiceConfigSelection>(() => ({
    quantity: 1,
    pages: 1,
    copies: 1,
    width: 3,
    height: 2,
    dimensionUnit: 'ft',
    selectedAttributes: {},
    isRush: false,
    designFee: 0,
    laborFee: 0,
    notes: '',
  }));

  useEffect(() => {
    if (!open) return;
    setError(null);
    setActiveTab('basics');
    if (editingService) {
      setDraft(draftFromServiceData(editingService));
      setSimConfig(getDefaultServiceSelection(editingService));
    } else if (initialDraft) {
      setDraft(draftFromServiceData(initialDraft));
      setSimConfig(
        getDefaultServiceSelection({
          id: 'draft',
          updatedAt: new Date().toISOString(),
          ...initialDraft,
        }),
      );
    } else {
      const empty = buildEmptyDraft(categories, services);
      setDraft(empty);
      setSimConfig({
        quantity: 1,
        pages: 1,
        copies: 1,
        width: 3,
        height: 2,
        dimensionUnit: 'ft',
        selectedAttributes: {},
        isRush: false,
        designFee: 0,
        laborFee: 0,
        notes: '',
      });
    }
    const firstWithAttrs = services.find((s) => s.id !== editingService?.id && s.attributeGroups.length > 0);
    setCopySourceServiceId(firstWithAttrs?.id || '');
  }, [open, editingService, initialDraft, categories, services]);

  const previewService = useMemo<PrintService>(
    () => ({
      id: editingService?.id || 'draft-preview',
      sku: draft.sku || 'DRAFT',
      name: draft.name || 'Untitled Service',
      categoryId: draft.categoryId || categories[0]?.id || '',
      description: draft.description,
      iconName: draft.iconName || 'Printer',
      pricingMethod: draft.pricingMethod,
      basePrice: Math.max(0, Number(draft.basePrice) || 0),
      unitLabel: draft.unitLabel || 'pc',
      costEstimate: Math.max(0, Number(draft.costEstimate) || 0),
      requiresConfiguration: draft.requiresConfiguration,
      requiresProductionJob: draft.requiresProductionJob,
      allowCustomDimensions: draft.allowCustomDimensions,
      allowPagesAndCopies: draft.allowPagesAndCopies,
      allowRushFee: draft.allowRushFee,
      rushFeePercent: Math.max(0, Number(draft.rushFeePercent) || 0),
      defaultDesignFee: Math.max(0, Number(draft.defaultDesignFee) || 0),
      bulkTiers: draft.bulkTiers,
      formulaExpression: draft.formulaExpression,
      attributeGroups: draft.attributeGroups,
      consumables: draft.consumables,
      isFavorite: draft.isFavorite,
      isArchived: draft.isArchived,
      updatedAt: new Date().toISOString(),
    }),
    [draft, editingService?.id, categories],
  );

  // Keep simulator selected attributes synced when groups/options change
  useEffect(() => {
    setSimConfig((prev) => {
      const nextAttrs: Record<string, string> = {};
      for (const group of previewService.attributeGroups) {
        const currentChoice = prev.selectedAttributes[group.key];
        const validChoice = group.options.some((o) => o.id === currentChoice);
        nextAttrs[group.key] = validChoice
          ? currentChoice
          : group.defaultOptionId || group.options[0]?.id || '';
      }
      return {
        ...prev,
        selectedAttributes: nextAttrs,
        designFee: Number(draft.defaultDesignFee) || 0,
      };
    });
  }, [previewService.attributeGroups, draft.defaultDesignFee]);

  const simCalc = useMemo(
    () => calculateServicePrice(previewService, simConfig, taxCurrency),
    [previewService, simConfig, taxCurrency],
  );

  const formulaCheck = useMemo(() => {
    if (draft.pricingMethod !== 'formula') return { valid: true, value: null as number | null };
    const expr = draft.formulaExpression.trim();
    if (!expr) return { valid: false, value: null as number | null };
    const result = evaluateFormulaExpression(expr, {
      base: Math.max(0, Number(draft.basePrice) || 0),
      qty: simConfig.quantity,
      pages: simConfig.pages,
      copies: simConfig.copies,
      areaSqFt: simCalc.areaSqFt,
      linearFt: simCalc.linearFt,
      linearMeters: simCalc.linearMeters,
      attrDelta: simCalc.attributesDelta,
      attrMult: 1,
      designFee: simConfig.designFee,
      laborFee: simConfig.laborFee,
    });
    return { valid: result !== null, value: result };
  }, [draft.pricingMethod, draft.formulaExpression, draft.basePrice, simConfig, simCalc]);

  const computedConsumablesCost = useMemo(() => {
    return draft.consumables.reduce((sum, binding) => {
      const inv = inventory.find((i) => i.id === binding.inventoryItemId);
      if (!inv) return sum;
      return sum + (Number(inv.unitCost) || 0) * (Number(binding.quantityPerUnit) || 0);
    }, 0);
  }, [draft.consumables, inventory]);

  const marginSummary = useMemo(() => {
    const base = Number(draft.basePrice) || 0;
    const cost = Number(draft.costEstimate) || 0;
    const profit = base - cost;
    const marginPct = base > 0 ? (profit / base) * 100 : 0;
    return { profit, marginPct };
  }, [draft.basePrice, draft.costEstimate]);

  const applyBlueprint = (blueprintId: string) => {
    const bp = SERVICE_BLUEPRINTS.find((b) => b.id === blueprintId);
    if (!bp) return;
    const instantiated = instantiateServiceFromBlueprint(bp, categories, services);
    setDraft(draftFromServiceData(instantiated));
    setError(null);
  };

  // Bulk tier handlers
  const addBulkTier = () => {
    const maxQty = draft.bulkTiers.reduce((m, t) => Math.max(m, t.minQty), 0);
    const nextQty = maxQty > 0 ? maxQty * 2 : 25;
    const base = Number(draft.basePrice) || 10;
    const nextPrice = Math.max(0, Number((base * 0.85).toFixed(2)));
    setDraft((prev) => ({
      ...prev,
      bulkTiers: [...prev.bulkTiers, { minQty: nextQty, unitPrice: nextPrice }],
    }));
  };

  const applyTierPreset = () => {
    const tiers = buildBulkTiersFromPreset(selectedTierPresetId, Number(draft.basePrice) || 10);
    if (tiers.length === 0) return;
    setDraft((prev) => ({ ...prev, bulkTiers: tiers }));
  };

  const copyTiersFromService = (serviceId: string) => {
    const src = services.find((s) => s.id === serviceId);
    if (!src) return;
    setDraft((prev) => ({
      ...prev,
      bulkTiers: src.bulkTiers.map((t) => ({ ...t })),
    }));
  };

  // Attribute group handlers
  const addCustomAttributeGroup = () => {
    const existingKeys = draft.attributeGroups.map((g) => g.key);
    const nextIndex = draft.attributeGroups.length + 1;
    const label = `Option Group ${nextIndex}`;
    const key = slugifyAttributeKey(label, existingKeys);
    const newGroup: ServiceAttributeGroup = {
      key,
      label,
      defaultOptionId: 'standard',
      options: [
        { id: 'standard', label: 'Standard', priceDelta: 0 },
        { id: 'premium', label: 'Premium', priceDelta: 10 },
      ],
    };
    setDraft((prev) => ({
      ...prev,
      attributeGroups: [...prev.attributeGroups, newGroup],
    }));
  };

  const insertPresetGroup = () => {
    const existingKeys = draft.attributeGroups.map((g) => g.key);
    const created = createAttributeGroupFromPreset(selectedPresetId, existingKeys);
    if (!created) return;
    setDraft((prev) => ({
      ...prev,
      attributeGroups: [...prev.attributeGroups, created],
    }));
  };

  const copyGroupsFromService = () => {
    const src = services.find((s) => s.id === copySourceServiceId);
    if (!src || src.attributeGroups.length === 0) return;
    setDraft((prev) => {
      const existingKeys = new Set(prev.attributeGroups.map((g) => g.key.toLowerCase()));
      const next = [...prev.attributeGroups];
      for (const g of src.attributeGroups) {
        const cloned = cloneAttributeGroup(g);
        if (existingKeys.has(cloned.key.toLowerCase())) {
          cloned.key = slugifyAttributeKey(cloned.label, next.map((x) => x.key));
        }
        existingKeys.add(cloned.key.toLowerCase());
        next.push(cloned);
      }
      return { ...prev, attributeGroups: next };
    });
  };

  const moveAttributeGroup = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= draft.attributeGroups.length) return;
    setDraft((prev) => {
      const next = [...prev.attributeGroups];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return { ...prev, attributeGroups: next };
    });
  };

  const addOptionToGroup = (groupIdx: number) => {
    setDraft((prev) => {
      const next = prev.attributeGroups.map((g, idx) => {
        if (idx !== groupIdx) return g;
        const optNum = g.options.length + 1;
        const id = slugifyAttributeKey(
          `opt_${optNum}`,
          g.options.map((o) => o.id),
        );
        return {
          ...g,
          options: [...g.options, { id, label: `Option ${optNum}`, priceDelta: 0 }],
        };
      });
      return { ...prev, attributeGroups: next };
    });
  };

  // Multi-consumable handlers
  const addConsumableBinding = () => {
    const used = new Set(draft.consumables.map((c) => c.inventoryItemId));
    const available = inventory.find((i) => !used.has(i.id)) || inventory[0];
    if (!available) return;
    setDraft((prev) => ({
      ...prev,
      consumables: [
        ...prev.consumables,
        { inventoryItemId: available.id, quantityPerUnit: 1 },
      ],
    }));
  };

  const submitDraft = async () => {
    setError(null);

    const candidate: Partial<PrintService> & { id?: string } = {
      ...(editingService ? { id: editingService.id } : {}),
      name: draft.name,
      sku: draft.sku,
      categoryId: draft.categoryId,
      description: draft.description,
      iconName: draft.iconName,
      pricingMethod: draft.pricingMethod,
      basePrice: Number(draft.basePrice),
      unitLabel: draft.unitLabel,
      costEstimate: Number(draft.costEstimate),
      defaultDesignFee: Number(draft.defaultDesignFee),
      rushFeePercent: Number(draft.rushFeePercent),
      formulaExpression: draft.formulaExpression,
      requiresConfiguration: draft.requiresConfiguration,
      requiresProductionJob: draft.requiresProductionJob,
      allowCustomDimensions: draft.allowCustomDimensions,
      allowPagesAndCopies: draft.allowPagesAndCopies,
      allowRushFee: draft.allowRushFee,
      isFavorite: draft.isFavorite,
      isArchived: draft.isArchived,
      bulkTiers: draft.bulkTiers,
      attributeGroups: draft.attributeGroups,
      consumables: draft.consumables,
    };

    const validation = normalizeAndValidateServicePayload(candidate);
    if (!validation.valid) {
      setError(validation.error);
      return;
    }

    setSaving(true);
    try {
      await onSave({
        ...(editingService ? { id: editingService.id } : {}),
        ...validation.service,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save service.');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitDraft();
  };

  const tabs: Array<{ id: EditorTab; label: string; count?: number; icon: React.ReactNode }> = [
    { id: 'basics', label: 'Basics & Rules', icon: <Sliders className="w-3.5 h-3.5" /> },
    {
      id: 'pricing',
      label: 'Tiers & Formula',
      count: draft.bulkTiers.length,
      icon: <Layers className="w-3.5 h-3.5" />,
    },
    {
      id: 'options',
      label: 'Dynamic Options',
      count: draft.attributeGroups.length,
      icon: <Sparkles className="w-3.5 h-3.5" />,
    },
    {
      id: 'materials',
      label: 'Materials & Simulator',
      count: draft.consumables.length,
      icon: <Calculator className="w-3.5 h-3.5" />,
    },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingService ? `Edit Service · ${editingService.name}` : 'Dynamic Service Builder'}
      subtitle="Configure pricing models, bulk tiers, dynamic option groups, material bindings, and live POS simulation"
      maxWidth="xl"
      footer={
        <div className="w-full flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-[var(--pos-text-muted)] font-mono-num">
            Simulated POS total:{' '}
            <span className="font-semibold text-[var(--pos-text)]">
              {formatCurrency(simCalc.lineSubtotal, taxCurrency)}
            </span>{' '}
            · {draft.attributeGroups.length} option group(s) · {draft.bulkTiers.length} tier(s) ·{' '}
            {draft.consumables.length} material(s)
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void submitDraft()} loading={saving}>
              {editingService ? 'Save Changes' : 'Create Service'}
            </Button>
          </div>
        </div>
      }
    >
      <form id="service-builder-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="px-3.5 py-2.5 rounded-lg border border-[#DC2626]/30 bg-[#DC2626]/10 text-xs text-[#DC2626] font-medium">
            {error}
          </div>
        )}

        {/* Section Navigation */}
        <div className="flex flex-wrap items-center gap-1 border-b border-[var(--pos-border)] pb-2.5">
          {tabs.map((t) => {
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  active
                    ? 'bg-[var(--pos-primary)] text-white'
                    : 'text-[var(--pos-text-muted)] hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-[var(--pos-text)]'
                }`}
              >
                {t.icon}
                <span>{t.label}</span>
                {typeof t.count === 'number' && t.count > 0 && (
                  <span
                    className={`font-mono-num text-[11px] px-1.5 py-0.2 rounded ${
                      active
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-200/70 dark:bg-slate-700 text-[var(--pos-text)]'
                    }`}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* TAB 1: BASICS */}
        {activeTab === 'basics' && (
          <div className="space-y-4">
            {!editingService && (
              <div className="pb-3 border-b border-[var(--pos-border)]">
                <div className="text-xs font-medium text-[var(--pos-text-muted)] mb-2">
                  Start from a Reusable Blueprint (Optional)
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {SERVICE_BLUEPRINTS.map((bp) => (
                    <button
                      key={bp.id}
                      type="button"
                      onClick={() => applyBlueprint(bp.id)}
                      className="text-left px-3 py-2 rounded-lg border border-[var(--pos-border)] hover:border-[var(--pos-primary)] hover:bg-[var(--pos-primary)]/5 transition-colors cursor-pointer"
                    >
                      <div className="text-xs font-semibold text-[var(--pos-text)]">{bp.name}</div>
                      <div className="text-[11px] text-[var(--pos-text-muted)] line-clamp-1 mt-0.5">
                        {bp.pricingMethod.replace(/_/g, ' ')} · {bp.attributeGroups.length} groups
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Service Name"
                placeholder="e.g. Custom Mug Sublimation"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                required
              />
              <div className="flex items-end gap-2">
                <Input
                  label="SKU / Barcode"
                  value={draft.sku}
                  onChange={(e) => setDraft({ ...draft, sku: e.target.value.toUpperCase() })}
                  required
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mb-0.5"
                  title="Generate unique SKU from name"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      sku: generateUniqueServiceSku(
                        prev.name || 'SRV-ITEM',
                        services,
                        editingService?.id,
                      ),
                    }))
                  }
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Auto
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Select
                label="Category"
                value={draft.categoryId}
                onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
              />
              <Select
                label="Pricing Method"
                value={draft.pricingMethod}
                onChange={(e) =>
                  setDraft({ ...draft, pricingMethod: e.target.value as PricingMethod })
                }
                options={PRICING_METHOD_OPTIONS}
              />
              <Select
                label="Icon"
                value={draft.iconName}
                onChange={(e) => setDraft({ ...draft, iconName: e.target.value })}
                options={AVAILABLE_SERVICE_ICONS.map((ic) => ({ value: ic, label: ic }))}
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Input
                label={`Base Price (${taxCurrency.currencySymbol})`}
                type="number"
                min="0"
                step="0.01"
                value={draft.basePrice}
                onChange={(e) => setDraft({ ...draft, basePrice: e.target.value })}
                required
              />
              <Input
                label="Unit Label"
                placeholder="page, sq ft, pc"
                value={draft.unitLabel}
                onChange={(e) => setDraft({ ...draft, unitLabel: e.target.value })}
                required
              />
              <Input
                label={`Estimated Cost (${taxCurrency.currencySymbol})`}
                hint={`Margin: ${marginSummary.marginPct.toFixed(0)}%`}
                type="number"
                min="0"
                step="0.01"
                value={draft.costEstimate}
                onChange={(e) => setDraft({ ...draft, costEstimate: e.target.value })}
              />
              <Input
                label={`Default Design Fee (${taxCurrency.currencySymbol})`}
                type="number"
                min="0"
                step="1"
                value={draft.defaultDesignFee}
                onChange={(e) => setDraft({ ...draft, defaultDesignFee: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <Input
                  label="Description"
                  placeholder="Short description shown in catalog & job specifications"
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
              {draft.allowRushFee && (
                <Input
                  label="Rush Surcharge (%)"
                  type="number"
                  min="0"
                  max="500"
                  step="1"
                  value={draft.rushFeePercent}
                  onChange={(e) => setDraft({ ...draft, rushFeePercent: e.target.value })}
                />
              )}
            </div>

            <div className="pt-2 border-t border-[var(--pos-border)]">
              <div className="text-xs font-medium text-[var(--pos-text-muted)] mb-2">
                POS & Production Behavior
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                {[
                  {
                    label: 'Show Configurator on Tap',
                    checked: draft.requiresConfiguration,
                    key: 'requiresConfiguration' as const,
                  },
                  {
                    label: 'Create Production Job',
                    checked: draft.requiresProductionJob,
                    key: 'requiresProductionJob' as const,
                  },
                  {
                    label: 'Custom Width × Height',
                    checked: draft.allowCustomDimensions,
                    key: 'allowCustomDimensions' as const,
                  },
                  {
                    label: 'Pages & Copies Controls',
                    checked: draft.allowPagesAndCopies,
                    key: 'allowPagesAndCopies' as const,
                  },
                  {
                    label: 'Allow Rush Fee',
                    checked: draft.allowRushFee,
                    key: 'allowRushFee' as const,
                  },
                  {
                    label: 'Pin to Favorites',
                    checked: draft.isFavorite,
                    key: 'isFavorite' as const,
                  },
                ].map((flag) => (
                  <label
                    key={flag.key}
                    className="flex items-center gap-2 p-2.5 rounded-lg border border-[var(--pos-border)] cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <input
                      type="checkbox"
                      checked={flag.checked}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, [flag.key]: e.target.checked }))
                      }
                      className="h-4 w-4 accent-[var(--pos-primary)]"
                    />
                    <span className="text-[var(--pos-text)]">{flag.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: BULK TIERS & FORMULA */}
        {activeTab === 'pricing' && (
          <div className="space-y-5">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--pos-text)]">
                    Volume / Bulk Pricing Tiers
                  </h3>
                  <p className="text-xs text-[var(--pos-text-muted)]">
                    Automatically overrides Base Price once effective quantity reaches the threshold.
                  </p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={addBulkTier}>
                  <Plus className="w-3.5 h-3.5" />
                  Add Tier
                </Button>
              </div>

              <div className="flex flex-wrap items-end gap-2 pb-3 border-b border-[var(--pos-border)]">
                <div className="flex-1 min-w-[200px]">
                  <Select
                    label="Apply Tier Preset (scaled from Base Price)"
                    value={selectedTierPresetId}
                    onChange={(e) => setSelectedTierPresetId(e.target.value)}
                    options={BULK_TIER_PRESETS.map((p) => ({ value: p.id, label: p.name }))}
                  />
                </div>
                <Button type="button" size="sm" variant="secondary" onClick={applyTierPreset}>
                  Apply Preset
                </Button>
                {services.some((s) => s.id !== editingService?.id && s.bulkTiers.length > 0) && (
                  <div className="flex items-end gap-2">
                    <Select
                      label="Or Copy Tiers From"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) copyTiersFromService(e.target.value);
                      }}
                      options={[
                        { value: '', label: 'Select service...' },
                        ...services
                          .filter((s) => s.id !== editingService?.id && s.bulkTiers.length > 0)
                          .map((s) => ({
                            value: s.id,
                            label: `${s.name} (${s.bulkTiers.length} tiers)`,
                          })),
                      ]}
                    />
                  </div>
                )}
              </div>

              {draft.bulkTiers.length === 0 ? (
                <div className="py-6 text-center text-xs text-[var(--pos-text-muted)] border border-dashed border-[var(--pos-border)] rounded-lg">
                  No volume tiers configured. Orders will use standard Base Price (
                  <span className="font-mono-num">
                    {formatCurrency(Number(draft.basePrice) || 0, taxCurrency)}
                  </span>
                  ).
                </div>
              ) : (
                <div className="divide-y divide-[var(--pos-border)] border border-[var(--pos-border)] rounded-lg overflow-hidden">
                  <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">
                    <div className="col-span-5">Min Quantity ({draft.unitLabel || 'unit'})</div>
                    <div className="col-span-5">Tier Unit Price ({taxCurrency.currencySymbol})</div>
                    <div className="col-span-2 text-right">Remove</div>
                  </div>
                  {draft.bulkTiers.map((tier, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 px-3 py-2 items-center">
                      <div className="col-span-5">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          aria-label={`Tier ${idx + 1} minimum quantity`}
                          value={tier.minQty}
                          onChange={(e) => {
                            const val = Math.max(1, parseInt(e.target.value, 10) || 1);
                            setDraft((prev) => ({
                              ...prev,
                              bulkTiers: prev.bulkTiers.map((t, i) =>
                                i === idx ? { ...t, minQty: val } : t,
                              ),
                            }));
                          }}
                          className="w-full min-h-[34px] px-2.5 text-sm font-mono-num bg-[var(--pos-surface)] border border-[var(--pos-border)] rounded-md text-[var(--pos-text)]"
                        />
                      </div>
                      <div className="col-span-5">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          aria-label={`Tier ${idx + 1} unit price`}
                          value={tier.unitPrice}
                          onChange={(e) => {
                            const val = Math.max(0, Number(e.target.value) || 0);
                            setDraft((prev) => ({
                              ...prev,
                              bulkTiers: prev.bulkTiers.map((t, i) =>
                                i === idx ? { ...t, unitPrice: val } : t,
                              ),
                            }));
                          }}
                          className="w-full min-h-[34px] px-2.5 text-sm font-mono-num bg-[var(--pos-surface)] border border-[var(--pos-border)] rounded-md text-[var(--pos-text)]"
                        />
                      </div>
                      <div className="col-span-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            setDraft((prev) => ({
                              ...prev,
                              bulkTiers: prev.bulkTiers.filter((_, i) => i !== idx),
                            }))
                          }
                          className="p-1.5 rounded text-[#DC2626] hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          title="Remove tier"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Formula Builder */}
            <div className="pt-4 border-t border-[var(--pos-border)] space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--pos-text)]">
                    Formula Expression Engine
                  </h3>
                  <p className="text-xs text-[var(--pos-text-muted)]">
                    {draft.pricingMethod === 'formula'
                      ? 'Active: computes base subtotal dynamically from variables below.'
                      : 'Switch Pricing Method to "Formula-Based Pricing" in Basics to activate custom formulas.'}
                  </p>
                </div>
                {draft.pricingMethod === 'formula' && (
                  <span
                    className={`text-xs font-mono-num font-medium ${
                      formulaCheck.valid ? 'text-[#16A34A]' : 'text-[#DC2626]'
                    }`}
                  >
                    {formulaCheck.valid && formulaCheck.value !== null
                      ? `Preview = ${formatCurrency(formulaCheck.value, taxCurrency)}`
                      : 'Invalid syntax'}
                  </span>
                )}
              </div>

              <Input
                label="Custom Pricing Formula"
                placeholder="e.g. ((base + attrDelta) * attrMult) * areaSqFt * qty"
                value={draft.formulaExpression}
                onChange={(e) => setDraft({ ...draft, formulaExpression: e.target.value })}
              />

              <div className="flex flex-wrap gap-1.5">
                {FORMULA_VARIABLES.map((v) => (
                  <button
                    key={v.name}
                    type="button"
                    title={v.description}
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        formulaExpression: prev.formulaExpression
                          ? `${prev.formulaExpression} ${v.name}`
                          : v.name,
                      }))
                    }
                    className="px-2 py-1 text-[11px] font-mono-num rounded-md border border-[var(--pos-border)] bg-slate-50 dark:bg-slate-800/70 text-[var(--pos-text)] hover:border-[var(--pos-primary)] cursor-pointer"
                  >
                    +{v.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: DYNAMIC OPTION GROUPS */}
        {activeTab === 'options' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-2 pb-3 border-b border-[var(--pos-border)]">
              <div className="flex-1 min-w-[200px]">
                <Select
                  label="Insert Reusable Option Group Preset"
                  value={selectedPresetId}
                  onChange={(e) => setSelectedPresetId(e.target.value)}
                  options={ATTRIBUTE_GROUP_PRESETS.map((p) => ({
                    value: p.id,
                    label: p.name,
                  }))}
                />
              </div>
              <Button type="button" size="sm" variant="secondary" onClick={insertPresetGroup}>
                <Plus className="w-3.5 h-3.5" />
                Insert Preset
              </Button>

              {services.some((s) => s.id !== editingService?.id && s.attributeGroups.length > 0) && (
                <>
                  <div className="min-w-[180px]">
                    <Select
                      label="Reuse From Service"
                      value={copySourceServiceId}
                      onChange={(e) => setCopySourceServiceId(e.target.value)}
                      options={services
                        .filter((s) => s.id !== editingService?.id && s.attributeGroups.length > 0)
                        .map((s) => ({
                          value: s.id,
                          label: `${s.name} (${s.attributeGroups.length})`,
                        }))}
                    />
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={copyGroupsFromService}>
                    <Copy className="w-3.5 h-3.5" />
                    Import
                  </Button>
                </>
              )}

              <Button type="button" size="sm" onClick={addCustomAttributeGroup}>
                <Plus className="w-3.5 h-3.5" />
                Add Custom Group
              </Button>
            </div>

            {draft.attributeGroups.length === 0 ? (
              <div className="py-8 text-center text-xs text-[var(--pos-text-muted)] border border-dashed border-[var(--pos-border)] rounded-lg">
                No dynamic option groups yet. Insert a reusable preset above or create a custom option group (e.g. Paper Size, Coating, Binding Style).
              </div>
            ) : (
              <div className="divide-y divide-[var(--pos-border)]">
                {draft.attributeGroups.map((group, gIdx) => (
                  <div key={`${group.key}-${gIdx}`} className="py-4 first:pt-1 last:pb-1 space-y-3">
                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 flex-1 min-w-[260px]">
                        <Input
                          label="Group Label"
                          value={group.label}
                          onChange={(e) => {
                            const nextLabel = e.target.value;
                            setDraft((prev) => ({
                              ...prev,
                              attributeGroups: prev.attributeGroups.map((item, i) =>
                                i === gIdx ? { ...item, label: nextLabel } : item,
                              ),
                            }));
                          }}
                        />
                        <Input
                          label="Attribute Key"
                          value={group.key}
                          onChange={(e) => {
                            const nextKey = e.target.value.replace(/[^a-zA-Z0-9_]/g, '_');
                            setDraft((prev) => ({
                              ...prev,
                              attributeGroups: prev.attributeGroups.map((item, i) =>
                                i === gIdx ? { ...item, key: nextKey } : item,
                              ),
                            }));
                          }}
                        />
                      </div>

                      <div className="flex items-center gap-1 pb-0.5">
                        <button
                          type="button"
                          onClick={() => moveAttributeGroup(gIdx, -1)}
                          disabled={gIdx === 0}
                          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                          title="Move group up"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveAttributeGroup(gIdx, 1)}
                          disabled={gIdx === draft.attributeGroups.length - 1}
                          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                          title="Move group down"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDraft((prev) => ({
                              ...prev,
                              attributeGroups: prev.attributeGroups.filter((_, i) => i !== gIdx),
                            }))
                          }
                          className="p-1.5 rounded text-[#DC2626] hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          title="Delete option group"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="grid grid-cols-12 gap-2 text-[11px] font-medium text-[var(--pos-text-muted)] px-1">
                        <div className="col-span-1 text-center">Def</div>
                        <div className="col-span-5">Option Label</div>
                        <div className="col-span-3">Delta ({taxCurrency.currencySymbol})</div>
                        <div className="col-span-2">Mult (×)</div>
                        <div className="col-span-1 text-right">Del</div>
                      </div>
                      {group.options.map((opt, oIdx) => (
                        <div key={`${opt.id}-${oIdx}`} className="grid grid-cols-12 gap-2 items-center">
                          <div className="col-span-1 flex justify-center">
                            <input
                              type="radio"
                              name={`default-opt-${gIdx}`}
                              checked={group.defaultOptionId === opt.id}
                              onChange={() =>
                                setDraft((prev) => ({
                                  ...prev,
                                  attributeGroups: prev.attributeGroups.map((item, i) =>
                                    i === gIdx ? { ...item, defaultOptionId: opt.id } : item,
                                  ),
                                }))
                              }
                              aria-label={`Set ${opt.label} as default`}
                              className="h-4 w-4 accent-[var(--pos-primary)] cursor-pointer"
                            />
                          </div>
                          <div className="col-span-5">
                            <input
                              type="text"
                              value={opt.label}
                              placeholder="Option name"
                              onChange={(e) => {
                                const val = e.target.value;
                                setDraft((prev) => ({
                                  ...prev,
                                  attributeGroups: prev.attributeGroups.map((item, i) =>
                                    i !== gIdx
                                      ? item
                                      : {
                                          ...item,
                                          options: item.options.map((o, j) =>
                                            j === oIdx ? { ...o, label: val } : o,
                                          ),
                                        },
                                  ),
                                }));
                              }}
                              className="w-full min-h-[34px] px-2.5 text-xs bg-[var(--pos-surface)] border border-[var(--pos-border)] rounded-md text-[var(--pos-text)]"
                            />
                          </div>
                          <div className="col-span-3">
                            <input
                              type="number"
                              step="0.01"
                              value={opt.priceDelta}
                              onChange={(e) => {
                                const val = Number(e.target.value) || 0;
                                setDraft((prev) => ({
                                  ...prev,
                                  attributeGroups: prev.attributeGroups.map((item, i) =>
                                    i !== gIdx
                                      ? item
                                      : {
                                          ...item,
                                          options: item.options.map((o, j) =>
                                            j === oIdx ? { ...o, priceDelta: val } : o,
                                          ),
                                        },
                                  ),
                                }));
                              }}
                              className="w-full min-h-[34px] px-2.5 text-xs font-mono-num bg-[var(--pos-surface)] border border-[var(--pos-border)] rounded-md text-[var(--pos-text)]"
                            />
                          </div>
                          <div className="col-span-2">
                            <input
                              type="number"
                              step="0.05"
                              min="0.1"
                              placeholder="1.0"
                              value={opt.priceMultiplier ?? ''}
                              onChange={(e) => {
                                const raw = e.target.value;
                                const val = raw === '' ? undefined : Number(raw);
                                setDraft((prev) => ({
                                  ...prev,
                                  attributeGroups: prev.attributeGroups.map((item, i) =>
                                    i !== gIdx
                                      ? item
                                      : {
                                          ...item,
                                          options: item.options.map((o, j) =>
                                            j === oIdx ? { ...o, priceMultiplier: val } : o,
                                          ),
                                        },
                                  ),
                                }));
                              }}
                              className="w-full min-h-[34px] px-2.5 text-xs font-mono-num bg-[var(--pos-surface)] border border-[var(--pos-border)] rounded-md text-[var(--pos-text)]"
                            />
                          </div>
                          <div className="col-span-1 flex justify-end">
                            <button
                              type="button"
                              disabled={group.options.length <= 1}
                              onClick={() =>
                                setDraft((prev) => ({
                                  ...prev,
                                  attributeGroups: prev.attributeGroups.map((item, i) => {
                                    if (i !== gIdx) return item;
                                    const filtered = item.options.filter((_, j) => j !== oIdx);
                                    const nextDef = filtered.some(
                                      (o) => o.id === item.defaultOptionId,
                                    )
                                      ? item.defaultOptionId
                                      : filtered[0]?.id || '';
                                    return {
                                      ...item,
                                      defaultOptionId: nextDef,
                                      options: filtered,
                                    };
                                  }),
                                }))
                              }
                              className="p-1.5 rounded text-[#DC2626] hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 cursor-pointer"
                              title="Remove option"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}

                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => addOptionToGroup(gIdx)}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add Option
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: MATERIALS & LIVE POS SIMULATOR */}
        {activeTab === 'materials' && (
          <div className="space-y-5">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--pos-text)] flex items-center gap-1.5">
                    <Package className="w-4 h-4 text-[var(--pos-primary)]" />
                    <span>Inventory Material Bindings</span>
                  </h3>
                  <p className="text-xs text-[var(--pos-text-muted)]">
                    Deducts multiple stock consumables automatically per billed unit on checkout.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {draft.consumables.length > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          costEstimate: computedConsumablesCost.toFixed(2),
                        }))
                      }
                    >
                      Sync Cost ({formatCurrency(computedConsumablesCost, taxCurrency)})
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={addConsumableBinding}
                    disabled={inventory.length === 0}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Material
                  </Button>
                </div>
              </div>

              {draft.consumables.length === 0 ? (
                <div className="py-5 text-center text-xs text-[var(--pos-text-muted)] border border-dashed border-[var(--pos-border)] rounded-lg">
                  No inventory materials linked to this service.
                </div>
              ) : (
                <div className="divide-y divide-[var(--pos-border)] border border-[var(--pos-border)] rounded-lg">
                  {draft.consumables.map((binding, idx) => {
                    const item = inventory.find((i) => i.id === binding.inventoryItemId);
                    const rowCost = (Number(item?.unitCost) || 0) * (Number(binding.quantityPerUnit) || 0);
                    return (
                      <div key={idx} className="grid grid-cols-12 gap-2.5 p-2.5 items-center">
                        <div className="col-span-12 sm:col-span-6">
                          <Select
                            value={binding.inventoryItemId}
                            onChange={(e) => {
                              const nextId = e.target.value;
                              setDraft((prev) => ({
                                ...prev,
                                consumables: prev.consumables.map((c, i) =>
                                  i === idx ? { ...c, inventoryItemId: nextId } : c,
                                ),
                              }));
                            }}
                            options={inventory.map((i) => ({
                              value: i.id,
                              label: `${i.name} (${i.quantityOnHand} ${i.unit} on hand)`,
                            }))}
                          />
                        </div>
                        <div className="col-span-5 sm:col-span-3">
                          <input
                            type="number"
                            min="0.01"
                            step="0.05"
                            aria-label={`Consumable ${idx + 1} quantity per unit`}
                            value={binding.quantityPerUnit}
                            onChange={(e) => {
                              const qty = Math.max(0.01, Number(e.target.value) || 0.01);
                              setDraft((prev) => ({
                                ...prev,
                                consumables: prev.consumables.map((c, i) =>
                                  i === idx ? { ...c, quantityPerUnit: qty } : c,
                                ),
                              }));
                            }}
                            className="w-full min-h-[38px] px-2.5 text-sm font-mono-num bg-[var(--pos-surface)] border border-[var(--pos-border)] rounded-md text-[var(--pos-text)]"
                          />
                        </div>
                        <div className="col-span-5 sm:col-span-2 text-right font-mono-num text-xs text-[var(--pos-text-muted)]">
                          {formatCurrency(rowCost, taxCurrency)}/{draft.unitLabel || 'u'}
                        </div>
                        <div className="col-span-2 sm:col-span-1 flex justify-end">
                          <button
                            type="button"
                            onClick={() =>
                              setDraft((prev) => ({
                                ...prev,
                                consumables: prev.consumables.filter((_, i) => i !== idx),
                              }))
                            }
                            className="p-1.5 rounded text-[#DC2626] hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            title="Remove material binding"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Live POS Pricing Simulator */}
            <div className="pt-4 border-t border-[var(--pos-border)] space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--pos-text)]">
                  Live POS Pricing Simulator
                </h3>
                <p className="text-xs text-[var(--pos-text-muted)]">
                  Test how cashiers will configure and price this service before saving.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {draft.allowPagesAndCopies ? (
                  <>
                    <Input
                      label="Test Pages"
                      type="number"
                      min="1"
                      value={simConfig.pages}
                      onChange={(e) =>
                        setSimConfig((p) => ({
                          ...p,
                          pages: Math.max(1, parseInt(e.target.value, 10) || 1),
                        }))
                      }
                    />
                    <Input
                      label="Test Copies"
                      type="number"
                      min="1"
                      value={simConfig.copies}
                      onChange={(e) =>
                        setSimConfig((p) => ({
                          ...p,
                          copies: Math.max(1, parseInt(e.target.value, 10) || 1),
                        }))
                      }
                    />
                  </>
                ) : (
                  <Input
                    label="Test Quantity"
                    type="number"
                    min="1"
                    value={simConfig.quantity}
                    onChange={(e) =>
                      setSimConfig((p) => ({
                        ...p,
                        quantity: Math.max(1, parseInt(e.target.value, 10) || 1),
                      }))
                    }
                  />
                )}

                {draft.allowCustomDimensions && (
                  <>
                    <Input
                      label="Width"
                      type="number"
                      min="0.1"
                      step="0.5"
                      value={simConfig.width}
                      onChange={(e) =>
                        setSimConfig((p) => ({
                          ...p,
                          width: Math.max(0.1, Number(e.target.value) || 0.1),
                        }))
                      }
                    />
                    <Input
                      label="Height"
                      type="number"
                      min="0.1"
                      step="0.5"
                      value={simConfig.height}
                      onChange={(e) =>
                        setSimConfig((p) => ({
                          ...p,
                          height: Math.max(0.1, Number(e.target.value) || 0.1),
                        }))
                      }
                    />
                  </>
                )}

                {draft.attributeGroups.map((g) => (
                  <Select
                    key={g.key}
                    label={g.label}
                    value={simConfig.selectedAttributes[g.key] || g.defaultOptionId}
                    onChange={(e) =>
                      setSimConfig((p) => ({
                        ...p,
                        selectedAttributes: {
                          ...p.selectedAttributes,
                          [g.key]: e.target.value,
                        },
                      }))
                    }
                    options={g.options.map((o) => ({ value: o.id, label: o.label }))}
                  />
                ))}
              </div>

              {draft.allowRushFee && (
                <label className="inline-flex items-center gap-2 text-xs text-[var(--pos-text)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={simConfig.isRush}
                    onChange={(e) =>
                      setSimConfig((p) => ({ ...p, isRush: e.target.checked }))
                    }
                    className="h-4 w-4 accent-[var(--pos-primary)]"
                  />
                  <span>Simulate Rush Priority (+{draft.rushFeePercent || 25}%)</span>
                </label>
              )}

              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-[var(--pos-border)] grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <div className="text-[var(--pos-text-muted)]">Effective Qty</div>
                  <div className="font-mono-num font-semibold text-sm text-[var(--pos-text)] mt-0.5">
                    {simCalc.effectiveQuantity} {draft.unitLabel || 'pc'}
                  </div>
                </div>
                <div>
                  <div className="text-[var(--pos-text-muted)]">Computed Unit Rate</div>
                  <div className="font-mono-num font-semibold text-sm text-[var(--pos-text)] mt-0.5">
                    {formatCurrency(simCalc.unitPrice, taxCurrency)}
                  </div>
                </div>
                <div>
                  <div className="text-[var(--pos-text-muted)]">Est. Cost / Profit</div>
                  <div className="font-mono-num font-semibold text-sm text-[var(--pos-text)] mt-0.5">
                    {formatCurrency(simCalc.estimatedCost, taxCurrency)} /{' '}
                    <span className="text-[#16A34A]">
                      {formatCurrency(simCalc.lineSubtotal - simCalc.estimatedCost, taxCurrency)}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-[var(--pos-text-muted)]">Simulated Total</div>
                  <div className="font-mono-num font-bold text-base text-[var(--pos-primary)] mt-0.5">
                    {formatCurrency(simCalc.lineSubtotal, taxCurrency)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
};
