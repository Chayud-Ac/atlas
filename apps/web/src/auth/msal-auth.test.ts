import {
  type AccountInfo,
  type AuthenticationResult,
  InteractionRequiredAuthError,
} from '@azure/msal-browser';
import { describe, expect, it, vi } from 'vitest';
import { createMsalAuth, type MsalClient } from './msal-auth.js';

const SCOPE = 'api://api-client-id/access_as_user';
const account: AccountInfo = {
  homeAccountId: 'home-account-id',
  environment: 'login.microsoftonline.com',
  tenantId: 'tenant-id',
  username: 'ada@example.com',
  localAccountId: 'local-account-id',
};

function tokenResult(accessToken: string) {
  return { accessToken, account } as AuthenticationResult;
}

/** A fake MSAL. The spies are returned separately, so assertions never touch unbound methods. */
function fakeMsal(overrides: Partial<MsalClient> = {}) {
  const spies = {
    loginRedirect: vi.fn(() => Promise.resolve()),
    logoutRedirect: vi.fn(() => Promise.resolve()),
    acquireTokenRedirect: vi.fn(() => Promise.resolve()),
    setActiveAccount: vi.fn(),
  };
  const msal: MsalClient = {
    handleRedirectPromise: () => Promise.resolve(null),
    getAllAccounts: () => [],
    acquireTokenSilent: () => Promise.resolve(tokenResult('silent-token')),
    ...spies,
    ...overrides,
  };
  return { msal, ...spies };
}

describe('createMsalAuth', () => {
  it('is signed in after coming back from a sign-in redirect', async () => {
    const { msal, setActiveAccount } = fakeMsal({
      handleRedirectPromise: () => Promise.resolve(tokenResult('from-redirect')),
    });

    const auth = await createMsalAuth(msal, SCOPE);

    expect(auth.isSignedIn).toBe(true);
    expect(setActiveAccount).toHaveBeenCalledWith(account);
  });

  it('is signed in with an account cached from an earlier visit', async () => {
    const { msal } = fakeMsal({ getAllAccounts: () => [account] });
    expect((await createMsalAuth(msal, SCOPE)).isSignedIn).toBe(true);
  });

  it('is signed out with no account', async () => {
    const { msal, loginRedirect } = fakeMsal();
    const auth = await createMsalAuth(msal, SCOPE);

    expect(auth.isSignedIn).toBe(false);
    void auth.getAccessToken();
    await vi.waitFor(() => {
      expect(loginRedirect).toHaveBeenCalledWith({ scopes: [SCOPE] });
    });
  });

  it('gets the API token silently', async () => {
    const acquireTokenSilent = vi.fn(() => Promise.resolve(tokenResult('silent-token')));
    const { msal } = fakeMsal({ getAllAccounts: () => [account], acquireTokenSilent });
    const auth = await createMsalAuth(msal, SCOPE);

    await expect(auth.getAccessToken()).resolves.toBe('silent-token');
    expect(acquireTokenSilent).toHaveBeenCalledWith({ scopes: [SCOPE], account });
  });

  it('redirects when Entra needs the user, e.g. for MFA', async () => {
    const { msal, acquireTokenRedirect } = fakeMsal({
      getAllAccounts: () => [account],
      acquireTokenSilent: () =>
        Promise.reject(new InteractionRequiredAuthError('interaction_required', 'correlation-id')),
    });
    const auth = await createMsalAuth(msal, SCOPE);

    void auth.getAccessToken();

    await vi.waitFor(() => {
      expect(acquireTokenRedirect).toHaveBeenCalledWith({ scopes: [SCOPE], account });
    });
  });

  it('passes other token errors on', async () => {
    const { msal } = fakeMsal({
      getAllAccounts: () => [account],
      acquireTokenSilent: () => Promise.reject(new Error('network down')),
    });
    const auth = await createMsalAuth(msal, SCOPE);

    await expect(auth.getAccessToken()).rejects.toThrow('network down');
  });

  it('signs in and out with redirects', async () => {
    const { msal, loginRedirect, logoutRedirect } = fakeMsal({ getAllAccounts: () => [account] });
    const auth = await createMsalAuth(msal, SCOPE);

    await auth.signIn();
    await auth.signOut();

    expect(loginRedirect).toHaveBeenCalledWith({ scopes: [SCOPE] });
    expect(logoutRedirect).toHaveBeenCalledWith({ account });
  });
});
