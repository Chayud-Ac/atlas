import { createRemoteJWKSet } from 'jose';
import { Pool } from 'pg';
import { createApp } from './app.js';
import { discoverJwksUri } from './auth/discovery.js';
import { createTokenVerifier } from './auth/token-verifier.js';
import { loadApiConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { managedIdentityTokens } from './db/entra-token.js';
import { createPgUnitOfWork } from './db/pg-unit-of-work.js';
import { poolConfig, type TokenProvider } from './db/pool.js';
import { createLogger } from './logger.js';
import { createNotesService } from './notes/notes-service.js';
import { createPgUsersRepository } from './users/pg-users-repository.js';

const config = loadApiConfig(process.env);
const logger = createLogger(config.logLevel);

const tokens: TokenProvider =
  config.db.auth === 'entra'
    ? managedIdentityTokens(config.db.clientId)
    : () => Promise.reject(new Error('Entra tokens are not used with password auth'));
const pool = new Pool(poolConfig(config.db, tokens));
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
