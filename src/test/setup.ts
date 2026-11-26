import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

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

  beforeEach(() => {
    vi.stubGlobal('fetch', createDefaultApiFetchMock());
  });
}

afterEach(() => {
  cleanup();
  if (typeof window !== 'undefined') {
    vi.unstubAllGlobals();
  }
});
