import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { inject } from 'vitest';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** The local role names, matching dev/postgres/init/01-roles.sql. */
export const APP_ROLE = 'atlas_app';

/** A pool for the migrator (owns the schema) or the API's runtime role (rows only). */
export function connectAs(role: 'migrator' | 'app'): Pool {
  const { migratorUrl, appUrl } = inject('postgres');
  return new Pool({ connectionString: role === 'migrator' ? migratorUrl : appUrl, max: 4 });
}

/** A superuser pool on the built-in `postgres` database, standing in for Azure's Entra admin there. */
export function connectToPostgresDb(): Pool {
  return new Pool({ connectionString: inject('postgres').postgresDbUrl, max: 1 });
}

/** Empties every table between tests. Runs as the migrator, which owns them. */
export async function resetData(migrator: Pool): Promise<void> {
  await migrator.query('TRUNCATE app.audit_events, app.notes, app.users');
}
