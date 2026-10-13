import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { loadMigratorConfig } from './config.js';
import { managedIdentityTokens } from './db/entra-token.js';
import { runMigrationJob } from './db/migration-job.js';
import { poolConfig, type TokenProvider } from './db/pool.js';
import { createLogger } from './logger.js';

const config = loadMigratorConfig(process.env);
const logger = createLogger(config.logLevel);

const tokens: TokenProvider =
  config.db.auth === 'entra'
    ? managedIdentityTokens(config.db.clientId)
    : () => Promise.reject(new Error('Entra tokens are not used with password auth'));
const pool = new Pool(poolConfig(config.db, tokens));

try {
  await runMigrationJob(pool, {
    // src/migrate.ts and dist/migrate.js both sit one level below apps/api/drizzle.
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    appRole: config.appRole,
    appPrincipalId: config.appPrincipalId,
    logger,
  });
} catch (err) {
  logger.fatal({ err }, 'migration job failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
