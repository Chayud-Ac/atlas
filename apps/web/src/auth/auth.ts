import { createContext, use } from 'react';

/**
 * What the app needs from sign-in. Components and tests use this, never MSAL,
 * so the identity provider can change without touching them (spec §6.3).
 * Members are function-valued properties, so they can be passed around unbound.
 */
export interface Auth {
  /** Known at startup: signing in and out both leave the page and come back. */
  readonly isSignedIn: boolean;
  readonly signIn: () => Promise<void>;
  readonly signOut: () => Promise<void>;
  /** A bearer token for the API. Starts sign-in again when none can be had silently. */
  readonly getAccessToken: () => Promise<string>;
}

export const AuthContext = createContext<Auth | null>(null);

export function useAuth(): Auth {
  const auth = use(AuthContext);
  if (!auth) throw new Error('useAuth() must be used inside <AuthContext value={auth}>');
  return auth;
}

/**
 * Returned while the browser leaves the page to sign in. It never settles,
 * so nothing renders an error in the moment before the page unloads.
 */
export function untilNavigation(): Promise<never> {
  return new Promise<never>(() => undefined);
}
