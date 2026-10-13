import { jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';

/**
 * The access-token claims Atlas relies on; everything else in the token is ignored.
 * `oid`/`tid` use z.guid(): Entra GUIDs aren't guaranteed to carry RFC 9562 version bits.
 */
export const AccessTokenClaims = z.object({
  oid: z.guid(),
  tid: z.guid(),
  scp: z.string().optional(),
  roles: z.array(z.string()).optional(),
  name: z.string().optional(),
  email: z.string().optional(),
  preferred_username: z.string().optional(),
});
export type AccessTokenClaims = z.infer<typeof AccessTokenClaims>;

export interface TokenVerifier {
  /** Resolves with the token's claims, or rejects if the token is invalid in any way. */
  verify(token: string): Promise<AccessTokenClaims>;
}

export interface TokenVerifierOptions {
  issuer: string;
  audience: string;
  /** Production: createRemoteJWKSet(jwksUri). Tests: createLocalJWKSet(...). */
  getKey: JWTVerifyGetKey;
}

export function createTokenVerifier({
  issuer,
  audience,
  getKey,
}: TokenVerifierOptions): TokenVerifier {
  return {
    async verify(token) {
      const { payload } = await jwtVerify(token, getKey, {
        issuer,
        audience,
        algorithms: ['RS256'],
        clockTolerance: 5,
      });
      return AccessTokenClaims.parse(payload);
    },
  };
}

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
