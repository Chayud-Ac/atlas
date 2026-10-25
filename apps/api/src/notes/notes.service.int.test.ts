import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../db/database.js';
import { createPgUnitOfWork } from '../db/database.js';
import { NotFoundError } from '../errors.js';
import { connectAs, resetData } from '../test/postgres.js';
import { ALICE, BOB } from '../test/test-issuer.js';
import type { UnitOfWork } from '../db/database.js';
import { createPgUsersRepository } from '../users/users.repository.js';
import { createNotesService, type Actor } from './notes.service.js';

let migrator: Pool;
let app: Pool;
let db: Database;
let alice: Actor;
let bob: Actor;

beforeAll(() => {
  migrator = connectAs('migrator');
  app = connectAs('app');
  db = createDatabase(app);
});

beforeEach(async () => {
  await resetData(migrator);
  const users = createPgUsersRepository(db);
  const a = await users.upsertFromIdentity({
    entraTenantId: ALICE.tid,
    entraObjectId: ALICE.oid,
    email: null,
    displayName: 'Alice',
  });
  const b = await users.upsertFromIdentity({
    entraTenantId: BOB.tid,
    entraObjectId: BOB.oid,
    email: null,
    displayName: 'Bob',
  });
  alice = { userId: a.id, requestId: 'req-a', traceId: '4bf92f3577b34da6a3ce929d0e0e4736' };
  bob = { userId: b.id, requestId: 'req-b', traceId: null };
});

afterAll(async () => {
  await app.end();
  await migrator.end();
});

async function auditActions(): Promise<string[]> {
  const { rows } = await migrator.query<{ action: string }>(
    'SELECT action FROM app.audit_events ORDER BY occurred_at, id',
  );
  return rows.map((r) => r.action);
}

describe('NotesService on Postgres', () => {
  it("lists only the owner's notes, newest first", async () => {
    const service = createNotesService(createPgUnitOfWork(db));
    const first = await service.create(alice, { title: 'First', body: '' });
    const second = await service.create(alice, { title: 'Second', body: '' });
    await service.create(bob, { title: "Bob's", body: '' });

    expect((await service.list(alice)).map((n) => n.id)).toEqual([second.id, first.id]);
  });

  it('writes an audit row with each change', async () => {
    const service = createNotesService(createPgUnitOfWork(db));
    const note = await service.create(alice, { title: 'Groceries', body: '' });
    await service.remove(alice, note.id);

    const { rows } = await migrator.query<{
      action: string;
      entity_id: string;
      request_id: string;
      trace_id: string | null;
    }>(
      'SELECT action, entity_id, request_id, trace_id FROM app.audit_events ORDER BY occurred_at, id',
    );
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    expect(rows).toEqual([
      { action: 'note.created', entity_id: note.id, request_id: 'req-a', trace_id: traceId },
      { action: 'note.deleted', entity_id: note.id, request_id: 'req-a', trace_id: traceId },
    ]);
  });

  it("refuses to delete another user's note, and records nothing", async () => {
    const service = createNotesService(createPgUnitOfWork(db));
    const note = await service.create(alice, { title: 'Private', body: '' });

    await expect(service.remove(bob, note.id)).rejects.toThrow(NotFoundError);
    expect(await service.list(alice)).toHaveLength(1);
    expect(await auditActions()).toEqual(['note.created']);
  });

  it('rolls the note back when the audit write fails', async () => {
    const real = createPgUnitOfWork(db);
    const auditDown: UnitOfWork = {
      run: (work) =>
        real.run((repositories) =>
          work({
            ...repositories,
            audit: { record: () => Promise.reject(new Error('audit store unavailable')) },
          }),
        ),
    };

    await expect(
      createNotesService(auditDown).create(alice, { title: 'Ghost', body: '' }),
    ).rejects.toThrow('audit store unavailable');
    expect(await createNotesService(real).list(alice)).toEqual([]);
  });
});
