import type { CreateNoteInput } from '@atlas/shared';

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
