import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  Briefcase,
  ClipboardList,
  Clock,
  Home,
  LayoutDashboard,
  Lock,
  Maximize2,
  Minimize2,
  Monitor,
  Moon,
  MoreHorizontal,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  RefreshCw,
  Settings,
  ShoppingCart,
  Smartphone,
  Sun,
  Tablet,
  Tag,
  Users,
  WifiOff,
} from 'lucide-react';
import { useApp } from '../../context/AppContext.tsx';
import type { ModuleId, PlatformPreviewMode } from '../../shared/types.ts';
import { PWAInstallButton } from '../ui/PWAInstallButton.tsx';
import { BottomSheet } from '../ui/Overlays.tsx';
import { ErrorState, LoadingState } from '../ui/Overlays.tsx';
import { DashboardModule } from '../../modules/dashboard/DashboardModule.tsx';
import { PosModule } from '../../modules/pos/PosModule.tsx';
import { PrintJobsModule } from '../../modules/jobs/PrintJobsModule.tsx';
import { ServicesModule } from '../../modules/services/ServicesModule.tsx';
import { InventoryModule } from '../../modules/inventory/InventoryModule.tsx';
import { CustomersModule } from '../../modules/customers/CustomersModule.tsx';
import { ExpensesReportsModule } from '../../modules/finance/ExpensesReportsModule.tsx';
import { ShiftsModule } from '../../modules/shifts/ShiftsModule.tsx';
import { DevicesModule } from '../../modules/devices/DevicesModule.tsx';
import { SettingsModule } from '../../modules/settings/SettingsModule.tsx';

const MODULE_META: Record<ModuleId, { label: string; icon: React.FC<{ className?: string }> }> = {
  dashboard: { label: 'Dashboard', icon: LayoutDashboard },
  pos: { label: 'POS', icon: ShoppingCart },
  jobs: { label: 'Print Jobs', icon: ClipboardList },
  services: { label: 'Services', icon: Tag },
  inventory: { label: 'Inventory', icon: Package },
  customers: { label: 'Customers', icon: Users },
  finance: { label: 'Reports', icon: BarChart3 },
  shifts: { label: 'Shifts', icon: Clock },
  devices: { label: 'Devices', icon: Printer },
  settings: { label: 'Settings', icon: Settings },
};

