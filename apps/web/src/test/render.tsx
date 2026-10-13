import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { App } from '../app.js';
import type { Auth } from '../auth/auth.js';

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

/** Renders the whole app, as a user would see it, against the MSW fake API. */
export function renderApp(auth: Auth = fakeAuth()) {
  return { user: userEvent.setup(), ...render(<App auth={auth} />) };
}
