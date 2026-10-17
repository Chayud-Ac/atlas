import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { escapeIdentifier, type Pool, type PoolClient } from 'pg';
import { ROLE_NAME } from '../config.js';
import type { Logger } from '../logging.js';

// --- Grants allowlist (spec §8.5) ------------------------------------------------------------

type Privilege = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

/**
 * What the API's runtime role may do, table by table.
 * There are no default privileges: a table missing here is unreachable by the API, and an
 * integration test fails if this list and the tables in schema `app` ever disagree.
 */
export const APP_TABLE_GRANTS = {
  users: ['SELECT', 'INSERT', 'UPDATE'],
  notes: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  audit_events: ['SELECT', 'INSERT'], // append-only: no UPDATE or DELETE
} as const satisfies Record<string, readonly Privilege[]>;

export function grantStatements(role: string): string[] {
  if (!ROLE_NAME.test(role)) throw new Error(`Unsafe database role name: ${role}`);
  const grantee = escapeIdentifier(role);
  return [
    `GRANT USAGE ON SCHEMA app TO ${grantee}`,
    `REVOKE ALL ON ALL TABLES IN SCHEMA app FROM ${grantee}`,
    ...Object.entries(APP_TABLE_GRANTS).map(
      ([table, privileges]) => `GRANT ${privileges.join(', ')} ON app.${table} TO ${grantee}`,
    ),
  ];
}

/** Re-applies the allowlist in one transaction: drift is corrected, with no window without privileges. */
async function applyGrants(client: PoolClient, role: string): Promise<void> {
  const statements = grantStatements(role);
  await client.query('BEGIN');
  try {
    for (const statement of statements) await client.query(statement);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

// --- Migration job ---------------------------------------------------------------------------

/** Arbitrary but fixed: every migrator instance contends for the same lock. */
const MIGRATION_LOCK_KEY = 727_001;

export interface MigrationJobOptions {
  migrationsFolder: string;
  /** The runtime role to grant to: `atlas_app` locally, `id-atlas-api-{env}` in Azure. */
  appRole: string;
  /**
   * Azure only: create `appRole` bound to the runtime identity (its object id). Azure's pgaadauth
   * functions exist only in the built-in `postgres` database, so this needs a pool connected there.
   */
  entraRole?: { principalId: string; postgresDb: Pool } | undefined;
  logger: Logger;
}

/** Lock → migrate → (Azure) ensure runtime role → grants. Safe to run concurrently. */
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
      if (options.entraRole) {
        const { postgresDb, principalId } = options.entraRole;
        await ensureEntraRole(postgresDb, options.appRole, principalId);
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

/**
 * Creates a Postgres role bound to an Entra identity, with Azure Database for PostgreSQL's own
 * function. Roles belong to the whole server, so the role is then usable in the `atlas` database.
 */
async function ensureEntraRole(postgresDb: Pool, role: string, principalId: string): Promise<void> {
  const existing = await postgresDb.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  if (existing.rowCount === 0) {
    await postgresDb.query(
      "SELECT * FROM pgaadauth_create_principal_with_oid($1, $2, 'service', false, false)",
      [role, principalId],
    );
  }
}
