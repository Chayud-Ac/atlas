import { ManagedIdentityCredential } from '@azure/identity';
import type { TokenProvider } from './pool.js';

/** Tokens for the container app's user-assigned identity. The credential caches them until near expiry. */
export function managedIdentityTokens(clientId: string): TokenProvider {
  const credential = new ManagedIdentityCredential({ clientId });
  return async (scope) => (await credential.getToken(scope)).token;
}
