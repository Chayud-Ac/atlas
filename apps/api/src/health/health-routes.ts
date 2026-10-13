import { Router } from 'express';
import { HttpError } from '../http/http-error.js';

export interface HealthOptions {
  /** The git SHA of the running build (APP_VERSION); the smoke test compares it. */
  version: string;
  checkDatabase: () => Promise<void>;
}

/** Liveness and readiness probes for Container Apps. No authentication. */
export function healthRouter({ version, checkDatabase }: HealthOptions): Router {
  const router = Router();

  router.get('/live', (_req, res) => {
    res.json({ status: 'ok', version });
  });

  router.get('/ready', async (req, res) => {
    try {
      await checkDatabase();
    } catch (err) {
      req.log.warn({ err }, 'readiness check failed');
      throw new HttpError(503, 'The database is not reachable.');
    }
    res.json({ status: 'ok' });
  });

  return router;
}
