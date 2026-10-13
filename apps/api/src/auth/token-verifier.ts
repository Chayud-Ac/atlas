import { jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AccessTokenClaims } from './claims.js';

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
