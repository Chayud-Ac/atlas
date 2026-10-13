import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool, PoolClient } from 'pg';
import type { Logger } from '../logger.js';
import { applyGrants } from './grants.js';

/** Arbitrary but fixed: every migrator instance contends for the same lock. */
const MIGRATION_LOCK_KEY = 727_001;

export interface MigrationJobOptions {
  migrationsFolder: string;
  /** The runtime role to grant to: `atlas_app` locally, `id-atlas-api-{env}` in Azure. */
  appRole: string;
  /** Azure only: the runtime identity's object id, used to create its Entra-backed role. */
  appPrincipalId?: string | undefined;
  logger: Logger;
}

/** Spec §8.5: lock → migrate → (Azure) ensure runtime role → grants. Safe to run concurrently. */
export async function runMigrationJob(pool: Pool, options: MigrationJobOptions): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      options.logger.info('applying migrations');
      await migrate(drizzle({ client }), {
        migrationsFolder: options.migrationsFolder,
        migrationsSchema: 'drizzle',
      });
      if (options.appPrincipalId) {
        await ensureEntraRole(client, options.appRole, options.appPrincipalId);
      }
      await applyGrants(client, options.appRole);
      options.logger.info({ appRole: options.appRole }, 'migrations and grants applied');
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

/** Creates a Postgres role bound to an Entra identity. Exists only on Azure Database for PostgreSQL. */
async function ensureEntraRole(
  client: PoolClient,
  role: string,
  principalId: string,
): Promise<void> {
  const existing = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  if (existing.rowCount === 0) {
    await client.query(
      "SELECT * FROM pgaadauth_create_principal_with_oid($1, $2, 'service', false, false)",
      [role, principalId],
    );
  }
}
