import { z } from 'zod';

export const NOTE_TITLE_MAX = 200;
export const NOTE_BODY_MAX = 10_000;

export const NoteTitle = z
  .string()
  .trim()
  .min(1, 'Title is required')
  .max(NOTE_TITLE_MAX, `Title must be at most ${NOTE_TITLE_MAX} characters`);

export const NoteBody = z
  .string()
  .max(NOTE_BODY_MAX, `Body must be at most ${NOTE_BODY_MAX} characters`);

/** Request body for POST /api/notes. Unknown fields are rejected. */
export const CreateNoteInput = z.strictObject({
  title: NoteTitle,
  body: NoteBody.default(''),
});
export type CreateNoteInput = z.infer<typeof CreateNoteInput>;

/** A note as returned by the API. Timestamps are ISO 8601 UTC strings. */
export const Note = z.strictObject({
  id: z.uuid(),
  title: NoteTitle,
  body: NoteBody,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Note = z.infer<typeof Note>;
