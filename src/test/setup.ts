import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  DEFAULT_SUPPLY_CATEGORIES,
  DEMO_CATEGORIES,
  DEMO_INVENTORY,
  DEMO_SERVICES,
  DEMO_STOCK_MOVEMENTS,
  DEMO_SUPPLIERS,
} from '../shared/defaults.ts';

function createJsonResponse(body: unknown, status = 200): Response {
  const payload = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => body,
    text: async () => payload,
    blob: async () => new Blob([payload], { type: 'application/json' }),
  } as Response;
}

export function createDefaultApiFetchMock() {
  return vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const pathname = rawUrl.split('?')[0];

    if (pathname.endsWith('/api/health')) {
      return createJsonResponse({ status: 'ok', time: new Date().toISOString() });
    }
    if (pathname.endsWith('/api/auth/status')) {
      return createJsonResponse({ needsSetup: false, quickUsers: [] });
    }
    if (pathname.endsWith('/api/bootstrap')) {
      return createJsonResponse({
        settings: DEFAULT_SETTINGS,
        categories: DEMO_CATEGORIES,
        supplyCategories: DEFAULT_SUPPLY_CATEGORIES,
        services: DEMO_SERVICES,
        inventory: DEMO_INVENTORY,
        suppliers: DEMO_SUPPLIERS,
        supplierDocuments: [],
        stockMovements: DEMO_STOCK_MOVEMENTS,
        customers: [],
        transactions: [],
        printJobs: [],
        expenses: [],
        shifts: [],
        users: [],
        auditLogs: [],
        serverTime: new Date().toISOString(),
      });
    }
    if (pathname.endsWith('/api/inventory')) {
      return createJsonResponse({
        items: [],
        stockMovements: [],
        supplyCategories: [],
        serverTime: new Date().toISOString(),
      });
    }
    if (pathname.endsWith('/api/suppliers')) {
      return createJsonResponse({
        suppliers: [],
        serverTime: new Date().toISOString(),
      });
    }
    if (pathname.endsWith('/api/suppliers/documents')) {
      return createJsonResponse({ documents: [] });
    }
    if (pathname.endsWith('/api/alerts/critical-events')) {
      return createJsonResponse({
        events: [],
        activeCount: 0,
        serverTime: new Date().toISOString(),
      });
    }

    return createJsonResponse({ ok: true });
  });
}

// Lightweight in-memory IndexedDB mock for offlineDb.ts in JSDOM
function createMockIndexedDB() {
  const databases = new Map<string, Map<string, Map<IDBValidKey, unknown>>>();

  const getStoreMap = (dbName: string, storeName: string) => {
    let dbStores = databases.get(dbName);
    if (!dbStores) {
      dbStores = new Map();
      databases.set(dbName, dbStores);
    }
    let store = dbStores.get(storeName);
    if (!store) {
      store = new Map();
      dbStores.set(storeName, store);
    }
    return store;
  };

  const makeRequest = <T>(executor: () => T) => {
    const req: {
      result: T | undefined;
      error: DOMException | null;
      onsuccess: ((ev: Event) => void) | null;
      onerror: ((ev: Event) => void) | null;
    } = {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null,
    };

    queueMicrotask(() => {
      try {
        req.result = executor();
        req.onsuccess?.({ target: req } as unknown as Event);
      } catch (err) {
        req.error = err as DOMException;
        req.onerror?.({ target: req } as unknown as Event);
      }
    });

    return req;
  };

  const open = (name: string) => {
    if (!databases.has(name)) {
      databases.set(name, new Map());
    }
    const dbStores = databases.get(name)!;

    const dbHandle = {
      name,
      objectStoreNames: {
        contains: (storeName: string) => dbStores.has(storeName),
      },
      createObjectStore: (storeName: string) => {
        if (!dbStores.has(storeName)) {
          dbStores.set(storeName, new Map());
        }
        return {};
      },
      transaction: (storeName: string) => {
        const tx: {
          error: DOMException | null;
          oncomplete: ((ev: Event) => void) | null;
          onerror: ((ev: Event) => void) | null;
          objectStore: (name: string) => Record<string, unknown>;
        } = {
          error: null,
          oncomplete: null,
          onerror: null,
          objectStore: (targetStore: string) => {
            const store = getStoreMap(name, targetStore || storeName);
            const scheduleComplete = () => {
              queueMicrotask(() => {
                tx.oncomplete?.({ target: tx } as unknown as Event);
              });
            };
            return {
              put: (value: unknown, key?: IDBValidKey) => {
                const resolvedKey =
                  key ??
                  ((value && typeof value === 'object' && 'id' in value
                    ? (value as { id: IDBValidKey }).id
                    : undefined) as IDBValidKey) ??
                  `k_${store.size + 1}`;
                store.set(resolvedKey, value);
                scheduleComplete();
                return makeRequest(() => resolvedKey);
              },
              get: (key: IDBValidKey) => makeRequest(() => store.get(key)),
              getAll: () => makeRequest(() => Array.from(store.values())),
              delete: (key: IDBValidKey) => {
                store.delete(key);
                scheduleComplete();
                return makeRequest(() => undefined);
              },
              clear: () => {
                store.clear();
                scheduleComplete();
                return makeRequest(() => undefined);
              },
            };
          },
        };
        return tx;
      },
      close: vi.fn(),
    };

    const openReq: {
      result: typeof dbHandle;
      error: DOMException | null;
      onupgradeneeded: ((ev: IDBVersionChangeEvent) => void) | null;
      onsuccess: ((ev: Event) => void) | null;
      onerror: ((ev: Event) => void) | null;
    } = {
      result: dbHandle,
      error: null,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
    };

    queueMicrotask(() => {
      openReq.onupgradeneeded?.({ target: openReq } as unknown as IDBVersionChangeEvent);
      openReq.onsuccess?.({ target: openReq } as unknown as Event);
    });

    return openReq as unknown as IDBOpenDBRequest;
  };

  return {
    open,
    deleteDatabase: vi.fn((name: string) => {
      databases.delete(name);
      return makeRequest(() => undefined) as unknown as IDBOpenDBRequest;
    }),
    _resetAll: () => databases.clear(),
  };
}

