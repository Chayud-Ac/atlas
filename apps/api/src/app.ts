import express, { type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { authOf } from './auth/auth-context.js';
import { authenticate } from './auth/authenticate.js';
import type { TokenVerifier } from './auth/token-verifier.js';
import { healthRouter } from './health/health-routes.js';
import { errorHandler, notFound } from './http/error-handler.js';
import { HttpError } from './http/http-error.js';
import { genReqId } from './http/request-id.js';
import type { Logger } from './logger.js';
import { notesRouter } from './notes/notes-routes.js';
import type { NotesService } from './notes/notes-service.js';
import { meRouter } from './users/me-routes.js';
import type { UsersRepository } from './users/user.js';

export interface AppDependencies {
  version: string;
  requiredScope: string;
  logger: Logger;
  verifier: TokenVerifier;
  users: UsersRepository;
  notes: NotesService;
  checkDatabase: () => Promise<void>;
  /** Per signed-in user, per replica. Defaults to 300. */
  rateLimitPerMinute?: number;
}

/** Builds the Express app from its dependencies. No I/O happens here, so tests can inject fakes. */
export function createApp(deps: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(pinoHttp({ logger: deps.logger, genReqId }));
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));

  app.use(
    '/api/health',
    healthRouter({ version: deps.version, checkDatabase: deps.checkDatabase }),
  );

  const signedIn = authenticate({
    verifier: deps.verifier,
    requiredScope: deps.requiredScope,
    users: deps.users,
  });
  // Keyed by user, not IP: every browser request arrives through the web app's nginx,
  // so all users share one IP. Edge rate limiting (Front Door/APIM) is excluded on cost (spec §17).
  const perUserLimit = rateLimit({
    windowMs: 60_000,
    limit: deps.rateLimitPerMinute ?? 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => authOf(req).userId,
    handler: (_req, _res, next) => {
      next(new HttpError(429, 'Too many requests. Try again in a minute.'));
    },
  });
  app.use('/api/me', signedIn, perUserLimit, meRouter());
  app.use('/api/notes', signedIn, perUserLimit, notesRouter(deps.notes));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
