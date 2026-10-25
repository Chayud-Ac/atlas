import { beforeEach, describe, expect, it } from 'vitest';
import { NotFoundError } from '../errors.js';
import { createInMemoryStore, type InMemoryStore } from '../test/in-memory-store.js';
import { createNotesService, type Actor, type NotesService } from './notes.service.js';

const alice: Actor = {
  userId: '0199c3a0-0000-7000-8000-00000000000a',
  requestId: 'req-alice',
  traceId: '0af7651916cd43dd8448eb211c80319c',
};
const bob: Actor = {
  userId: '0199c3a0-0000-7000-8000-00000000000b',
  requestId: 'req-bob',
  traceId: null,
};

let store: InMemoryStore;
let service: NotesService;

beforeEach(() => {
  store = createInMemoryStore();
  service = createNotesService(store.unitOfWork);
});

describe('NotesService', () => {
  it('creates a note owned by the actor and audits it with the request and trace ids', async () => {
    const note = await service.create(alice, { title: 'Groceries', body: 'Milk' });

    expect(note).toMatchObject({ ownerId: alice.userId, title: 'Groceries', body: 'Milk' });
    expect(store.auditEvents).toEqual([
      {
        actorUserId: alice.userId,
        action: 'note.created',
        entityType: 'note',
        entityId: note.id,
        requestId: 'req-alice',
        traceId: '0af7651916cd43dd8448eb211c80319c',
      },
    ]);
  });

  it("lists only the actor's notes, newest first", async () => {
    const first = await service.create(alice, { title: 'First', body: '' });
    const second = await service.create(alice, { title: 'Second', body: '' });
    await service.create(bob, { title: "Bob's", body: '' });

    const listed = await service.list(alice);
    expect(listed.map((note) => note.id)).toEqual([second.id, first.id]);
  });

  it('removes a note and audits the deletion', async () => {
    const note = await service.create(alice, { title: 'Groceries', body: '' });
    await service.remove(alice, note.id);

    expect(await service.list(alice)).toEqual([]);
    expect(store.auditEvents.map((event) => event.action)).toEqual([
      'note.created',
      'note.deleted',
    ]);
  });

  it("treats another user's note as not found, and changes nothing", async () => {
    const note = await service.create(alice, { title: 'Private', body: '' });

    await expect(service.remove(bob, note.id)).rejects.toThrow(NotFoundError);
    expect(store.allNotes()).toHaveLength(1);
    expect(store.auditEvents.map((event) => event.action)).toEqual(['note.created']);
  });
});
