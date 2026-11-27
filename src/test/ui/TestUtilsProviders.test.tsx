import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders, screen, waitFor } from '../test-utils.ts';
import { useAppState } from '../../context/AppStateContext.tsx';
import { useApp } from '../../context/AppContext.tsx';
import { saveOfflineSnapshot, loadOfflineSnapshot } from '../../services/offlineDb.ts';

const ProviderProbe: React.FC = () => {
  const { settings } = useAppState();
  const { authChecked, supplyCategories } = useApp();

  return (
    <div>
      <span data-testid="brand-name">{settings.branding.businessName}</span>
      <span data-testid="auth-checked">{String(authChecked)}</span>
      <span data-testid="supply-cat-count">{supplyCategories.length}</span>
    </div>
  );
};

describe('test-utils & global setup mocks', () => {
  it('renders components wrapped in AppStateProvider and AppProvider with initialSettings', async () => {
    renderWithProviders(<ProviderProbe />, {
      initialSettings: {
        branding: {
          appName: 'Printshop POS',
          businessName: 'Cyan Studio Test',
          tagline: 'Test Tagline',
          receiptHeader: 'Cyan Studio Test',
          receiptFooter: 'Thanks',
        },
      },
    });

    expect(screen.getByTestId('brand-name')).toHaveTextContent('Cyan Studio Test');
    await waitFor(() => {
      expect(screen.getByTestId('auth-checked')).toHaveTextContent('true');
    });
    expect(Number(screen.getByTestId('supply-cat-count').textContent)).toBeGreaterThan(0);
  });

  it('provides working crypto and IndexedDB mocks in JSDOM', async () => {
    const uuid = globalThis.crypto.randomUUID();
    expect(uuid).toMatch(/^[0-9a-f-]{36}$/i);

    await saveOfflineSnapshot('probe-key', { ok: true, count: 42 });
    const loaded = await loadOfflineSnapshot<{ ok: boolean; count: number }>('probe-key');
    expect(loaded).toEqual({ ok: true, count: 42 });
  });
});
