import type { Note } from '@atlas/shared';
import type { NoteRecord } from './notes-repository.js';

/** The API's JSON shape for a note: no owner id, ISO 8601 timestamps. */
export function toNoteDto(record: NoteRecord): Note {
  return {
    id: record.id,
    title: record.title,
    body: record.body,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
