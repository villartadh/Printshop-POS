import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App.tsx';
import {
  DEFAULT_SETTINGS,
  DEFAULT_SUPPLY_CATEGORIES,
  DEMO_CATEGORIES,
  DEMO_INVENTORY,
  DEMO_SERVICES,
  DEMO_STOCK_MOVEMENTS,
  DEMO_SUPPLIERS,
} from '../../shared/defaults.ts';
import type { Transaction, UserAccount } from '../../shared/types.ts';

function jsonResponse(body: unknown, status = 200): Response {
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

interface StatefulApiOptions {
  failFirstBootstrap?: boolean;
  needsSetup?: boolean;
}

function createStatefulAppFetch(options: StatefulApiOptions = {}) {
  let needsSetup = options.needsSetup ?? true;
  let bootstrapFailsRemaining = options.failFirstBootstrap ? 1 : 0;
  let adminUser: UserAccount = {
    id: 'usr-admin-1',
    username: 'owner',
    fullName: 'Maria Santos',
    email: 'maria@printshop.local',
    role: 'admin',
    hasPin: true,
    isActive: true,
    preferredLandingModule: 'pos',
    createdAt: new Date().toISOString(),
  };
  const transactions: Transaction[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const pathname = rawUrl.split('?')[0];
    const method = (init?.method || 'GET').toUpperCase();
    const rawBody = typeof init?.body === 'string' ? init.body : undefined;
    const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : undefined;

    if (pathname.endsWith('/api/auth/status')) {
      return jsonResponse({
        needsSetup,
        quickUsers: needsSetup
          ? []
          : [
              {
                id: adminUser.id,
                username: adminUser.username,
                fullName: adminUser.fullName,
                role: adminUser.role,
                hasPin: true,
              },
            ],
      });
    }

    if (pathname.endsWith('/api/auth/setup-admin') && method === 'POST') {
      needsSetup = false;
      adminUser = {
        ...adminUser,
        username: String(body?.username || 'owner'),
        fullName: String(body?.fullName || 'Maria Santos'),
        email: String(body?.email || ''),
        hasPin: Boolean(String(body?.pin || '').trim()),
      };
      return jsonResponse(
        {
          token: 'ux-session-token-1',
          user: adminUser,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
        201,
      );
    }

    if (pathname.endsWith('/api/auth/pin-login') && method === 'POST') {
      if (String(body?.pin || '') !== '1234') {
        return jsonResponse({ error: 'Invalid PIN code.' }, 401);
      }
      return jsonResponse({
        token: 'ux-session-token-2',
        user: adminUser,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
    }

    if (pathname.endsWith('/api/bootstrap')) {
      if (bootstrapFailsRemaining > 0) {
        bootstrapFailsRemaining -= 1;
        return jsonResponse({ error: 'Temporary database connection error.' }, 503);
      }
      return jsonResponse({
        settings: DEFAULT_SETTINGS,
        categories: DEMO_CATEGORIES,
        supplyCategories: DEFAULT_SUPPLY_CATEGORIES,
        services: DEMO_SERVICES,
        inventory: DEMO_INVENTORY,
        suppliers: DEMO_SUPPLIERS,
        supplierDocuments: [],
        stockMovements: DEMO_STOCK_MOVEMENTS,
        customers: [],
        transactions,
        printJobs: [],
        expenses: [],
        shifts: [],
        users: [adminUser],
        auditLogs: [],
        serverTime: new Date().toISOString(),
      });
    }

    if (pathname.endsWith('/api/transactions') && method === 'POST') {
      const txn = {
        ...(body as unknown as Transaction),
        id: `txn_ux_${transactions.length + 1}`,
        receiptNumber: `OR-UX-00${transactions.length + 1}`,
        syncStatus: 'synced' as const,
      };
      transactions.unshift(txn);
      return jsonResponse({ transaction: txn, duplicate: false }, 201);
    }

    if (pathname.endsWith('/api/alerts/critical-events')) {
      return jsonResponse({ events: [], activeCount: 0, serverTime: new Date().toISOString() });
    }

    return jsonResponse({ ok: true });
  });

  return { fetchMock, transactions };
}

describe('Overall Application User Experience (UX)', () => {
  it('completes first-run setup, POS sale checkout, global search, module navigation, and terminal PIN lock/unlock', async () => {
    const { fetchMock, transactions } = createStatefulAppFetch({ needsSetup: true });
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });

    const user = userEvent.setup();
    render(<App />);

    // 1. First-run administrator setup
    expect(await screen.findByText('First-Run Store Setup')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Full Name'), 'Maria Santos');
    await user.type(screen.getByLabelText('Username'), 'maria');
    await user.type(screen.getByLabelText('Email (Optional)'), 'maria@printshop.local');
    await user.type(screen.getByLabelText('Password (6+ characters)'), 'secret123');
    await user.type(screen.getByLabelText('Quick Cashier PIN (Optional, 4–6 digits)'), '1234');
    await user.click(screen.getByRole('button', { name: /Create Admin & Open POS/i }));

    // 2. POS workspace loads with seeded services
    const firstService = DEMO_SERVICES[0];
    expect(await screen.findByText(firstService.name)).toBeInTheDocument();

    // 3. Click service -> open configurator if required -> add to cart
    await user.click(screen.getByText(firstService.name));
    if (firstService.requiresConfiguration) {
      const addOrderBtn = await screen.findByRole('button', { name: /Add to Order/i });
      await user.click(addOrderBtn);
    }

    expect(screen.getByText(/Current order \(1\)/i)).toBeInTheDocument();

    // 4. Open checkout and complete full cash payment
    await user.click(screen.getByRole('button', { name: /Receive payment/i }));
    expect(await screen.findByText('Receive Payment')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Complete Payment/i }));

    // 5. Receipt preview opens & toast confirms sale
    expect(await screen.findByText('Document & Receipt Preview')).toBeInTheDocument();
    expect(transactions).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Close' }));

    // 6. Ctrl+K opens Global Search and navigates cleanly to Suppliers
    await user.keyboard('{Control>}k{/Control}');
    expect(await screen.findByRole('dialog', { name: /Global workspace search/i })).toBeInTheDocument();
    const searchBox = screen.getByPlaceholderText(/Jump to module, service, customer/i);
    await user.type(searchBox, 'Supplier Management');
    await user.click(screen.getByText('Supplier Management', { selector: 'div' }));
    expect(await screen.findByRole('tab', { name: /Directory & Analytics/i })).toBeInTheDocument();

    // 7. Desktop Sidebar navigates to Inventory Management
    await user.click(screen.getByRole('button', { name: 'Inventory Management' }));
    expect(await screen.findByText(/Low & Out-of-Stock Alerts/i)).toBeInTheDocument();

    // 8. Lock Terminal -> invalid PIN shows clear error -> valid PIN unlocks
    await user.click(screen.getByRole('button', { name: /Lock Terminal \/ Switch User/i }));
    expect(await screen.findByText('Terminal Locked')).toBeInTheDocument();

    const pinInput = screen.getByLabelText('PIN');
    await user.type(pinInput, '9999');
    await user.click(screen.getByRole('button', { name: /Unlock Terminal/i }));
    expect(await screen.findByText(/Invalid PIN code/i)).toBeInTheDocument();

    await user.clear(screen.getByLabelText('PIN'));
    await user.type(screen.getByLabelText('PIN'), '1234');
    await user.click(screen.getByRole('button', { name: /Unlock Terminal/i }));
    await waitFor(() => {
      expect(screen.queryByText('Terminal Locked')).not.toBeInTheDocument();
    });
  });

  it('adapts cleanly to mobile viewports (<768px) with bottom navigation and More sheet', async () => {
    const { fetchMock } = createStatefulAppFetch({ needsSetup: true });
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 });

    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText('Full Name'), 'Mobile Operator');
    await user.type(screen.getByLabelText('Username'), 'mobile');
    await user.type(screen.getByLabelText('Password (6+ characters)'), 'secret123');
    await user.click(screen.getByRole('button', { name: /Create Admin & Open POS/i }));

    // Mobile bottom navigation + floating cart bar appear instead of desktop sidebar
    expect(await screen.findByRole('navigation', { name: 'Mobile navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View cart · 0 item\(s\)/i })).toBeInTheDocument();

    // Open More bottom sheet and navigate to Cashier Shifts
    await user.click(screen.getByRole('button', { name: 'More modules and preferences' }));
    expect(await screen.findByText('All Modules & Display')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cashier Shifts' }));
    expect(await screen.findByRole('button', { name: /Open Cashier Shift/i })).toBeInTheDocument();
  });

  it('displays recoverable ErrorState when initial store data fails and recovers on Retry', async () => {
    const { fetchMock } = createStatefulAppFetch({
      needsSetup: true,
      failFirstBootstrap: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });

    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText('Full Name'), 'Retry Admin');
    await user.type(screen.getByLabelText('Username'), 'retryadmin');
    await user.type(screen.getByLabelText('Password (6+ characters)'), 'secret123');
    await user.click(screen.getByRole('button', { name: /Create Admin & Open POS/i }));

    // First bootstrap call returns 503 -> ErrorState shows actionable message + Retry button
    expect(await screen.findByText(/Temporary database connection error/i)).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: /Try Again|Retry/i });
    await user.click(retryBtn);

    // Second bootstrap call succeeds -> POS service cards appear
    expect(await screen.findByText(DEMO_SERVICES[0].name)).toBeInTheDocument();
  });
});
