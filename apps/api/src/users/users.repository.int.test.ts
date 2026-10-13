import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../db/database.js';
import { connectAs, resetData } from '../test/postgres.js';
import { ALICE } from '../test/test-issuer.js';
import { createPgUsersRepository } from './users.repository.js';
import type { UserIdentity, UsersRepository } from './users.repository.js';

const identity: UserIdentity = {
  entraTenantId: ALICE.tid,
  entraObjectId: ALICE.oid,
  email: 'alice@example.com',
  displayName: 'Alice',
};

let migrator: Pool;
let app: Pool;
let repo: UsersRepository;

beforeAll(() => {
  migrator = connectAs('migrator');
  app = connectAs('app');
  repo = createPgUsersRepository(createDatabase(app));
});

beforeEach(async () => {
  await resetData(migrator);
});

afterAll(async () => {
  await app.end();
  await migrator.end();
});

async function row(id: string) {
  const { rows } = await migrator.query<{
    updated_at: Date;
    last_seen_at: Date;
    display_name: string;
  }>('SELECT updated_at, last_seen_at, display_name FROM app.users WHERE id = $1', [id]);
  if (!rows[0]) throw new Error(`no user ${id}`);
  return rows[0];
}

describe('PgUsersRepository', () => {
  it('creates the user on first sign-in with an app-owned UUIDv7 id', async () => {
    const user = await repo.upsertFromIdentity(identity);
    expect(user).toMatchObject({ entraObjectId: ALICE.oid, displayName: 'Alice' });
    expect(user.id[14]).toBe('7');
  });

  it('returns the same user later without rewriting the row', async () => {
    const first = await repo.upsertFromIdentity(identity);
    const before = await row(first.id);

    const second = await repo.upsertFromIdentity(identity);

    expect(second.id).toBe(first.id);
    expect((await row(first.id)).updated_at).toEqual(before.updated_at);
  });

  it('updates profile fields when they change', async () => {
    const first = await repo.upsertFromIdentity(identity);
    const renamed = await repo.upsertFromIdentity({ ...identity, displayName: 'Alice B.' });

    expect(renamed.displayName).toBe('Alice B.');
    expect((await row(first.id)).display_name).toBe('Alice B.');
  });

  it('refreshes last_seen_at once it is older than 5 minutes', async () => {
    const user = await repo.upsertFromIdentity(identity);
    await migrator.query(
      "UPDATE app.users SET last_seen_at = now() - interval '10 minutes' WHERE id = $1",
      [user.id],
    );

    await repo.upsertFromIdentity(identity);

    const { last_seen_at } = await row(user.id);
    expect(Date.now() - last_seen_at.getTime()).toBeLessThan(60_000);
  });
});
