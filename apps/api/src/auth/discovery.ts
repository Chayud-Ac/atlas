import { z } from 'zod';

const OpenIdConfiguration = z.object({ issuer: z.string(), jwks_uri: z.url() });

/** Finds the issuer's signing-key endpoint. Refuses a document that names a different issuer. */
export async function discoverJwksUri(
  issuer: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const url = `${issuer}/.well-known/openid-configuration`;
  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`OIDC discovery failed: ${url} returned ${response.status}`);
  const config = OpenIdConfiguration.parse(await response.json());
  if (config.issuer !== issuer) {
    throw new Error(`OIDC discovery issuer mismatch: expected ${issuer}, got ${config.issuer}`);
  }
  return config.jwks_uri;
}
