import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../logging.js';
import {
  APP_ROLE,
  connectAs,
  connectToPostgresDb,
  MIGRATIONS_FOLDER,
  resetData,
} from '../test/postgres.js';
import { APP_TABLE_GRANTS, runMigrationJob } from './migrations.js';

const INSUFFICIENT_PRIVILEGE = { code: '42501' };

let migrator: Pool;
let app: Pool;

beforeAll(() => {
  migrator = connectAs('migrator');
  app = connectAs('app');
});

beforeEach(async () => {
  await resetData(migrator);
});

afterAll(async () => {
  await app.end();
  await migrator.end();
});

async function insertUser(): Promise<string> {
  const { rows } = await app.query<{ id: string }>(
    `INSERT INTO app.users (id, entra_tenant_id, entra_object_id)
     VALUES ('0199c3a0-0000-7000-8000-0000000000aa', gen_random_uuid(), gen_random_uuid())
     RETURNING id`,
  );
  return rows[0]?.id ?? '';
}

describe('runMigrationJob', () => {
  it('creates exactly the tables in the grants allowlist', async () => {
    const { rows } = await migrator.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'app' ORDER BY table_name",
    );
    expect(rows.map((row) => row.table_name)).toEqual(Object.keys(APP_TABLE_GRANTS).sort());
  });

  it('is a no-op when re-run, even by two instances at once', async () => {
    const applied = async () =>
      (
        await migrator.query<{ n: string }>(
          'SELECT count(*) AS n FROM drizzle.__drizzle_migrations',
        )
      ).rows[0]?.n;
    const before = await applied();
    const options = {
      migrationsFolder: MIGRATIONS_FOLDER,
      appRole: APP_ROLE,
      logger: createLogger('silent'),
    };

    await Promise.all([runMigrationJob(migrator, options), runMigrationJob(migrator, options)]);

    expect(await applied()).toBe(before);
  });
});

describe('the API runtime role', () => {
  it('can read and write notes', async () => {
    const ownerId = await insertUser();
    await app.query(
      "INSERT INTO app.notes (id, owner_id, title) VALUES ('0199c3a0-0000-7000-8000-0000000000bb', $1, 'ok')",
      [ownerId],
    );
    const { rowCount } = await app.query('DELETE FROM app.notes');
    expect(rowCount).toBe(1);
  });

  it('cannot rewrite history in audit_events', async () => {
    await expect(
      app.query("UPDATE app.audit_events SET action = 'tampered'"),
    ).rejects.toMatchObject(INSUFFICIENT_PRIVILEGE);
  });

  it('cannot erase history in audit_events', async () => {
    await expect(app.query('DELETE FROM app.audit_events')).rejects.toMatchObject(
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it('cannot delete users', async () => {
    await expect(app.query('DELETE FROM app.users')).rejects.toMatchObject(INSUFFICIENT_PRIVILEGE);
  });

  it('cannot create tables', async () => {
    await expect(app.query('CREATE TABLE app.sneaky (id int)')).rejects.toMatchObject(
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it('cannot drop tables', async () => {
    await expect(app.query('DROP TABLE app.notes')).rejects.toMatchObject(INSUFFICIENT_PRIVILEGE);
  });
});

describe('the runtime role in Azure', () => {
  it("is created with Azure's pgaadauth function, which only the postgres database has", async () => {
    const postgresDb = connectToPostgresDb();
    try {
      // A stand-in for Azure's function, in the postgres database only, as on Azure.
      await postgresDb.query(`
        CREATE OR REPLACE FUNCTION pgaadauth_create_principal_with_oid(
          role_name text, object_id text, object_type text, is_admin boolean, is_mfa boolean)
        RETURNS text LANGUAGE plpgsql AS $$
        BEGIN
          EXECUTE format('CREATE ROLE %I LOGIN', role_name);
          RETURN 'Created role for ' || role_name;
        END $$`);

      await runMigrationJob(migrator, {
        migrationsFolder: MIGRATIONS_FOLDER,
        appRole: 'id-atlas-api-test',
        entraRole: { principalId: '0199c3a0-0000-7000-8000-0000000000bb', postgresDb },
        logger: createLogger('silent'),
      });

      const { rows } = await migrator.query<{ granted: boolean }>(
        "SELECT has_table_privilege('id-atlas-api-test', 'app.notes', 'DELETE') AS granted",
      );
      expect(rows[0]?.granted).toBe(true);
    } finally {
      await postgresDb.end();
    }
  });
});
