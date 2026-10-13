import { escapeIdentifier, type PoolClient } from 'pg';

/** Postgres role names Atlas will grant to: letters, digits, `_` and `-`, at most 63 bytes. */
export const ROLE_NAME = /^[A-Za-z0-9_-]{1,63}$/;

type Privilege = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

/**
 * What the API's runtime role may do, table by table (spec §8.5).
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
export async function applyGrants(client: PoolClient, role: string): Promise<void> {
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
