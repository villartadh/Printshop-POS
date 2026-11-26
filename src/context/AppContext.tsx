import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAppState } from './AppStateContext.tsx';
import type {
  AppSettings,
  AuditLogEntry,
  AuthSession,
  BrandingConfig,
  BulkInventoryUpdatePayload,
  CashierShift,
  CriticalAlertEvent,
  CriticalAlertScheduleConfig,
  Customer,
  DesignTokens,
  ExpenseRecord,
  InterfaceDensity,
  InventoryAlertNotification,
  InventoryItem,
  ModuleId,
  OfflineMutation,
  PlatformPreviewMode,
  PrintJob,
  PrintService,
  RecordSupplierOrderPayload,
  ReorderRequestScope,
  ServiceCategory,
  StockAdjustmentPayload,
  StockMovement,
  SupplierCsvImportPayload,
  SupplierDocument,
  SupplierDocumentUploadPayload,
  SupplierRecord,
  SupplierSavePayload,
  SupplyCategory,
  ThemeMode,
  Transaction,
  UserAccount,
} from '../shared/types.ts';
import { DEFAULT_SUPPLY_CATEGORIES } from '../shared/defaults.ts';
import { DEFAULT_CRITICAL_ALERT_CONFIG, normalizeCriticalAlertConfig } from '../shared/criticalAlertSchedule.ts';
import { normalizeSupplierRecord } from '../shared/supplierModel.ts';
import {
  buildInventoryAlertNotifications,
  calculateInventoryValuation,
  computeSignedStockDelta,
  inferReferenceType,
  isLowStockItem,
  normalizeInventoryItem,
  normalizeStockMovement,
  validateInventoryItemInput,
  validateStockMovementInput,
} from '../shared/inventoryModel.ts';
import { apiRequest, getDeviceDescriptor, setMemoryToken } from '../services/apiClient.ts';
import {
  appendDiagnosticLog,
  enqueueOfflineMutation,
  getOutboxMutations,
  loadOfflineSnapshot,
  removeOutboxMutation,
  saveOfflineSnapshot,
  updateOutboxMutation,
} from '../services/offlineDb.ts';
import { useOnlineStatus } from '../hooks/usePWAInstall.ts';

export interface QuickUserInfo {
  id: string;
  username: string;
  fullName: string;
  role: UserAccount['role'];
  hasPin: boolean;
}

export interface ToastMessage {
  id: string;
  tone: 'success' | 'error' | 'info';
  text: string;
}

export interface InventoryStateSlice {
  items: InventoryItem[];
  stockMovements: StockMovement[];
  supplyCategories: SupplyCategory[];
  lowStockItems: InventoryItem[];
  totalValuation: number;
  loading: boolean;
  error: string | null;
  lastLoadedAt: string | null;
}

interface BootstrapPayload {
  settings: AppSettings;
  categories: ServiceCategory[];
  supplyCategories?: SupplyCategory[];
  services: PrintService[];
  inventory: InventoryItem[];
  suppliers?: SupplierRecord[];
  supplierDocuments?: SupplierDocument[];
  stockMovements: StockMovement[];
  customers: Customer[];
  transactions: Transaction[];
  printJobs: PrintJob[];
  expenses: ExpenseRecord[];
  shifts: CashierShift[];
  users: UserAccount[];
  auditLogs: AuditLogEntry[];
  criticalAlertConfig?: CriticalAlertScheduleConfig;
  criticalAlertEvents?: CriticalAlertEvent[];
  criticalAlertSmtpConfigured?: boolean;
  serverTime: string;
}

interface AppContextValue {
  // Auth & shell
  authChecked: boolean;
  needsSetup: boolean;
  quickUsers: QuickUserInfo[];
  session: AuthSession | null;
  isLocked: boolean;
  setIsLocked: (locked: boolean) => void;
  activeModule: ModuleId;
  setActiveModule: (mod: ModuleId) => void;
  platformPreview: PlatformPreviewMode;
  setPlatformPreview: (mode: PlatformPreviewMode) => void;
  fullScreenCashier: boolean;
  setFullScreenCashier: (val: boolean) => void;

  // Connectivity & Sync
  isOnline: boolean;
  isSyncing: boolean;
  pendingSyncCount: number;
  lastSyncedAt: string | null;
  outbox: OfflineMutation[];
  syncNow: () => Promise<void>;

  // Data stores
  loadingData: boolean;
  dataError: string | null;
  settings: AppSettings;
  categories: ServiceCategory[];
  supplyCategories: SupplyCategory[];
  services: PrintService[];
  inventory: InventoryItem[];
  suppliers: SupplierRecord[];
  supplierDocuments: SupplierDocument[];
  inventoryState: InventoryStateSlice;
  stockMovements: StockMovement[];
  customers: Customer[];
  transactions: Transaction[];
  printJobs: PrintJob[];
  expenses: ExpenseRecord[];
  shifts: CashierShift[];
  activeShift: CashierShift | null;
  users: UserAccount[];
  auditLogs: AuditLogEntry[];

  // Toasts & Notification Center
  toasts: ToastMessage[];
  notify: (text: string, tone?: ToastMessage['tone']) => void;
  dismissToast: (id: string) => void;
  belowMinimumItems: InventoryItem[];
  hasSimultaneousThresholdBreach: boolean;
  inventoryNotifications: InventoryAlertNotification[];
  acknowledgedAlertSignatures: string[];
  unreadNotificationCount: number;
  markNotificationRead: (signature: string) => void;
  markAllNotificationsRead: () => void;
  reorderModalOpen: boolean;
  reorderModalScope: ReorderRequestScope;
  openReorderRequestModal: (scope?: ReorderRequestScope) => void;
  closeReorderRequestModal: () => void;
  criticalAlertConfig: CriticalAlertScheduleConfig;
  criticalAlertEvents: CriticalAlertEvent[];
  activeCriticalSystemAlerts: CriticalAlertEvent[];
  criticalAlertSmtpConfigured: boolean;
  alertSettingsModalOpen: boolean;
  openAlertSettingsModal: () => void;
  closeAlertSettingsModal: () => void;
  refreshCriticalAlerts: () => Promise<void>;
  saveCriticalAlertConfig: (next: CriticalAlertScheduleConfig) => Promise<CriticalAlertScheduleConfig>;
  triggerCriticalAlertTest: (simulateOffHours?: boolean) => Promise<{
    triggeredEvents: CriticalAlertEvent[];
    skippedReason?: string;
  }>;
  acknowledgeCriticalAlert: (eventId: string) => Promise<void>;
  acknowledgeAllCriticalAlerts: () => Promise<void>;

