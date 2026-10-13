import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { authenticate } from './auth/authenticate.js';
import type { TokenVerifier } from './auth/token-verifier.js';
import { healthRouter } from './health/health-routes.js';
import { errorHandler, notFound } from './http/error-handler.js';
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
  app.use('/api/me', signedIn, meRouter());
  app.use('/api/notes', signedIn, notesRouter(deps.notes));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
