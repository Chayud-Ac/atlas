import type { CreateNoteInput } from '@atlas/shared';
import type { UnitOfWork } from '../db/database.js';
import { NotFoundError } from '../errors.js';
import type { NoteRecord } from './notes.repository.js';

/** Who is acting, for ownership checks and the audit trail. */
export interface Actor {
  userId: string;
  requestId: string;
}

export interface NotesService {
  list(actor: Actor): Promise<NoteRecord[]>;
  create(actor: Actor, input: CreateNoteInput): Promise<NoteRecord>;
  remove(actor: Actor, noteId: string): Promise<void>;
}

/** The reference feature: copy this shape (unit of work + audit) for real features. */
export function createNotesService(unitOfWork: UnitOfWork): NotesService {
  return {
    list: (actor) => unitOfWork.run(({ notes }) => notes.listByOwner(actor.userId)),

    create: (actor, input) =>
      unitOfWork.run(async ({ notes, audit }) => {
        const note = await notes.create(actor.userId, input);
        await audit.record({
          actorUserId: actor.userId,
          action: 'note.created',
          entityType: 'note',
          entityId: note.id,
          requestId: actor.requestId,
        });
        return note;
      }),

    remove: (actor, noteId) =>
      unitOfWork.run(async ({ notes, audit }) => {
        // Ownership is enforced in the query: someone else's note looks exactly like a missing one.
        const deleted = await notes.deleteOwned(actor.userId, noteId);
        if (!deleted) throw new NotFoundError('Note not found.');
        await audit.record({
          actorUserId: actor.userId,
          action: 'note.deleted',
          entityType: 'note',
          entityId: noteId,
          requestId: actor.requestId,
        });
      }),
  };
}
