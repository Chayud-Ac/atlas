import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { loadMigratorConfig } from './config.js';
import { poolConfig, tokenProviderFor } from './db/database.js';
import { runMigrationJob } from './db/migrations.js';
import { createLogger } from './logging.js';

const config = loadMigratorConfig(process.env);
const logger = createLogger(config.logLevel);
const pool = new Pool(poolConfig(config.db, tokenProviderFor(config.db)));
// Azure only: its pgaadauth functions, which create the API's Entra-backed role, exist only in the
// built-in `postgres` database. The migrator is an Entra admin, so it may connect there too.
const postgresDb =
  config.appPrincipalId && config.db.auth === 'entra'
    ? new Pool(poolConfig({ ...config.db, database: 'postgres' }, tokenProviderFor(config.db)))
    : undefined;

try {
  await runMigrationJob(pool, {
    // src/migrate.ts and dist/migrate.js both sit one level below apps/api/drizzle.
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    appRole: config.appRole,
    entraRole:
      config.appPrincipalId && postgresDb
        ? { principalId: config.appPrincipalId, postgresDb }
        : undefined,
    logger,
  });
} catch (err) {
  logger.fatal({ err }, 'migration job failed');
  process.exitCode = 1;
} finally {
  await pool.end();
  await postgresDb?.end();
}