export const AppShell: React.FC = () => {
  const {
    session,
    settings,
    activeModule,
    setActiveModule,
    platformPreview,
    setPlatformPreview,
    fullScreenCashier,
    setFullScreenCashier,
    setIsLocked,
    isOnline,
    isSyncing,
    pendingSyncCount,
    syncNow,
    loadingData,
    dataError,
    categories,
    services,
    refreshBootstrap,
    setThemeMode,
    toasts,
    dismissToast,
  } = useApp();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1280,
  );

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const layoutTier: 'desktop' | 'tablet' | 'mobile' =
    platformPreview === 'mobile'
      ? 'mobile'
      : platformPreview === 'tablet'
        ? 'tablet'
        : platformPreview === 'windows' || platformPreview === 'web'
          ? 'desktop'
          : windowWidth < 768
            ? 'mobile'
            : windowWidth < 1024
              ? 'tablet'
              : 'desktop';

  const visibleModules = settings.moduleOrder.filter(
    (m) => !settings.hiddenModules.includes(m),
  );

  const isDark =
    settings.themeMode === 'dark' ||
    (settings.themeMode === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  const toggleQuickTheme = () => {
    setThemeMode(isDark ? 'light' : 'dark');
  };

  const renderModule = () => {
    if (loadingData && categories.length === 0 && services.length === 0) {
      return <LoadingState rows={6} />;
    }
    if (dataError) {
      return <ErrorState message={dataError} onRetry={() => void refreshBootstrap()} />;
    }
    switch (activeModule) {
      case 'dashboard':
        return <DashboardModule />;
      case 'pos':
        return <PosModule layoutTier={layoutTier} />;
      case 'jobs':
        return <PrintJobsModule />;
      case 'services':
        return <ServicesModule />;
      case 'inventory':
        return <InventoryModule />;
      case 'customers':
        return <CustomersModule />;
      case 'finance':
        return <ExpensesReportsModule />;
      case 'shifts':
        return <ShiftsModule />;
      case 'devices':
        return <DevicesModule />;
      case 'settings':
        return <SettingsModule />;
      default:
        return <PosModule layoutTier={layoutTier} />;
    }
  };

  const previewFrameStyle: React.CSSProperties =
    platformPreview === 'mobile'
      ? { maxWidth: '412px', margin: '0 auto', borderLeft: '1px solid var(--pos-border)', borderRight: '1px solid var(--pos-border)' }
      : platformPreview === 'tablet'
        ? { maxWidth: '900px', margin: '0 auto', borderLeft: '1px solid var(--pos-border)', borderRight: '1px solid var(--pos-border)' }
        : {};

  const showSidebar = !fullScreenCashier && layoutTier !== 'mobile';
  const railOnly = layoutTier === 'tablet' || sidebarCollapsed;

  return (
    <div
      style={previewFrameStyle}
      className="min-h-dvh h-dvh flex bg-[var(--pos-bg)] text-[var(--pos-text)] overflow-hidden relative"
    >
      {/* Desktop / Tablet Deep-Marine Navigation Sidebar */}
      {showSidebar && (
        <aside
          style={{
            backgroundColor: settings.tokens.navBackground,
            width: railOnly ? '68px' : `${settings.tokens.sidebarWidthPx}px`,
          }}
          className="shrink-0 text-white flex flex-col justify-between transition-all duration-150 select-none"
        >
          <div>
            {/* Brand Zone */}
            <div className="h-14 px-3.5 flex items-center justify-between gap-2 border-b border-white/10">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  style={{ backgroundColor: settings.tokens.primary }}
                  className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0"
                >
                  {settings.branding.logoDataUrl ? (
                    <img
                      src={settings.branding.logoDataUrl}
                      alt={settings.branding.appName}
                      className="h-6 w-6 object-contain rounded"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <Printer className="w-5 h-5 text-white" />
                  )}
                </div>
                {!railOnly && (
                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate">{settings.branding.appName}</div>
                    <div className="text-[11px] text-teal-200/80 truncate">
                      {settings.branding.businessName}
                    </div>
                  </div>
                )}
              </div>
              {layoutTier === 'desktop' && !railOnly && (
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(true)}
                  className="p-1.5 rounded-md text-slate-300 hover:bg-white/10 cursor-pointer"
                  title="Collapse sidebar"
                >
                  <PanelLeftClose className="w-4 h-4" />
                </button>
              )}
            </div>

            {layoutTier === 'desktop' && railOnly && (
              <div className="flex justify-center py-2 border-b border-white/10">
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(false)}
                  className="p-2 rounded-md text-slate-300 hover:bg-white/10 cursor-pointer"
                  title="Expand sidebar"
                >
                  <PanelLeftOpen className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Nav Items */}
            <nav className="p-2 space-y-1 overflow-y-auto max-h-[calc(100dvh-160px)]">
              {visibleModules.map((mod) => {
                const meta = MODULE_META[mod];
                const Icon = meta.icon;
                const active = activeModule === mod;
                return (
                  <button
                    key={mod}
                    type="button"
                    onClick={() => setActiveModule(mod)}
                    title={meta.label}
                    style={active ? { backgroundColor: settings.tokens.primary } : undefined}
                    className={`w-full min-h-[42px] px-3 rounded-lg flex items-center gap-3 text-sm font-medium transition-colors cursor-pointer ${
                      railOnly ? 'justify-center px-0' : ''
                    } ${
                      active
                        ? 'text-white shadow-xs'
                        : 'text-slate-300 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {!railOnly && <span className="truncate">{meta.label}</span>}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Operator Footer */}
          <div className="p-2.5 border-t border-white/10 space-y-1.5">
            {!railOnly && session && (
              <div className="px-2 py-1.5">
                <div className="text-xs font-semibold text-white truncate">
                  {session.user.fullName}
                </div>
                <div className="text-[11px] text-slate-300 capitalize">
                  {session.user.role} · {settings.branding.storeId}
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setIsLocked(true)}
              title="Lock Terminal / Switch User"
              className={`w-full min-h-[38px] px-3 rounded-lg flex items-center gap-2.5 text-xs font-medium text-slate-200 hover:bg-white/10 cursor-pointer ${
                railOnly ? 'justify-center px-0' : ''
              }`}
            >
              <Lock className="w-4 h-4 shrink-0" />
              {!railOnly && <span>Lock / Switch User</span>}
            </button>
          </div>
        </aside>
      )}

      {/* Main Content Column */}
      <div className="flex-1 min-w-0 flex flex-col h-full">
        {/* Top Utility Header */}
        <header className="h-14 shrink-0 bg-[var(--pos-surface)] border-b border-[var(--pos-border)] px-3 sm:px-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {layoutTier === 'mobile' && (
              <div
                style={{ backgroundColor: settings.tokens.primary }}
                className="h-8 w-8 rounded-lg flex items-center justify-center text-white shrink-0"
              >
                {settings.branding.logoDataUrl ? (
                  <img
                    src={settings.branding.logoDataUrl}
                    alt={settings.branding.appName}
                    className="h-5 w-5 object-contain rounded"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <Printer className="w-4 h-4" />
                )}
              </div>
            )}
            <div className="min-w-0">
              <div className="text-sm sm:text-base font-bold text-[var(--pos-text)] truncate">
                {MODULE_META[activeModule].label}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Offline / Sync Indicator */}
            {!isOnline ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#D97706]/15 text-[#D97706] text-xs font-medium">
                <WifiOff className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Offline</span>
                {pendingSyncCount > 0 && <span className="font-mono-num">({pendingSyncCount})</span>}
              </span>
            ) : pendingSyncCount > 0 ? (
              <button
                type="button"
                onClick={() => void syncNow()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--pos-primary)]/15 text-[var(--pos-primary)] text-xs font-medium cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>Sync ({pendingSyncCount})</span>
              </button>
            ) : null}

            {/* Adaptive Platform Layout Switcher (Desktop Utility) */}
            {windowWidth >= 1024 && (
              <div className="hidden xl:flex items-center border border-[var(--pos-border)] rounded-lg p-0.5 bg-[var(--pos-bg)]">
                {(
                  [
                    { id: 'auto', label: 'Auto', icon: Monitor },
                    { id: 'windows', label: 'Win', icon: Briefcase },
                    { id: 'tablet', label: 'Tab', icon: Tablet },
                    { id: 'mobile', label: 'Mob', icon: Smartphone },
                  ] as Array<{ id: PlatformPreviewMode; label: string; icon: React.FC<{ className?: string }> }>
                ).map((mode) => {
                  const Icon = mode.icon;
                  const active = platformPreview === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setPlatformPreview(mode.id)}
                      title={`Preview ${mode.label} layout`}
                      className={`px-2 py-1 rounded-md text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer ${
                        active
                          ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs'
                          : 'text-[var(--pos-text-muted)] hover:text-[var(--pos-text)]'
                      }`}
                    >
                      <Icon className="w-3 h-3" />
                      <span>{mode.label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <PWAInstallButton compact={layoutTier === 'mobile'} />

            <button
              type="button"
              onClick={toggleQuickTheme}
              title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              className="h-9 w-9 rounded-lg border border-[var(--pos-border)] flex items-center justify-center text-[var(--pos-text-muted)] hover:text-[var(--pos-text)] hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {layoutTier === 'desktop' && activeModule === 'pos' && (
              <button
                type="button"
                onClick={() => setFullScreenCashier(!fullScreenCashier)}
                title={fullScreenCashier ? 'Exit Full-Screen Cashier' : 'Full-Screen Cashier Mode'}
                className="h-9 w-9 rounded-lg border border-[var(--pos-border)] flex items-center justify-center text-[var(--pos-text-muted)] hover:text-[var(--pos-text)] hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                {fullScreenCashier ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </button>
            )}

            {layoutTier === 'mobile' && (
              <button
                type="button"
                onClick={() => setIsLocked(true)}
                title="Lock Terminal"
                className="h-9 w-9 rounded-lg border border-[var(--pos-border)] flex items-center justify-center text-[var(--pos-text-muted)] cursor-pointer"
              >
                <Lock className="w-4 h-4" />
              </button>
            )}
          </div>
        </header>

        {/* Scrollable Workspace Viewport */}
        <main
          className={`flex-1 min-h-0 overflow-y-auto p-3 sm:p-5 ${
            layoutTier === 'mobile' ? 'pb-24' : ''
          }`}
        >
          {renderModule()}
        </main>
      </div>

      {/* Mobile 5-Tab Bottom Navigation (Home, Products, POS, Orders, More) */}
      {layoutTier === 'mobile' && !fullScreenCashier && (
        <nav className="fixed bottom-0 left-0 right-0 z-30 h-16 bg-[var(--pos-surface)] border-t border-[var(--pos-border)] grid grid-cols-5 items-center px-1">
          {[
            { id: 'dashboard', label: 'Home', icon: Home },
            { id: 'services', label: 'Products', icon: Package },
            { id: 'pos', label: 'POS', icon: ShoppingCart, primary: true },
            { id: 'jobs', label: 'Orders', icon: ClipboardList },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeModule === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveModule(tab.id as ModuleId)}
                className={`flex flex-col items-center justify-center h-full gap-0.5 cursor-pointer ${
                  active ? 'text-[var(--pos-primary)]' : 'text-[var(--pos-text-muted)]'
                }`}
              >
                {tab.primary ? (
                  <span
                    className={`h-9 w-9 rounded-full flex items-center justify-center ${
                      active
                        ? 'bg-[var(--pos-primary)] text-white'
                        : 'bg-[var(--pos-primary)]/15 text-[var(--pos-primary)]'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </span>
                ) : (
                  <Icon className="w-5 h-5" />
                )}
                {!tab.primary && <span className="text-[10px] font-medium">{tab.label}</span>}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setMoreSheetOpen(true)}
            className="flex flex-col items-center justify-center h-full gap-0.5 text-[var(--pos-text-muted)] cursor-pointer"
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[10px] font-medium">More</span>
          </button>
        </nav>
      )}

      {/* Mobile "More" Drawer Sheet */}
      <BottomSheet
        open={moreSheetOpen}
        onClose={() => setMoreSheetOpen(false)}
        title="All Modules"
        subtitle={session ? `${session.user.fullName} · ${session.user.role}` : ''}
      >
        <div className="grid grid-cols-2 gap-2.5">
          {visibleModules.map((mod) => {
            const meta = MODULE_META[mod];
            const Icon = meta.icon;
            return (
              <button
                key={mod}
                type="button"
                onClick={() => {
                  setActiveModule(mod);
                  setMoreSheetOpen(false);
                }}
                style={{ borderRadius: 'var(--pos-radius)' }}
                className={`p-3.5 border text-left flex items-center gap-2.5 cursor-pointer ${
                  activeModule === mod
                    ? 'border-[var(--pos-primary)] bg-[var(--pos-primary)]/10 text-[var(--pos-primary)] font-semibold'
                    : 'border-[var(--pos-border)] text-[var(--pos-text)]'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="text-xs font-medium truncate">{meta.label}</span>
              </button>
            );
          })}
        </div>
      </BottomSheet>

      {/* Non-intrusive Toast Notifications */}
      {toasts.length > 0 && (
        <div className="fixed top-16 right-4 z-50 space-y-2 max-w-xs w-full pointer-events-none">
          {toasts.map((t) => (
            <div
              key={t.id}
              onClick={() => dismissToast(t.id)}
              className={`pointer-events-auto px-3.5 py-2.5 rounded-lg shadow-lg border text-xs font-medium cursor-pointer ${
                t.tone === 'error'
                  ? 'bg-[#DC2626] text-white border-[#B91C1C]'
                  : t.tone === 'success'
                    ? 'bg-[#16A34A] text-white border-[#15803D]'
                    : 'bg-[var(--pos-nav-bg)] text-white border-white/15'
              }`}
            >
              {t.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
