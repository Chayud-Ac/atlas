import type { CreateNoteInput } from '@atlas/shared';
import { v7 as uuidv7 } from 'uuid';
import type { AuditEvent, AuditRepository } from '../audit/audit.repository.js';
import type { NoteRecord, NotesRepository } from '../notes/notes.repository.js';
import type { UnitOfWork } from '../db/database.js';
import type { User, UsersRepository } from '../users/users.repository.js';

/** In-memory test doubles for the repositories. Unit tests only; Postgres is tested separately. */
export function createInMemoryStore() {
  const users = new Map<string, User>();
  const notes: NoteRecord[] = [];
  const auditEvents: AuditEvent[] = [];

  const usersRepository: UsersRepository = {
    upsertFromIdentity(identity) {
      const key = `${identity.entraTenantId}/${identity.entraObjectId}`;
      const user: User = { id: users.get(key)?.id ?? uuidv7(), ...identity };
      users.set(key, user);
      return Promise.resolve(user);
    },
  };

  const notesRepository: NotesRepository = {
    listByOwner(ownerId) {
      const owned = notes.filter((note) => note.ownerId === ownerId);
      // Same order as Postgres: created_at DESC, id DESC (UUIDv7 is time-ordered).
      owned.sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
      );
      return Promise.resolve(owned);
    },
    create(ownerId, input: CreateNoteInput) {
      const now = new Date();
      const note: NoteRecord = { id: uuidv7(), ownerId, ...input, createdAt: now, updatedAt: now };
      notes.push(note);
      return Promise.resolve(note);
    },
    deleteOwned(ownerId, noteId) {
      const index = notes.findIndex((note) => note.id === noteId && note.ownerId === ownerId);
      if (index === -1) return Promise.resolve(false);
      notes.splice(index, 1);
      return Promise.resolve(true);
    },
  };

  const auditRepository: AuditRepository = {
    record(event) {
      auditEvents.push(event);
      return Promise.resolve();
    },
  };

  // No real transaction: rollback behaviour is covered by the Postgres integration tests.
  const unitOfWork: UnitOfWork = {
    run: (work) => work({ notes: notesRepository, audit: auditRepository }),
  };

  return {
    users: usersRepository,
    unitOfWork,
    allUsers: () => [...users.values()],
    allNotes: () => [...notes],
    auditEvents,
  };
}

export type InMemoryStore = ReturnType<typeof createInMemoryStore>;
