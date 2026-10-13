import { CurrentUser } from '@atlas/shared';
import { Router } from 'express';
import { authOf } from '../auth/authenticate.js';

/** Mounted at /api/users. `GET /me` is a base feature that every app keeps. */
export function usersRouter(): Router {
  const router = Router();

  router.get('/me', (req, res) => {
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
