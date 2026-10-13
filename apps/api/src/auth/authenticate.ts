import type { RequestHandler } from 'express';
import { HttpError } from '../http/http-error.js';
import type { UserIdentity, UsersRepository } from '../users/user.js';
import type { AccessTokenClaims } from './claims.js';
import type { TokenVerifier } from './token-verifier.js';

export interface AuthenticateOptions {
  verifier: TokenVerifier;
  /** Every endpoint requires this delegated scope (spec §6.3: `access_as_user`). */
  requiredScope: string;
  users: UsersRepository;
}

/** Bearer token → verified claims → scope check → just-in-time user → `req.auth`. */
export function authenticate({
  verifier,
  requiredScope,
  users,
}: AuthenticateOptions): RequestHandler {
  return async (req, _res, next) => {
    const token = bearerToken(req.headers.authorization);
    if (!token) {
      throw new HttpError(401, 'Sign in required: send "Authorization: Bearer <access token>".');
    }
    const claims = await verifyOr401(verifier, token);
    const scopes = claims.scp?.split(' ') ?? [];
    if (!scopes.includes(requiredScope)) {
      throw new HttpError(403, `The access token is missing the "${requiredScope}" scope.`);
    }
    const user = await users.upsertFromIdentity(identityOf(claims));
    req.auth = {
      userId: user.id,
      oid: claims.oid,
      tid: claims.tid,
      roles: claims.roles ?? [],
      name: user.displayName,
      email: user.email,
    };
    next();
  };
}

function bearerToken(header: string | undefined): string | undefined {
  return /^Bearer (\S+)$/i.exec(header ?? '')?.[1];
}

async function verifyOr401(verifier: TokenVerifier, token: string): Promise<AccessTokenClaims> {
  try {
    return await verifier.verify(token);
  } catch {
    throw new HttpError(401, 'The access token is invalid or expired.');
  }
}

function identityOf(claims: AccessTokenClaims): UserIdentity {
  return {
    entraTenantId: claims.tid,
    entraObjectId: claims.oid,
    email: claims.email ?? claims.preferred_username ?? null,
    displayName: claims.name ?? null,
  };
}
