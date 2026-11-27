import React from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { vi } from 'vitest';
import { APP_STATE_STORAGE_KEY, AppStateProvider, mergeSettingsWithDefaults } from '../context/AppStateContext.tsx';
import { AppProvider } from '../context/AppContext.tsx';
import type { AppSettings, BrandingConfig, DesignTokens } from '../shared/types.ts';

export type InitialTestSettings = Partial<
  Omit<AppSettings, 'branding' | 'tokens' | 'posLayout' | 'receiptTemplate' | 'taxAndCurrency' | 'shellPreferences'>
> & {
  branding?: Partial<BrandingConfig>;
  tokens?: Partial<DesignTokens>;
  posLayout?: Partial<AppSettings['posLayout']>;
  receiptTemplate?: Partial<AppSettings['receiptTemplate']>;
  taxAndCurrency?: Partial<AppSettings['taxAndCurrency']>;
  shellPreferences?: Partial<NonNullable<AppSettings['shellPreferences']>>;
};

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Optional partial settings seeded into localStorage before mounting AppStateProvider. */
  initialSettings?: InitialTestSettings;
  /** Optional custom global fetch mock installed before rendering. */
  fetchMock?: typeof fetch;
}

export interface RenderWithProvidersResult extends RenderResult {
  user: UserEvent;
}

export const GlobalTestProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return React.createElement(
    AppStateProvider,
    null,
    React.createElement(AppProvider, null, children),
  );
};

/**
 * Renders a UI component wrapped in AppStateProvider and AppProvider,
 * returning standard React Testing Library helpers plus a configured userEvent instance.
 */
export function renderWithProviders(
  ui: React.ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  const { initialSettings, fetchMock, ...renderOptions } = options;

  if (initialSettings && typeof window !== 'undefined' && window.localStorage) {
    const merged = mergeSettingsWithDefaults(initialSettings as Partial<AppSettings>);
    window.localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(merged));
  }

  if (fetchMock) {
    vi.stubGlobal('fetch', fetchMock);
  }

  const user = userEvent.setup();
  const result = render(ui, {
    wrapper: GlobalTestProviders,
    ...renderOptions,
  });

  return {
    ...result,
    user,
  };
}

export * from '@testing-library/react';
export { userEvent };
