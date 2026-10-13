import {
  createStandardPublicClientApplication,
  InteractionRequiredAuthError,
  type IPublicClientApplication,
} from '@azure/msal-browser';
import type { AuthSettings } from '@/lib/config';
import { type Auth, untilNavigation } from './auth-context';

/** The part of MSAL this app uses. Tests pass a fake with just these. */
export type MsalClient = Pick<
  IPublicClientApplication,
  | 'handleRedirectPromise'
  | 'getAllAccounts'
  | 'setActiveAccount'
  | 'loginRedirect'
  | 'logoutRedirect'
  | 'acquireTokenSilent'
  | 'acquireTokenRedirect'
>;

/**
 * MSAL for Entra ID. Redirects come back to the site root, which is what the
 * atlas-{env}-web registration lists (spec §6.3). Tokens are cached in
 * sessionStorage (MSAL's default), so they're gone when the tab closes.
 */
export function createMsalClient(settings: AuthSettings): Promise<IPublicClientApplication> {
  return createStandardPublicClientApplication({
    auth: {
      clientId: settings.clientId,
      authority: settings.authority,
      redirectUri: window.location.origin,
      postLogoutRedirectUri: window.location.origin,
    },
  });
}

/**
 * Sign-in with Entra ID through redirects. Call once at startup: it completes a
 * redirect that just brought the browser back, then reports who is signed in.
 */
export async function createMsalAuth(msal: MsalClient, apiScope: string): Promise<Auth> {
  const result = await msal.handleRedirectPromise();
  const account = result?.account ?? msal.getAllAccounts()[0] ?? null;
  msal.setActiveAccount(account);
  const scopes = [apiScope];

  async function signIn(): Promise<void> {
    await msal.loginRedirect({ scopes });
  }

  return {
    isSignedIn: account !== null,
    signIn,
    signOut: async () => {
      await msal.logoutRedirect({ account });
    },
    getAccessToken: async () => {
      if (!account) {
        await signIn();
        return untilNavigation();
      }
      try {
        // From MSAL's cache, renewed silently with the refresh token when it nears expiry.
        const { accessToken } = await msal.acquireTokenSilent({ scopes, account });
        return accessToken;
      } catch (error) {
        // The user must act: the session expired, or conditional access wants MFA.
        if (!(error instanceof InteractionRequiredAuthError)) throw error;
        await msal.acquireTokenRedirect({ scopes, account });
        return untilNavigation();
      }
    },
  };
}
