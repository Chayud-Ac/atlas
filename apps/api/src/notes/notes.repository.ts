import type { CreateNoteInput } from '@atlas/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { Executor } from '../db/database.js';
import { notes } from '../db/schema.js';

export interface NoteRecord {
  id: string;
  ownerId: string;
  title: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotesRepository {
  /** The owner's notes, newest first. */
  listByOwner(ownerId: string): Promise<NoteRecord[]>;
  create(ownerId: string, input: CreateNoteInput): Promise<NoteRecord>;
  /** Deletes the note only if `ownerId` owns it. Resolves false otherwise. */
  deleteOwned(ownerId: string, noteId: string): Promise<boolean>;
}

export function createPgNotesRepository(db: Executor): NotesRepository {
  return {
    async listByOwner(ownerId) {
      return db
        .select()
        .from(notes)
        .where(eq(notes.ownerId, ownerId))
        .orderBy(desc(notes.createdAt), desc(notes.id));
    },

    async create(ownerId, input) {
      const [row] = await db
        .insert(notes)
        .values({ ownerId, title: input.title, body: input.body })
        .returning();
      if (!row) throw new Error('Insert into app.notes returned no row');
      return row;
    },

    async deleteOwned(ownerId, noteId) {
      // Ownership is part of the WHERE clause, so it can't be forgotten by a caller.
      const deleted = await db
        .delete(notes)
        .where(and(eq(notes.id, noteId), eq(notes.ownerId, ownerId)))
        .returning({ id: notes.id });
      return deleted.length > 0;
    },
  };
}
