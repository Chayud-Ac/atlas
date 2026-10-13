import { createRemoteJWKSet } from 'jose';
import { Pool } from 'pg';
import { createApp } from './app.js';
import { createTokenVerifier, discoverJwksUri } from './auth/tokens.js';
import { loadApiConfig } from './config.js';
import { createDatabase, createPgUnitOfWork, poolConfig, tokenProviderFor } from './db/database.js';
import { createLogger } from './logging.js';
import { createNotesService } from './notes/notes.service.js';
import { createPgUsersRepository } from './users/users.repository.js';

const config = loadApiConfig(process.env);
const logger = createLogger(config.logLevel);

const pool = new Pool(poolConfig(config.db, tokenProviderFor(config.db)));
const db = createDatabase(pool);

const jwksUri = config.oidc.jwksUri ?? (await discoverJwksUri(config.oidc.issuer));

const app = createApp({
  version: config.version,
  requiredScope: config.oidc.requiredScope,
  logger,
  verifier: createTokenVerifier({
    issuer: config.oidc.issuer,
    audience: config.oidc.audience,
    getKey: createRemoteJWKSet(new URL(jwksUri)),
  }),
  users: createPgUsersRepository(db),
  notes: createNotesService(createPgUnitOfWork(db)),
  checkDatabase: async () => {
    await pool.query('SELECT 1');
  },
});

const server = app.listen(config.port, (error) => {
  if (error) {
    logger.fatal({ err: error }, 'failed to start');
    process.exit(1);
  }
  logger.info(
    { port: config.port, env: config.env, version: config.version },
    'atlas api listening',
  );
});

// Container Apps sends SIGTERM before stopping a replica: finish in-flight requests, then close the pool.
function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