  // Auth Actions
  refreshAuthStatus: () => Promise<void>;
  setupAdmin: (payload: {
    username: string;
    fullName: string;
    email: string;
    password: string;
    pin: string;
  }) => Promise<void>;
  loginWithPassword: (username: string, password: string) => Promise<void>;
  loginWithPin: (userId: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;

  // Domain Actions
  refreshBootstrap: () => Promise<void>;
  saveSettings: (next: AppSettings) => Promise<void>;
  setThemeMode: (mode: ThemeMode) => void;
  setDensity: (density: InterfaceDensity) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  updateBranding: (patch: Partial<BrandingConfig>) => void;
  updateTokens: (patch: Partial<DesignTokens>) => void;
  resetSettingsToDefaults: () => void;
  submitTransaction: (txn: Transaction) => Promise<{ transaction: Transaction; queuedOffline: boolean }>;
  deleteHeldOrder: (id: string) => Promise<void>;
  voidTransaction: (id: string, reason: string) => Promise<void>;
  refundTransaction: (id: string, reason: string) => Promise<void>;
  createCategory: (name: string) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  saveService: (service: Partial<PrintService> & { id?: string }) => Promise<PrintService>;
  deleteService: (id: string) => Promise<void>;
  createPrintJob: (job: Partial<PrintJob>) => Promise<PrintJob>;
  updatePrintJob: (
    id: string,
    patch: {
      productionStatus?: PrintJob['productionStatus'];
      paymentStatus?: PrintJob['paymentStatus'];
      assignedOperator?: string;
      instructions?: string;
      depositAmount?: number;
      note?: string;
    },
  ) => Promise<void>;
  loadInventory: () => Promise<InventoryItem[]>;
  createInventoryItem: (item: Partial<InventoryItem>) => Promise<InventoryItem>;
  updateInventoryItem: (id: string, patch: Partial<InventoryItem>) => Promise<InventoryItem>;
  bulkUpdateInventoryItems: (payload: BulkInventoryUpdatePayload) => Promise<InventoryItem[]>;
  importSupplierMappings: (payload: SupplierCsvImportPayload) => Promise<InventoryItem[]>;
  saveSupplier: (payload: SupplierSavePayload) => Promise<SupplierRecord>;
  deleteSupplier: (id: string) => Promise<void>;
  uploadSupplierDocument: (payload: SupplierDocumentUploadPayload) => Promise<SupplierDocument>;
  deleteSupplierDocument: (id: string) => Promise<void>;
  recordSupplierOrder: (payload: RecordSupplierOrderPayload) => Promise<StockMovement[]>;
  deleteInventoryItem: (id: string) => Promise<void>;
  trackStockChange: (id: string, payload: StockAdjustmentPayload) => Promise<StockMovement>;
  adjustInventory: (
    id: string,
    payload: StockAdjustmentPayload,
  ) => Promise<StockMovement>;
  getInventoryItemById: (id: string) => InventoryItem | undefined;
  getItemStockMovements: (inventoryItemId: string) => StockMovement[];
  createCustomer: (customer: Partial<Customer>) => Promise<Customer>;
  collectCustomerBalance: (id: string, amount: number) => Promise<void>;
  createExpense: (expense: Partial<ExpenseRecord>) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  startShift: (openingCash: number) => Promise<void>;
  recordCashMovement: (shiftId: string, type: 'cash_in' | 'cash_out', amount: number, reason: string) => Promise<void>;
  closeShift: (shiftId: string, actualCash: number, reconciliationNote: string) => Promise<void>;
  seedDemo: () => Promise<void>;
  clearDemo: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    settings,
    hasLocalCustomizations,
    setSettingsState,
    updateBranding,
    updateTokens,
    setThemeMode,
    setDensity,
    setSidebarCollapsed,
    resetSettingsToDefaults,
  } = useAppState();

