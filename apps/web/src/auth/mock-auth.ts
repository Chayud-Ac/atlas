import { z } from 'zod';
import type { AuthSettings } from '../config.js';
import { type Auth, untilNavigation } from './auth.js';

const STORAGE_KEY = 'atlas.mock-token';
/** Renew a minute early, so a token never expires between reading it and using it. */
const EXPIRY_MARGIN_MS = 60_000;

const TokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});
const StoredToken = z.object({ accessToken: z.string(), expiresAt: z.number() });

export interface MockAuthDeps {
  storage: Storage;
  reload: () => void;
  now: () => number;
}

/**
 * Sign-in for `env` local and ci, against the mock OIDC server in compose.yaml.
 * MSAL refuses non-https authorities, so this asks the mock's token endpoint
 * directly. The API still validates every token, and its issuer guard rejects
 * the mock issuer in dev, uat and prod (ADR 0007).
 */
export function createMockAuth(settings: AuthSettings, deps: MockAuthDeps = browserDeps()): Auth {
  const { storage, reload, now } = deps;

  function storedToken(): string | null {
    try {
      const stored = StoredToken.parse(JSON.parse(storage.getItem(STORAGE_KEY) ?? ''));
      return stored.expiresAt > now() ? stored.accessToken : null;
    } catch {
      return null;
    }
  }

  async function signIn(): Promise<void> {
    const response = await fetch(`${settings.authority.replace(/\/$/, '')}/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: settings.clientId,
        client_secret: 'not-a-secret', // the mock requires one and accepts any value
        scope: settings.apiScope,
      }),
    });
    if (!response.ok) throw new Error(`Mock sign-in failed with ${response.status}`);
    const token = TokenResponse.parse(await response.json());
    const expiresAt = now() + token.expires_in * 1000 - EXPIRY_MARGIN_MS;
    storage.setItem(STORAGE_KEY, JSON.stringify({ accessToken: token.access_token, expiresAt }));
    reload();
  }

  return {
    isSignedIn: storedToken() !== null,
    signIn,
    signOut: () => {
      storage.removeItem(STORAGE_KEY);
      reload();
      return Promise.resolve();
    },
    getAccessToken: async () => {
      const token = storedToken();
      if (token) return token;
      await signIn();
      return untilNavigation();
    },
  };
}

function browserDeps(): MockAuthDeps {
  return {
    storage: sessionStorage,
    reload: () => {
      window.location.reload();
    },
    now: () => Date.now(),
  };
}
