import { CurrentUser } from '@atlas/shared';
import { Router } from 'express';
import { authOf } from '../auth/auth-context.js';

/** GET /api/me: the signed-in user. A base feature that every app keeps. */
export function meRouter(): Router {
  const router = Router();
  router.get('/', (req, res) => {
    const auth = authOf(req);
    // Parsing the response guarantees the contract, and that nothing extra leaks out.
    res.json(
      CurrentUser.parse({
        id: auth.userId,
        displayName: auth.name,
        email: auth.email,
        roles: auth.roles,
      }),
    );
  });
  return router;
}
