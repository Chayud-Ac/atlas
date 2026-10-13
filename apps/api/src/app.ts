import express, { type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { authenticate, authOf } from './auth/authenticate.js';
import type { TokenVerifier } from './auth/tokens.js';
import { errorHandler, HttpError, notFound } from './errors.js';
import { healthRouter } from './health/health.routes.js';
import { genReqId, type Logger } from './logging.js';
import { notesRouter } from './notes/notes.routes.js';
import type { NotesService } from './notes/notes.service.js';
import type { UsersRepository } from './users/users.repository.js';
import { usersRouter } from './users/users.routes.js';

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
  /** All callers together, per replica, checked before authentication. Defaults to 3000. */
  replicaRateLimitPerMinute?: number;
}

const tooManyRequests = new HttpError(429, 'Too many requests. Try again in a minute.');

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

  // Two layers of rate limiting. Edge limiting (Front Door/APIM) is excluded on cost (spec §17).
  // Neither is keyed by IP: browser traffic arrives through the web app's nginx, so every
  // user shares one IP.
  // 1. Replica circuit breaker, before authentication: token verification and the user
  //    upsert are real work, so a flood of junk tokens must be capped before reaching them.
  const replicaLimit = rateLimit({
    windowMs: 60_000,
    limit: deps.replicaRateLimitPerMinute ?? 3000,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: () => 'replica',
    handler: (_req, _res, next) => {
      next(tooManyRequests);
    },
  });
  const signedIn = authenticate({
    verifier: deps.verifier,
    requiredScope: deps.requiredScope,
    users: deps.users,
  });
  // 2. Per-user fairness, after authentication: one heavy user can't starve the others.
  const perUserLimit = rateLimit({
    windowMs: 60_000,
    limit: deps.rateLimitPerMinute ?? 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => authOf(req).userId,
    handler: (_req, _res, next) => {
      next(tooManyRequests);
    },
  });
  app.use('/api/users', replicaLimit, signedIn, perUserLimit, usersRouter());
  app.use('/api/notes', replicaLimit, signedIn, perUserLimit, notesRouter(deps.notes));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
