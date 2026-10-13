import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { loadMigratorConfig } from './config.js';
import { poolConfig, tokenProviderFor } from './db/database.js';
import { runMigrationJob } from './db/migrations.js';
import { createLogger } from './logging.js';

const config = loadMigratorConfig(process.env);
const logger = createLogger(config.logLevel);
const pool = new Pool(poolConfig(config.db, tokenProviderFor(config.db)));

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
