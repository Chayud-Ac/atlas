import type { Request } from 'express';

/** The signed-in caller, attached by the authenticate middleware. */
export interface AuthContext {
  userId: string;
  oid: string;
  tid: string;
  roles: string[];
  name: string | null;
  email: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

/** The signed-in caller. Throws if a route forgot the authenticate middleware. */
export function authOf(req: Request): AuthContext {
  if (!req.auth) throw new Error('authOf() called on a route without the authenticate middleware');
  return req.auth;
}
