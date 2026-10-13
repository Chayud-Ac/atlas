import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { App } from '@/app/app';
import { AppProviders } from '@/app/providers';
import type { Auth } from '@/lib/auth/auth-context';

/** A signed-in user unless overridden. signIn and signOut are spies. */
export function fakeAuth(overrides: Partial<Auth> = {}) {
  return {
    isSignedIn: true,
    signIn: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
    getAccessToken: vi.fn(() => Promise.resolve('test-token')),
    ...overrides,
  };
}

/** Renders the whole app as main.tsx does, against the fake API in mock-api.ts. */
export function renderApp(auth: Auth = fakeAuth()) {
  return {
    user: userEvent.setup(),
    ...render(
      <AppProviders auth={auth}>
        <App />
      </AppProviders>,
    ),
  };
}