let mockIndexedDbInstance: ReturnType<typeof createMockIndexedDB> | null = null;

if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => false),
      })),
    });
  }

  if (!globalThis.ResizeObserver) {
    class MockResizeObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      writable: true,
      configurable: true,
      value: MockResizeObserver,
    });
  }

  if (!globalThis.IntersectionObserver) {
    class MockIntersectionObserver {
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds: ReadonlyArray<number> = [];
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      takeRecords = vi.fn(() => []);
    }
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      writable: true,
      configurable: true,
      value: MockIntersectionObserver,
    });
  }

  Object.defineProperty(window, 'scrollTo', {
    writable: true,
    configurable: true,
    value: vi.fn(),
  });

  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }

  if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', {
      writable: true,
      configurable: true,
      value: vi.fn(() => 'blob:mock-object-url'),
    });
  }

  if (!URL.revokeObjectURL) {
    Object.defineProperty(URL, 'revokeObjectURL', {
      writable: true,
      configurable: true,
      value: vi.fn(),
    });
  }

  if (!navigator.mediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', {
      writable: true,
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue(new Error('Camera mocked in jsdom')),
        enumerateDevices: vi.fn().mockResolvedValue([]),
      },
    });
  }

  // Ensure Web Crypto randomUUID & getRandomValues exist reliably in JSDOM
  const existingCrypto = globalThis.crypto;
  if (!existingCrypto || typeof existingCrypto.randomUUID !== 'function') {
    let uuidSeq = 0;
    const mockCrypto = {
      ...existingCrypto,
      getRandomValues:
        existingCrypto?.getRandomValues?.bind(existingCrypto) ??
        (<T extends ArrayBufferView>(arr: T): T => {
          const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
          for (let i = 0; i < bytes.length; i += 1) {
            bytes[i] = (i * 37 + 13) % 256;
          }
          return arr;
        }),
      randomUUID: () => {
        uuidSeq += 1;
        const suffix = String(uuidSeq).padStart(12, '0');
        return `00000000-0000-4000-8000-${suffix}` as `${string}-${string}-${string}-${string}-${string}`;
      },
    };
    Object.defineProperty(globalThis, 'crypto', {
      writable: true,
      configurable: true,
      value: mockCrypto,
    });
  }

  // Register deterministic in-memory IndexedDB mock when JSDOM lacks it
  if (typeof globalThis.indexedDB === 'undefined') {
    mockIndexedDbInstance = createMockIndexedDB();
    Object.defineProperty(globalThis, 'indexedDB', {
      writable: true,
      configurable: true,
      value: mockIndexedDbInstance,
    });
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', createDefaultApiFetchMock());
  });
}

afterEach(() => {
  cleanup();
  if (typeof window !== 'undefined') {
    window.localStorage?.clear();
    window.sessionStorage?.clear();
    mockIndexedDbInstance?._resetAll();
    vi.unstubAllGlobals();
  }
});