  const isOnline = useOnlineStatus();
  const [authChecked, setAuthChecked] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [quickUsers, setQuickUsers] = useState<QuickUserInfo[]>([]);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  const [activeModule, setActiveModule] = useState<ModuleId>('pos');
  const [platformPreview, setPlatformPreview] = useState<PlatformPreviewMode>('auto');
  const [fullScreenCashier, setFullScreenCashier] = useState(false);

  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [supplyCategories, setSupplyCategories] = useState<SupplyCategory[]>(
    DEFAULT_SUPPLY_CATEGORIES,
  );
  const [services, setServices] = useState<PrintService[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [supplierDocuments, setSupplierDocuments] = useState<SupplierDocument[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [inventoryLastLoadedAt, setInventoryLastLoadedAt] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [printJobs, setPrintJobs] = useState<PrintJob[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [shifts, setShifts] = useState<CashierShift[]>([]);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  const [outbox, setOutbox] = useState<OfflineMutation[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [acknowledgedAlertSignatures, setAcknowledgedAlertSignatures] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('printshop_ack_alerts');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
    } catch {
      return [];
    }
  });
  const [reorderModalOpen, setReorderModalOpen] = useState(false);
  const [reorderModalScope, setReorderModalScope] = useState<ReorderRequestScope>('below_minimum');
  const [criticalAlertConfig, setCriticalAlertConfig] = useState<CriticalAlertScheduleConfig>(
    DEFAULT_CRITICAL_ALERT_CONFIG,
  );
  const [criticalAlertEvents, setCriticalAlertEvents] = useState<CriticalAlertEvent[]>([]);
  const [criticalAlertSmtpConfigured, setCriticalAlertSmtpConfigured] = useState(false);
  const [alertSettingsModalOpen, setAlertSettingsModalOpen] = useState(false);
  const prevBreachSignatureRef = useRef<string | null>(null);

  const notify = useCallback((text: string, tone: ToastMessage['tone'] = 'info') => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-3), { id, tone, text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3600);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const applyBootstrapData = useCallback(
    (data: BootstrapPayload) => {
      const serverTs = Date.parse(data.settings?.updatedAt || '') || 0;
      const localTs = Date.parse(settings.updatedAt || '') || 0;
      if (!hasLocalCustomizations || serverTs > localTs) {
        setSettingsState((prev) => ({
          ...data.settings,
          shellPreferences: data.settings.shellPreferences ?? prev.shellPreferences,
        }));
      }
      setCategories(data.categories);
      if (Array.isArray(data.supplyCategories) && data.supplyCategories.length > 0) {
        setSupplyCategories(data.supplyCategories);
      }
      setServices(data.services);
      setInventory((data.inventory || []).map((item) => normalizeInventoryItem(item)));
      setSuppliers(
        (data.suppliers || []).map((sup) => normalizeSupplierRecord(sup)),
      );
      setSupplierDocuments(data.supplierDocuments || []);
      setStockMovements(
        (data.stockMovements || []).map((mov) => normalizeStockMovement(mov)),
      );
      setInventoryLastLoadedAt(data.serverTime || new Date().toISOString());
      setInventoryError(null);
      setCustomers(data.customers);
      setTransactions(data.transactions);
      setPrintJobs(data.printJobs);
      setExpenses(data.expenses);
      setShifts(data.shifts);
      setUsers(data.users);
      setAuditLogs(data.auditLogs);
      if (data.criticalAlertConfig) {
        setCriticalAlertConfig(normalizeCriticalAlertConfig(data.criticalAlertConfig));
      }
      if (Array.isArray(data.criticalAlertEvents)) {
        setCriticalAlertEvents(data.criticalAlertEvents);
      }
      if (typeof data.criticalAlertSmtpConfigured === 'boolean') {
        setCriticalAlertSmtpConfigured(data.criticalAlertSmtpConfigured);
      }
    },
    [hasLocalCustomizations, setSettingsState, settings.updatedAt],
  );

  const refreshBootstrap = useCallback(async () => {
    setLoadingData(true);
    setDataError(null);
    try {
      const data = await apiRequest<BootstrapPayload>('/api/bootstrap');
      applyBootstrapData(data);
      setLastSyncedAt(data.serverTime || new Date().toISOString());
      await saveOfflineSnapshot('bootstrap', data);
    } catch (err) {
      const cached = await loadOfflineSnapshot<BootstrapPayload>('bootstrap');
      if (cached) {
        applyBootstrapData(cached);
        notify('Working from cached offline store data.', 'info');
      } else {
        setDataError(err instanceof Error ? err.message : 'Unable to load store records.');
      }
    } finally {
      setLoadingData(false);
    }
  }, [applyBootstrapData, notify]);

  const refreshAuthStatus = useCallback(async () => {
    try {
      const status = await apiRequest<{ needsSetup: boolean; quickUsers: QuickUserInfo[] }>(
        '/api/auth/status',
      );
      setNeedsSetup(status.needsSetup);
      setQuickUsers(status.quickUsers);
    } catch {
      const cached = await loadOfflineSnapshot<BootstrapPayload>('bootstrap');
      if (cached?.users) {
        setQuickUsers(
          cached.users.map((u) => ({
            id: u.id,
            username: u.username,
            fullName: u.fullName,
            role: u.role,
            hasPin: u.hasPin,
          })),
        );
      }
    } finally {
      setAuthChecked(true);
    }
  }, []);

  useEffect(() => {
    void refreshAuthStatus();
    void getOutboxMutations().then(setOutbox);
  }, [refreshAuthStatus]);

  const syncNow = useCallback(async () => {
    if (!session || !isOnline || isSyncing) return;
    const queue = await getOutboxMutations();
    if (queue.length === 0) {
      await refreshBootstrap();
      return;
    }
    setIsSyncing(true);
    try {
      const res = await apiRequest<{
        results: Array<{ clientMutationId: string; status: string; error?: string }>;
        syncedAt: string;
      }>('/api/sync/batch', {
        method: 'POST',
        body: JSON.stringify({ mutations: queue }),
      });

      let appliedCount = 0;
      for (const item of res.results) {
        const mut = queue.find((q) => q.clientMutationId === item.clientMutationId);
        if (!mut) continue;
        if (item.status === 'applied' || item.status === 'duplicate') {
          await removeOutboxMutation(mut.id);
          appliedCount++;
        } else {
          await updateOutboxMutation({
            ...mut,
            status: 'conflict',
            retryCount: mut.retryCount + 1,
            errorMessage: item.error || 'Sync conflict',
          });
        }
      }
      setOutbox(await getOutboxMutations());
      setLastSyncedAt(res.syncedAt);
      if (appliedCount > 0) {
        notify(`Synchronized ${appliedCount} offline record(s).`, 'success');
      }
      await refreshBootstrap();
    } catch (err) {
      void appendDiagnosticLog({
        level: 'warn',
        category: 'sync',
        message: err instanceof Error ? err.message : 'Batch sync failed',
      });
    } finally {
      setIsSyncing(false);
    }
  }, [isOnline, isSyncing, notify, refreshBootstrap, session]);

  useEffect(() => {
    if (isOnline && session && outbox.length > 0) {
      void syncNow();
    }
  }, [isOnline, outbox.length, session, syncNow]);

  const completeSignIn = useCallback(
    async (authSession: AuthSession) => {
      setMemoryToken(authSession.token);
      setSession(authSession);
      setIsLocked(false);
      setNeedsSetup(false);
      await refreshBootstrap();
      setActiveModule(authSession.user.preferredLandingModule || settings.defaultLandingModule || 'pos');
    },
    [refreshBootstrap, settings.defaultLandingModule],
  );

  const setupAdmin = async (payload: {
    username: string;
    fullName: string;
    email: string;
    password: string;
    pin: string;
  }) => {
    const dev = getDeviceDescriptor();
    const res = await apiRequest<AuthSession>('/api/auth/setup-admin', {
      method: 'POST',
      body: JSON.stringify({ ...payload, ...dev }),
    });
    await completeSignIn(res);
    notify('Administrator account created and signed in.', 'success');
  };

  const loginWithPassword = async (username: string, password: string) => {
    const dev = getDeviceDescriptor();
    const res = await apiRequest<AuthSession>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, ...dev }),
    });
    await completeSignIn(res);
    notify(`Signed in as ${res.user.fullName}.`, 'success');
  };

  const loginWithPin = async (userId: string, pin: string) => {
    const dev = getDeviceDescriptor();
    const res = await apiRequest<AuthSession>('/api/auth/pin-login', {
      method: 'POST',
      body: JSON.stringify({ userId, pin, ...dev }),
    });
    await completeSignIn(res);
    notify(`Switched cashier to ${res.user.fullName}.`, 'success');
  };

  const logout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors on sign-out
    }
    setMemoryToken('');
    setSession(null);
    setIsLocked(false);
    await refreshAuthStatus();
  };

  const saveSettings = async (next: AppSettings) => {
    const stamped: AppSettings = {
      ...next,
      updatedAt: new Date().toISOString(),
    };
    const persisted = setSettingsState(stamped);

    const canSyncServer =
      isOnline &&
      session &&
      (session.user.role === 'admin' || session.user.role === 'manager');

    if (canSyncServer) {
      try {
        const updated = await apiRequest<AppSettings>('/api/settings', {
          method: 'PUT',
          body: JSON.stringify(persisted),
        });
        setSettingsState(updated);
        notify('Settings saved and synced.', 'success');
        return;
      } catch (err) {
        if (!(err instanceof TypeError)) {
          throw err;
        }
        notify('Settings saved locally (offline).', 'info');
        return;
      }
    }

    notify('Preferences saved locally on this device.', 'success');
  };

  const submitTransaction = async (txn: Transaction) => {
    if (!isOnline) {
      const offlineTxn: Transaction = { ...txn, syncStatus: 'pending_sync' };
      const mut: OfflineMutation = {
        id: `mut_${Date.now()}`,
        clientMutationId: txn.clientMutationId,
        type: 'CREATE_TRANSACTION',
        endpoint: '/api/transactions',
        method: 'POST',
        payload: offlineTxn,
        status: 'pending',
        retryCount: 0,
        createdAt: new Date().toISOString(),
      };
      await enqueueOfflineMutation(mut);
      setOutbox(await getOutboxMutations());
      setTransactions((prev) => [offlineTxn, ...prev]);
      notify('Offline mode: transaction queued safely for sync.', 'info');
      return { transaction: offlineTxn, queuedOffline: true };
    }

    try {
      const res = await apiRequest<{ transaction: Transaction; duplicate: boolean }>(
        '/api/transactions',
        {
          method: 'POST',
          body: JSON.stringify(txn),
        },
      );
      await refreshBootstrap();
      return { transaction: res.transaction, queuedOffline: false };
    } catch (err) {
      // Fallback to offline queue if network drops mid-checkout
      if (err instanceof TypeError) {
        const offlineTxn: Transaction = { ...txn, syncStatus: 'pending_sync' };
        const mut: OfflineMutation = {
          id: `mut_${Date.now()}`,
          clientMutationId: txn.clientMutationId,
          type: 'CREATE_TRANSACTION',
          endpoint: '/api/transactions',
          method: 'POST',
          payload: offlineTxn,
          status: 'pending',
          retryCount: 0,
          createdAt: new Date().toISOString(),
        };
        await enqueueOfflineMutation(mut);
        setOutbox(await getOutboxMutations());
        setTransactions((prev) => [offlineTxn, ...prev]);
        notify('Connection lost: transaction queued for automatic sync.', 'info');
        return { transaction: offlineTxn, queuedOffline: true };
      }
      throw err;
    }
  };

  const deleteHeldOrder = async (id: string) => {
    await apiRequest(`/api/transactions/${id}/held`, { method: 'DELETE' });
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  };

  const voidTransaction = async (id: string, reason: string) => {
    const updated = await apiRequest<Transaction>(`/api/transactions/${id}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    setTransactions((prev) => prev.map((t) => (t.id === id ? updated : t)));
    notify('Transaction voided.', 'info');
  };

  const refundTransaction = async (id: string, reason: string) => {
    const updated = await apiRequest<Transaction>(`/api/transactions/${id}/refund`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    await refreshBootstrap();
    setTransactions((prev) => prev.map((t) => (t.id === id ? updated : t)));
    notify('Refund recorded.', 'info');
  };

  const createCategory = async (name: string) => {
    const cat = await apiRequest<ServiceCategory>('/api/categories', {
      method: 'POST',
      body: JSON.stringify({ name, sortOrder: categories.length + 1 }),
    });
    setCategories((prev) => [...prev, cat]);
    notify(`Category "${name}" added.`, 'success');
  };

  const deleteCategory = async (id: string) => {
    await apiRequest(`/api/categories/${id}`, { method: 'DELETE' });
    setCategories((prev) => prev.filter((c) => c.id !== id));
  };

  const saveService = async (service: Partial<PrintService> & { id?: string }) => {
    const saved = service.id
      ? await apiRequest<PrintService>(`/api/services/${service.id}`, {
          method: 'PUT',
          body: JSON.stringify(service),
        })
      : await apiRequest<PrintService>('/api/services', {
          method: 'POST',
          body: JSON.stringify(service),
        });
    await refreshBootstrap();
    notify(`Service "${saved.name}" saved.`, 'success');
    return saved;
  };

  const deleteService = async (id: string) => {
    await apiRequest(`/api/services/${id}`, { method: 'DELETE' });
    setServices((prev) => prev.filter((s) => s.id !== id));
    notify('Service deleted.', 'info');
  };

  const createPrintJob = async (job: Partial<PrintJob>) => {
    const created = await apiRequest<PrintJob>('/api/print-jobs', {
      method: 'POST',
      body: JSON.stringify(job),
    });
    setPrintJobs((prev) => [created, ...prev]);
    notify(`Job Order ${created.jobOrderNumber} created.`, 'success');
    return created;
  };

  const updatePrintJob = async (
    id: string,
    patch: {
      productionStatus?: PrintJob['productionStatus'];
      paymentStatus?: PrintJob['paymentStatus'];
      assignedOperator?: string;
      instructions?: string;
      depositAmount?: number;
      note?: string;
    },
  ) => {
    const updated = await apiRequest<PrintJob>(`/api/print-jobs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    setPrintJobs((prev) => prev.map((j) => (j.id === id ? updated : j)));
    notify('Print job updated.', 'success');
  };

  const loadInventory = useCallback(async (): Promise<InventoryItem[]> => {
    setInventoryLoading(true);
    setInventoryError(null);
    try {
      const data = await apiRequest<{
        items: InventoryItem[];
        stockMovements: StockMovement[];
        supplyCategories?: SupplyCategory[];
        serverTime: string;
      }>('/api/inventory');

      const normalizedItems = (data.items || []).map((item) => normalizeInventoryItem(item));
      const normalizedMovements = (data.stockMovements || []).map((mov) =>
        normalizeStockMovement(mov),
      );
      setInventory(normalizedItems);
      setStockMovements(normalizedMovements);
      if (Array.isArray(data.supplyCategories) && data.supplyCategories.length > 0) {
        setSupplyCategories(data.supplyCategories);
      }
      setInventoryLastLoadedAt(data.serverTime || new Date().toISOString());

      const cached = await loadOfflineSnapshot<BootstrapPayload>('bootstrap');
      if (cached) {
        await saveOfflineSnapshot('bootstrap', {
          ...cached,
          inventory: normalizedItems,
          stockMovements: normalizedMovements,
          supplyCategories: data.supplyCategories ?? cached.supplyCategories,
        });
      }
      return normalizedItems;
    } catch (err) {
      const cached = await loadOfflineSnapshot<BootstrapPayload>('bootstrap');
      if (cached?.inventory) {
        const normalizedItems = cached.inventory.map((item) => normalizeInventoryItem(item));
        const normalizedMovements = (cached.stockMovements || []).map((mov) =>
          normalizeStockMovement(mov),
        );
        setInventory(normalizedItems);
        setStockMovements(normalizedMovements);
        return normalizedItems;
      }
      const message = err instanceof Error ? err.message : 'Unable to load inventory records.';
      setInventoryError(message);
      throw err;
    } finally {
      setInventoryLoading(false);
    }
  }, []);

  const createInventoryItem = async (item: Partial<InventoryItem>): Promise<InventoryItem> => {
    const validation = validateInventoryItemInput(item);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    const created = await apiRequest<InventoryItem>('/api/inventory', {
      method: 'POST',
      body: JSON.stringify(item),
    });
    const normalized = normalizeInventoryItem(created);
    setInventory((prev) =>
      [...prev, normalized].sort((a, b) => a.name.localeCompare(b.name)),
    );
    if (normalized.quantityOnHand > 0) {
      await loadInventory();
    }
    notify(`Added "${normalized.name}" to inventory.`, 'success');
    return normalized;
  };

  const updateInventoryItem = async (
    id: string,
    patch: Partial<InventoryItem>,
  ): Promise<InventoryItem> => {
    const updated = await apiRequest<InventoryItem>(`/api/inventory/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    const normalized = normalizeInventoryItem(updated);
    setInventory((prev) => prev.map((item) => (item.id === id ? normalized : item)));
    notify(`Updated "${normalized.name}".`, 'success');
    return normalized;
  };

  const bulkUpdateInventoryItems = async (
    payload: BulkInventoryUpdatePayload,
  ): Promise<InventoryItem[]> => {
    const res = await apiRequest<{ items: InventoryItem[]; updatedCount: number }>(
      '/api/inventory/bulk',
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      },
    );
    const normalizedList = (res.items || []).map((item) => normalizeInventoryItem(item));
    const updatedMap = new Map(normalizedList.map((item) => [item.id, item]));
    const nextItems = inventory.map((item) => updatedMap.get(item.id) ?? item);
    setInventory(nextItems);

    const cached = await loadOfflineSnapshot<BootstrapPayload>('bootstrap');
    if (cached) {
      await saveOfflineSnapshot('bootstrap', {
        ...cached,
        inventory: nextItems,
      });
    }

    notify(`Updated ${normalizedList.length} inventory item(s).`, 'success');
    return normalizedList;
  };

  const importSupplierMappings = async (
    payload: SupplierCsvImportPayload,
  ): Promise<InventoryItem[]> => {
    const res = await apiRequest<{ items: InventoryItem[]; updatedCount: number }>(
      '/api/inventory/supplier-import',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
    const normalizedList = (res.items || []).map((item) => normalizeInventoryItem(item));
    const updatedMap = new Map(normalizedList.map((item) => [item.id, item]));
    const nextItems = inventory.map((item) => updatedMap.get(item.id) ?? item);
    setInventory(nextItems);

    const cached = await loadOfflineSnapshot<BootstrapPayload>('bootstrap');
    if (cached) {
      await saveOfflineSnapshot('bootstrap', {
        ...cached,
        inventory: nextItems,
      });
    }

    notify(`Mapped suppliers to ${normalizedList.length} inventory item(s).`, 'success');
    return normalizedList;
  };

  const saveSupplier = async (
    payload: SupplierSavePayload,
  ): Promise<SupplierRecord> => {
    const res = payload.id
      ? await apiRequest<{ supplier: SupplierRecord; syncedItemsCount?: number }>(
          `/api/suppliers/${payload.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify(payload),
          },
        )
      : await apiRequest<{ supplier: SupplierRecord; syncedItemsCount?: number }>(
          '/api/suppliers',
          {
            method: 'POST',
            body: JSON.stringify(payload),
          },
        );

    const normalizedSupplier = normalizeSupplierRecord(res.supplier);
    setSuppliers((prev) => {
      const exists = prev.some((s) => s.id === normalizedSupplier.id);
      const next = exists
        ? prev.map((s) => (s.id === normalizedSupplier.id ? normalizedSupplier : s))
        : [...prev, normalizedSupplier];
      return next.sort((a, b) => a.name.localeCompare(b.name));
    });

    if (
      payload.id &&
      payload.previousName &&
      payload.previousName.trim().toLowerCase() !== normalizedSupplier.name.toLowerCase()
    ) {
      const prevLower = payload.previousName.trim().toLowerCase();
      setSupplierDocuments((prev) =>
        prev.map((doc) =>
          doc.supplierId === normalizedSupplier.id ||
          doc.supplierName.trim().toLowerCase() === prevLower
            ? {
                ...doc,
                supplierId: normalizedSupplier.id,
                supplierName: normalizedSupplier.name,
              }
            : doc,
        ),
      );
    }

    if (res.syncedItemsCount && res.syncedItemsCount > 0) {
      await loadInventory();
    } else {
      const cached = await loadOfflineSnapshot<BootstrapPayload>('bootstrap');
      if (cached) {
        const prevList = cached.suppliers ?? [];
        const exists = prevList.some((s) => s.id === normalizedSupplier.id);
        const nextList = exists
          ? prevList.map((s) => (s.id === normalizedSupplier.id ? normalizedSupplier : s))
          : [...prevList, normalizedSupplier];
        await saveOfflineSnapshot('bootstrap', {
          ...cached,
          suppliers: nextList,
        });
      }
    }

    notify(
      res.syncedItemsCount && res.syncedItemsCount > 0
        ? `Saved supplier "${normalizedSupplier.name}" and synced ${res.syncedItemsCount} item(s).`
        : `Saved supplier "${normalizedSupplier.name}".`,
      'success',
    );
    return normalizedSupplier;
  };

  const deleteSupplier = async (id: string): Promise<void> => {
    const target = suppliers.find((s) => s.id === id);
    await apiRequest<{ ok: boolean; id: string }>(`/api/suppliers/${id}`, {
      method: 'DELETE',
    });
    const nextSuppliers = suppliers.filter((s) => s.id !== id);
    setSuppliers(nextSuppliers);

    const cached = await loadOfflineSnapshot<BootstrapPayload>('bootstrap');
    if (cached) {
      await saveOfflineSnapshot('bootstrap', {
        ...cached,
        suppliers: nextSuppliers,
      });
    }
    notify(
      target ? `Removed supplier "${target.name}" from directory.` : 'Supplier removed.',
      'info',
    );
  };

  const uploadSupplierDocument = async (
    payload: SupplierDocumentUploadPayload,
  ): Promise<SupplierDocument> => {
    const res = await apiRequest<{ document: SupplierDocument }>(
      '/api/suppliers/documents',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
    const nextDocs = [res.document, ...supplierDocuments];
    setSupplierDocuments(nextDocs);

    const cached = await loadOfflineSnapshot<BootstrapPayload>('bootstrap');
    if (cached) {
      await saveOfflineSnapshot('bootstrap', {
        ...cached,
        supplierDocuments: nextDocs,
      });
    }
    notify(`Attached "${res.document.title}" to ${res.document.supplierName}.`, 'success');
    return res.document;
  };

  const deleteSupplierDocument = async (id: string): Promise<void> => {
    const target = supplierDocuments.find((d) => d.id === id);
    await apiRequest<{ ok: boolean; id: string }>(`/api/suppliers/documents/${id}`, {
      method: 'DELETE',
    });
    const nextDocs = supplierDocuments.filter((d) => d.id !== id);
    setSupplierDocuments(nextDocs);

    const cached = await loadOfflineSnapshot<BootstrapPayload>('bootstrap');
    if (cached) {
      await saveOfflineSnapshot('bootstrap', {
        ...cached,
        supplierDocuments: nextDocs,
      });
    }
    notify(
      target ? `Removed document "${target.title}".` : 'Supplier document removed.',
      'info',
    );
  };

  const recordSupplierOrder = async (
    payload: RecordSupplierOrderPayload,
  ): Promise<StockMovement[]> => {
    const res = await apiRequest<{
      reference: string;
      supplierName: string;
      movements: StockMovement[];
      items: InventoryItem[];
    }>('/api/suppliers/record-order', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const normalizedMovements = (res.movements || []).map((m) => normalizeStockMovement(m));
    const updatedItemMap = new Map(
      (res.items || []).map((item) => {
        const norm = normalizeInventoryItem(item);
        return [norm.id, norm];
      }),
    );

    const nextItems = inventory.map((item) => updatedItemMap.get(item.id) ?? item);
    const nextMovements = [...normalizedMovements, ...stockMovements];
    setInventory(nextItems);
    setStockMovements(nextMovements);

    const cached = await loadOfflineSnapshot<BootstrapPayload>('bootstrap');
    if (cached) {
      await saveOfflineSnapshot('bootstrap', {
        ...cached,
        inventory: nextItems,
        stockMovements: nextMovements,
      });
    }

    notify(
      `Logged PO ${res.reference} (${normalizedMovements.length} item(s)) from ${res.supplierName}.`,
      'success',
    );
    return normalizedMovements;
  };

  const deleteInventoryItem = async (id: string): Promise<void> => {
    const target = inventory.find((item) => item.id === id);
    await apiRequest<{ ok: boolean; id: string }>(`/api/inventory/${id}`, {
      method: 'DELETE',
    });

    const nextItems = inventory.filter((item) => item.id !== id);
    const nextMovements = stockMovements.filter((mov) => mov.inventoryItemId !== id);
    setInventory(nextItems);
    setStockMovements(nextMovements);

    const cached = await loadOfflineSnapshot<BootstrapPayload>('bootstrap');
    if (cached) {
      await saveOfflineSnapshot('bootstrap', {
        ...cached,
        inventory: nextItems,
        stockMovements: nextMovements,
      });
    }

    notify(
      target ? `Deleted "${target.name}" from inventory.` : 'Inventory item deleted.',
      'info',
    );
  };

  const trackStockChange = async (
    id: string,
    payload: StockAdjustmentPayload,
  ): Promise<StockMovement> => {
    const validation = validateStockMovementInput({
      movementType: payload.movementType,
      quantityDelta: payload.quantityDelta,
    });
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const applyOptimisticOffline = async (): Promise<StockMovement> => {
      const target = inventory.find((item) => item.id === id);
      if (!target) {
        throw new Error('Inventory item not found.');
      }
      const signedDelta = computeSignedStockDelta(
        payload.movementType,
        payload.quantityDelta,
      );
      const qtyBefore = Number(target.quantityOnHand) || 0;
      const nextQty = Math.max(0, Number((qtyBefore + signedDelta).toFixed(2)));
      const now = new Date().toISOString();
      const occurredAt = payload.occurredAt || now;
      const restockedAt =
        signedDelta > 0 &&
        (payload.movementType === 'purchase' || payload.movementType === 'return')
          ? occurredAt
          : target.lastRestockedAt ?? null;

      const hasCustomUnitCost =
        payload.unitCost !== undefined &&
        Number.isFinite(Number(payload.unitCost)) &&
        Number(payload.unitCost) >= 0;
      const movementUnitCost = hasCustomUnitCost
        ? Number(Number(payload.unitCost).toFixed(2))
        : target.unitCost;
      const nextItemUnitCost =
        hasCustomUnitCost &&
        (payload.movementType === 'purchase' || payload.movementType === 'initial_stock')
          ? movementUnitCost
          : target.unitCost;

      const updatedItem = normalizeInventoryItem({
        ...target,
        quantityOnHand: nextQty,
        unitCost: nextItemUnitCost,
        lastRestockedAt: restockedAt,
        updatedAt: now,
      });
      const movement = normalizeStockMovement({
        id: `mov_off_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        inventoryItemId: target.id,
        itemName: target.name,
        movementType: payload.movementType,
        quantityBefore: qtyBefore,
        quantityDelta: signedDelta,
        balanceAfter: nextQty,
        unitCostAtMovement: movementUnitCost,
        referenceType: payload.referenceType || inferReferenceType(payload.movementType),
        reference: payload.reference || '',
        performedById: session?.user.id || '',
        performedBy: session?.user.fullName || 'Offline Cashier',
        note: payload.note || '',
        occurredAt,
        createdAt: now,
      });

      const mut: OfflineMutation = {
        id: `mut_inv_${Date.now()}`,
        clientMutationId: `inv_adj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'ADJUST_INVENTORY',
        endpoint: `/api/inventory/${id}/adjust`,
        method: 'POST',
        payload: { inventoryItemId: id, ...payload },
        status: 'pending',
        retryCount: 0,
        createdAt: now,
      };
      await enqueueOfflineMutation(mut);
      setOutbox(await getOutboxMutations());
      setInventory((prev) => prev.map((item) => (item.id === id ? updatedItem : item)));
      setStockMovements((prev) => [movement, ...prev]);
      notify('Offline mode: stock adjustment queued for sync.', 'info');
      return movement;
    };

    if (!isOnline) {
      return applyOptimisticOffline();
    }

    try {
      const res = await apiRequest<{
        id: string;
        quantityOnHand: number;
        lastRestockedAt: string | null;
        updatedAt: string;
        item?: InventoryItem;
        movement: StockMovement;
      }>(`/api/inventory/${id}/adjust`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const normalizedMovement = normalizeStockMovement(res.movement);
      setInventory((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;
          if (res.item) return normalizeInventoryItem(res.item);
          return normalizeInventoryItem({
            ...item,
            quantityOnHand: res.quantityOnHand,
            lastRestockedAt: res.lastRestockedAt,
            updatedAt: res.updatedAt,
          });
        }),
      );
      setStockMovements((prev) => [normalizedMovement, ...prev]);
      notify('Stock level updated.', 'success');
      return normalizedMovement;
    } catch (err) {
      if (err instanceof TypeError) {
        return applyOptimisticOffline();
      }
      throw err;
    }
  };

  const adjustInventory = trackStockChange;

  const getInventoryItemById = useCallback(
    (id: string) => inventory.find((item) => item.id === id),
    [inventory],
  );

  const getItemStockMovements = useCallback(
    (inventoryItemId: string) =>
      stockMovements.filter((mov) => mov.inventoryItemId === inventoryItemId),
    [stockMovements],
  );

  const createCustomer = async (customer: Partial<Customer>) => {
    const created = await apiRequest<Customer>('/api/customers', {
      method: 'POST',
      body: JSON.stringify(customer),
    });
    setCustomers((prev) => [...prev, created]);
    notify(`Customer "${created.name}" added.`, 'success');
    return created;
  };

  const collectCustomerBalance = async (id: string, amount: number) => {
    await apiRequest(`/api/customers/${id}/pay-balance`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    });
    await refreshBootstrap();
    notify('Customer balance payment recorded.', 'success');
  };

  const createExpense = async (expense: Partial<ExpenseRecord>) => {
    const created = await apiRequest<ExpenseRecord>('/api/expenses', {
      method: 'POST',
      body: JSON.stringify(expense),
    });
    setExpenses((prev) => [created, ...prev]);
    notify('Expense recorded.', 'success');
  };

  const deleteExpense = async (id: string) => {
    await apiRequest(`/api/expenses/${id}`, { method: 'DELETE' });
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    notify('Expense removed.', 'info');
  };

  const startShift = async (openingCash: number) => {
    await apiRequest('/api/shifts/start', {
      method: 'POST',
      body: JSON.stringify({ openingCash }),
    });
    await refreshBootstrap();
    notify('Cashier shift started.', 'success');
  };

  const recordCashMovement = async (
    shiftId: string,
    type: 'cash_in' | 'cash_out',
    amount: number,
    reason: string,
  ) => {
    await apiRequest(`/api/shifts/${shiftId}/movement`, {
      method: 'POST',
      body: JSON.stringify({ type, amount, reason }),
    });
    await refreshBootstrap();
    notify(`Recorded ${type === 'cash_in' ? 'Cash In' : 'Cash Out'}.`, 'success');
  };

  const closeShift = async (shiftId: string, actualCash: number, reconciliationNote: string) => {
    await apiRequest(`/api/shifts/${shiftId}/close`, {
      method: 'POST',
      body: JSON.stringify({ actualCash, reconciliationNote }),
    });
    await refreshBootstrap();
    notify('Shift closed and reconciled.', 'success');
  };

  const seedDemo = async () => {
    await apiRequest('/api/demo/seed', { method: 'POST' });
    await refreshBootstrap();
    notify('Demonstration catalog and sample records loaded.', 'success');
  };

  const clearDemo = async () => {
    await apiRequest('/api/demo/clear', { method: 'POST' });
    await refreshBootstrap();
    notify('Demonstration records removed.', 'info');
  };

  const activeShift = useMemo(() => {
    if (!session) return null;
    return (
      shifts.find((s) => s.status === 'open' && s.cashierId === session.user.id) ||
      shifts.find((s) => s.status === 'open') ||
      null
    );
  }, [session, shifts]);

  const alertSnapshot = useMemo(
    () => buildInventoryAlertNotifications(inventory),
    [inventory],
  );

  useEffect(() => {
    if (inventory.length === 0) return;
    const activeSignatures = new Set(alertSnapshot.notifications.map((n) => n.signature));
    setAcknowledgedAlertSignatures((prev) => {
      const pruned = prev.filter((sig) => activeSignatures.has(sig));
      if (pruned.length === prev.length) return prev;
      try {
        localStorage.setItem('printshop_ack_alerts', JSON.stringify(pruned));
      } catch {
        // Ignore storage errors
      }
      return pruned;
    });
  }, [inventory.length, alertSnapshot.notifications]);

  useEffect(() => {
    if (inventory.length === 0) return;
    if (prevBreachSignatureRef.current === null) {
      prevBreachSignatureRef.current = alertSnapshot.breachSignature;
      return;
    }
    if (
      alertSnapshot.hasSimultaneousBreach &&
      alertSnapshot.breachSignature !== prevBreachSignatureRef.current
    ) {
      prevBreachSignatureRef.current = alertSnapshot.breachSignature;
      notify(
        `${alertSnapshot.belowMinimumItems.length} inventory items crossed below minimum threshold simultaneously.`,
        'error',
      );
      return;
    }
    if (!alertSnapshot.hasSimultaneousBreach && prevBreachSignatureRef.current !== '') {
      prevBreachSignatureRef.current = '';
    }
  }, [
    inventory.length,
    alertSnapshot.hasSimultaneousBreach,
    alertSnapshot.breachSignature,
    alertSnapshot.belowMinimumItems.length,
    notify,
  ]);

  const activeCriticalSystemAlerts = useMemo(
    () => criticalAlertEvents.filter((e) => e.systemAlertStatus === 'active'),
    [criticalAlertEvents],
  );

  const unreadNotificationCount = useMemo(
    () =>
      alertSnapshot.notifications.filter(
        (n) => !acknowledgedAlertSignatures.includes(n.signature),
      ).length + activeCriticalSystemAlerts.length,
    [alertSnapshot.notifications, acknowledgedAlertSignatures, activeCriticalSystemAlerts.length],
  );

  const markNotificationRead = useCallback((signature: string) => {
    setAcknowledgedAlertSignatures((prev) => {
      if (prev.includes(signature)) return prev;
      const next = [...prev, signature];
      try {
        localStorage.setItem('printshop_ack_alerts', JSON.stringify(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    const allSigs = alertSnapshot.notifications.map((n) => n.signature);
    setAcknowledgedAlertSignatures(allSigs);
    try {
      localStorage.setItem('printshop_ack_alerts', JSON.stringify(allSigs));
    } catch {
      // Ignore storage errors
    }
  }, [alertSnapshot.notifications]);

  const openReorderRequestModal = useCallback(
    (scope?: ReorderRequestScope) => {
      setReorderModalScope(
        scope ?? (alertSnapshot.belowMinimumItems.length > 0 ? 'below_minimum' : 'all_low_stock'),
      );
      setReorderModalOpen(true);
    },
    [alertSnapshot.belowMinimumItems.length],
  );

  const closeReorderRequestModal = useCallback(() => {
    setReorderModalOpen(false);
  }, []);

  const openAlertSettingsModal = useCallback(() => {
    setAlertSettingsModalOpen(true);
  }, []);

  const closeAlertSettingsModal = useCallback(() => {
    setAlertSettingsModalOpen(false);
  }, []);

  const refreshCriticalAlerts = useCallback(async () => {
    if (!session || !isOnline) return;
    try {
      const res = await apiRequest<{
        events: CriticalAlertEvent[];
        smtpConfigured: boolean;
      }>('/api/alerts/critical-events');
      setCriticalAlertEvents(res.events || []);
      setCriticalAlertSmtpConfigured(Boolean(res.smtpConfigured));
    } catch {
      // Ignore transient poll errors
    }
  }, [session, isOnline]);

  useEffect(() => {
    if (!session || !isOnline) return;
    const timer = window.setInterval(() => {
      void refreshCriticalAlerts();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [session, isOnline, refreshCriticalAlerts]);

  const saveCriticalAlertConfig = useCallback(
    async (next: CriticalAlertScheduleConfig): Promise<CriticalAlertScheduleConfig> => {
      const res = await apiRequest<{
        config: CriticalAlertScheduleConfig;
        smtpConfigured: boolean;
      }>('/api/alerts/critical-config', {
        method: 'PUT',
        body: JSON.stringify(next),
      });
      const normalized = normalizeCriticalAlertConfig(res.config);
      setCriticalAlertConfig(normalized);
      setCriticalAlertSmtpConfigured(Boolean(res.smtpConfigured));
      notify('Off-hours & weekend alert schedule saved.', 'success');
      return normalized;
    },
    [notify],
  );

  const triggerCriticalAlertTest = useCallback(
    async (simulateOffHours = true) => {
      const res = await apiRequest<{
        triggeredEvents: CriticalAlertEvent[];
        skippedReason?: string;
        events: CriticalAlertEvent[];
        smtpConfigured: boolean;
      }>('/api/alerts/critical-events/test', {
        method: 'POST',
        body: JSON.stringify({ simulateOffHours }),
      });
      setCriticalAlertEvents(res.events || []);
      setCriticalAlertSmtpConfigured(Boolean(res.smtpConfigured));
      if (res.triggeredEvents.length > 0) {
        notify(
          `Dispatched ${res.triggeredEvents.length} critical stock alert(s).`,
          'info',
        );
      } else if (res.skippedReason) {
        notify(res.skippedReason, 'info');
      }
      return {
        triggeredEvents: res.triggeredEvents || [],
        skippedReason: res.skippedReason,
      };
    },
    [notify],
  );

  const acknowledgeCriticalAlert = useCallback(
    async (eventId: string) => {
      const res = await apiRequest<{ event: CriticalAlertEvent }>(
        `/api/alerts/critical-events/${eventId}/acknowledge`,
        { method: 'POST' },
      );
      setCriticalAlertEvents((prev) =>
        prev.map((e) => (e.id === eventId ? res.event : e)),
      );
    },
    [],
  );

  const acknowledgeAllCriticalAlerts = useCallback(async () => {
    const res = await apiRequest<{ events: CriticalAlertEvent[] }>(
      '/api/alerts/critical-events/acknowledge-all',
      { method: 'POST' },
    );
    setCriticalAlertEvents(res.events || []);
    notify('All off-hours critical system alerts acknowledged.', 'success');
  }, [notify]);

  const inventoryState = useMemo<InventoryStateSlice>(
    () => ({
      items: inventory,
      stockMovements,
      supplyCategories,
      lowStockItems: inventory.filter((item) => isLowStockItem(item)),
      totalValuation: calculateInventoryValuation(inventory),
      loading: inventoryLoading,
      error: inventoryError,
      lastLoadedAt: inventoryLastLoadedAt,
    }),
    [
      inventory,
      inventoryError,
      inventoryLastLoadedAt,
      inventoryLoading,
      stockMovements,
      supplyCategories,
    ],
  );

  const value: AppContextValue = {
    authChecked,
    needsSetup,
    quickUsers,
    session,
    isLocked,
    setIsLocked,
    activeModule,
    setActiveModule,
    platformPreview,
    setPlatformPreview,
    fullScreenCashier,
    setFullScreenCashier,
    isOnline,
    isSyncing,
    pendingSyncCount: outbox.length,
    lastSyncedAt,
    outbox,
    syncNow,
    loadingData,
    dataError,
    settings,
    categories,
    supplyCategories,
    services,
    inventory,
    suppliers,
    supplierDocuments,
    inventoryState,
    stockMovements,
    customers,
    transactions,
    printJobs,
    expenses,
    shifts,
    activeShift,
    users,
    auditLogs,
    toasts,
    notify,
    dismissToast,
    belowMinimumItems: alertSnapshot.belowMinimumItems,
    hasSimultaneousThresholdBreach: alertSnapshot.hasSimultaneousBreach,
    inventoryNotifications: alertSnapshot.notifications,
    acknowledgedAlertSignatures,
    unreadNotificationCount,
    markNotificationRead,
    markAllNotificationsRead,
    reorderModalOpen,
    reorderModalScope,
    openReorderRequestModal,
    closeReorderRequestModal,
    criticalAlertConfig,
    criticalAlertEvents,
    activeCriticalSystemAlerts,
    criticalAlertSmtpConfigured,
    alertSettingsModalOpen,
    openAlertSettingsModal,
    closeAlertSettingsModal,
    refreshCriticalAlerts,
    saveCriticalAlertConfig,
    triggerCriticalAlertTest,
    acknowledgeCriticalAlert,
    acknowledgeAllCriticalAlerts,
    refreshAuthStatus,
    setupAdmin,
    loginWithPassword,
    loginWithPin,
    logout,
    refreshBootstrap,
    saveSettings,
    setThemeMode,
    setDensity,
    setSidebarCollapsed,
    updateBranding,
    updateTokens,
    resetSettingsToDefaults,
    submitTransaction,
    deleteHeldOrder,
    voidTransaction,
    refundTransaction,
    createCategory,
    deleteCategory,
    saveService,
    deleteService,
    createPrintJob,
    updatePrintJob,
    loadInventory,
    createInventoryItem,
    updateInventoryItem,
    bulkUpdateInventoryItems,
    importSupplierMappings,
    saveSupplier,
    deleteSupplier,
    uploadSupplierDocument,
    deleteSupplierDocument,
    recordSupplierOrder,
    deleteInventoryItem,
    trackStockChange,
    adjustInventory,
    getInventoryItemById,
    getItemStockMovements,
    createCustomer,
    collectCustomerBalance,
    createExpense,
    deleteExpense,
    startShift,
    recordCashMovement,
    closeShift,
    seedDemo,
    clearDemo,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
