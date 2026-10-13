import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectAs, resetData } from '../test/postgres.js';

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
