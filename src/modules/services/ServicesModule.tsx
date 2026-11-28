import React, { useMemo, useState } from 'react';
import {
  Archive,
  Copy,
  Edit3,
  Plus,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react';
import { useApp } from '../../context/AppContext.tsx';
import { formatCurrency } from '../../shared/pricingEngine.ts';
import {
  SERVICE_BLUEPRINTS,
  instantiateServiceFromBlueprint,
} from '../../shared/serviceTemplates.ts';
import type { PrintService } from '../../shared/types.ts';
import {
  Button,
  Card,
  Input,
  Select,
  StatusIndicator,
} from '../../components/ui/Primitives.tsx';
import { DataTable } from '../../components/ui/DataTable.tsx';
import { ServiceIcon } from '../../components/ui/ServiceIcon.tsx';
import { ServiceEditorModal } from '../../components/services/ServiceEditorModal.tsx';

export const ServicesModule: React.FC = () => {
  const {
    settings,
    categories,
    services,
    inventory,
    createCategory,
    deleteCategory,
    saveService,
    duplicateService,
    deleteService,
    session,
    notify,
  } = useApp();

  const taxCurr = settings.taxAndCurrency;
  const canEdit = session?.user.role === 'admin' || session?.user.role === 'manager';

  const [tab, setTab] = useState<'services' | 'categories'>('services');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [showBlueprints, setShowBlueprints] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingService, setEditingService] = useState<PrintService | null>(null);
  const [initialDraft, setInitialDraft] = useState<Omit<PrintService, 'id' | 'updatedAt'> | null>(
    null,
  );
  const [cloningId, setCloningId] = useState<string | null>(null);

  const openNewEditor = () => {
    setEditingService(null);
    setInitialDraft(null);
    setEditorOpen(true);
  };

  const openBlueprintEditor = (blueprintId: string) => {
    const bp = SERVICE_BLUEPRINTS.find((b) => b.id === blueprintId);
    if (!bp) return;
    setEditingService(null);
    setInitialDraft(instantiateServiceFromBlueprint(bp, categories, services));
    setEditorOpen(true);
    setShowBlueprints(false);
  };

  const openEditEditor = (service: PrintService) => {
    setEditingService(service);
    setInitialDraft(null);
    setEditorOpen(true);
  };

  const handleCloneService = async (service: PrintService) => {
    setCloningId(service.id);
    try {
      const cloned = await duplicateService(service.id);
      setEditingService(cloned);
      setInitialDraft(null);
      setEditorOpen(true);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to clone service.', 'error');
    } finally {
      setCloningId(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return services
      .filter((s) => (showArchived ? true : !s.isArchived))
      .filter((s) => categoryFilter === 'all' || s.categoryId === categoryFilter)
      .filter(
        (s) =>
          !q ||
          s.name.toLowerCase().includes(q) ||
          s.sku.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.pricingMethod.replace(/_/g, ' ').toLowerCase().includes(q),
      );
  }, [services, showArchived, categoryFilter, search]);

  const describeServiceRules = (s: PrintService) => {
    const parts: string[] = [];
    if (s.attributeGroups.length > 0) {
      parts.push(`${s.attributeGroups.length} option group${s.attributeGroups.length > 1 ? 's' : ''}`);
    }
    if (s.bulkTiers.length > 0) {
      parts.push(`${s.bulkTiers.length} bulk tier${s.bulkTiers.length > 1 ? 's' : ''}`);
    }
    if (s.consumables.length > 0) {
      parts.push(`${s.consumables.length} material${s.consumables.length > 1 ? 's' : ''}`);
    }
    if (s.formulaExpression) {
      parts.push('formula');
    }
    return parts.length > 0 ? parts.join(' · ') : 'Standard flat rule';
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--pos-text)]">Printing Services & Pricing</h1>
          <p className="text-xs text-[var(--pos-text-muted)]">
            Build reusable blueprints, dynamic option groups, bulk tiers, formulas, and material bindings
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => setTab('services')}
              className={`px-3 py-1 text-xs font-medium rounded-md cursor-pointer ${
                tab === 'services'
                  ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs'
                  : 'text-[var(--pos-text-muted)]'
              }`}
            >
              Services ({services.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('categories')}
              className={`px-3 py-1 text-xs font-medium rounded-md cursor-pointer ${
                tab === 'categories'
                  ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs'
                  : 'text-[var(--pos-text-muted)]'
              }`}
            >
              Categories ({categories.length})
            </button>
          </div>
          {canEdit && tab === 'services' && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowBlueprints((prev) => !prev)}
              >
                <Sparkles className="w-4 h-4" />
                Blueprints
              </Button>
              <Button size="sm" onClick={openNewEditor}>
                <Plus className="w-4 h-4" />
                Add Service
              </Button>
            </>
          )}
        </div>
      </div>

      {tab === 'services' ? (
        <>
          {canEdit && showBlueprints && (
            <Card className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--pos-text)]">
                    Reusable Service Blueprints
                  </h2>
                  <p className="text-xs text-[var(--pos-text-muted)]">
                    Scaffold a pre-configured service with dynamic option groups, tiers, and pricing flags
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowBlueprints(false)}
                  className="text-xs text-[var(--pos-text-muted)] hover:text-[var(--pos-text)] cursor-pointer"
                >
                  Hide
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {SERVICE_BLUEPRINTS.map((bp) => (
                  <button
                    key={bp.id}
                    type="button"
                    onClick={() => openBlueprintEditor(bp.id)}
                    className="text-left p-3 rounded-lg border border-[var(--pos-border)] hover:border-[var(--pos-primary)] hover:bg-[var(--pos-primary)]/5 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-[var(--pos-text)]">
                        {bp.name}
                      </span>
                      <span className="text-[11px] font-mono-num text-[var(--pos-primary)] font-medium">
                        {formatCurrency(bp.basePrice, taxCurr)}/{bp.unitLabel}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--pos-text-muted)] mt-1 line-clamp-2">
                      {bp.tagline}
                    </p>
                  </button>
                ))}
              </div>
            </Card>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex-1 min-w-[220px]">
              <Input
                placeholder="Search service name, SKU, or pricing method..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="w-full sm:w-52">
              <Select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                options={[
                  { value: 'all', label: 'All Categories' },
                  ...categories.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-[var(--pos-text-muted)] cursor-pointer">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="h-4 w-4 accent-[var(--pos-primary)]"
              />
              Show archived services
            </label>
          </div>

          <DataTable
            rows={filtered}
            rowKey={(s) => s.id}
            columns={[
              {
                key: 'name',
                label: 'Service & Dynamic Rules',
                render: (s) => (
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-lg bg-[var(--pos-primary)]/10 text-[var(--pos-primary)] flex items-center justify-center shrink-0">
                      <ServiceIcon name={s.iconName} className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[var(--pos-text)] flex items-center gap-1.5">
                        <span className="truncate">{s.name}</span>
                        {s.isFavorite && <Star className="w-3 h-3 text-[#D97706] fill-current shrink-0" />}
                      </div>
                      <div className="text-[11px] text-[var(--pos-text-muted)] truncate">
                        {s.sku} · {categories.find((c) => c.id === s.categoryId)?.name || 'Uncategorized'} ·{' '}
                        {describeServiceRules(s)}
                      </div>
                    </div>
                  </div>
                ),
              },
              {
                key: 'method',
                label: 'Pricing Model',
                hideOnMobile: true,
                render: (s) => (
                  <span className="text-xs capitalize text-[var(--pos-text-muted)]">
                    {s.pricingMethod.replace(/_/g, ' ')}
                  </span>
                ),
              },
              {
                key: 'price',
                label: 'Base Rate / Margin',
                align: 'right',
                render: (s) => {
                  const marginPct =
                    s.basePrice > 0 ? ((s.basePrice - s.costEstimate) / s.basePrice) * 100 : 0;
                  return (
                    <div className="text-right">
                      <div className="font-mono-num font-semibold text-sm text-[var(--pos-text)]">
                        {formatCurrency(s.basePrice, taxCurr)} / {s.unitLabel}
                      </div>
                      <div className="text-[11px] font-mono-num text-[var(--pos-text-muted)]">
                        Cost {formatCurrency(s.costEstimate, taxCurr)} · {marginPct.toFixed(0)}% margin
                      </div>
                    </div>
                  );
                },
              },
              {
                key: 'status',
                label: 'Status',
                hideOnMobile: true,
                render: (s) => (
                  <StatusIndicator
                    tone={s.isArchived ? 'neutral' : 'success'}
                    label={s.isArchived ? 'Archived' : 'Active'}
                  />
                ),
              },
              {
                key: 'actions',
                label: 'Actions',
                align: 'right',
                render: (s) =>
                  canEdit ? (
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void saveService({ ...s, isFavorite: !s.isFavorite })}
                        className={`p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer ${
                          s.isFavorite ? 'text-[#D97706]' : 'text-[var(--pos-text-muted)]'
                        }`}
                        title={s.isFavorite ? 'Remove favorite' : 'Pin to favorites'}
                      >
                        <Star className={`w-4 h-4 ${s.isFavorite ? 'fill-current' : ''}`} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCloneService(s)}
                        disabled={cloningId === s.id}
                        className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-40"
                        title="Clone / Reuse service"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditEditor(s)}
                        className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        title="Edit"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveService({ ...s, isArchived: !s.isArchived })}
                        className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        title={s.isArchived ? 'Restore' : 'Archive'}
                      >
                        <Archive className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteService(s.id)}
                        className="p-1.5 rounded text-[#DC2626] hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-[var(--pos-text-muted)]">View only</span>
                  ),
              },
            ]}
          />
        </>
      ) : (
        <Card className="space-y-4">
          {canEdit && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newCategoryName.trim()) return;
                await createCategory(newCategoryName);
                setNewCategoryName('');
              }}
              className="flex gap-2"
            >
              <Input
                placeholder="New category name (e.g. Sublimation)"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
              />
              <Button type="submit">Add Category</Button>
            </form>
          )}
          <div className="divide-y divide-[var(--pos-border)]">
            {categories.map((c) => (
              <div key={c.id} className="py-2.5 flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-[var(--pos-text)]">{c.name}</span>
                  <span className="text-xs text-[var(--pos-text-muted)] ml-2">
                    · {services.filter((s) => s.categoryId === c.id).length} service(s)
                  </span>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => void deleteCategory(c.id)}
                    className="p-1.5 rounded text-[#DC2626] hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <ServiceEditorModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        editingService={editingService}
        initialDraft={initialDraft}
        categories={categories}
        services={services}
        inventory={inventory}
        taxCurrency={taxCurr}
        onSave={saveService}
      />
    </div>
  );
};
