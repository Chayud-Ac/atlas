import { describe, expect, it } from 'vitest';
import { CreateNoteInput, Note, NOTE_BODY_MAX, NOTE_TITLE_MAX } from './notes.js';

describe('CreateNoteInput', () => {
  it('accepts a title and a body', () => {
    expect(CreateNoteInput.parse({ title: 'Groceries', body: 'Milk' })).toEqual({
      title: 'Groceries',
      body: 'Milk',
    });
  });

  it('defaults the body to an empty string', () => {
    expect(CreateNoteInput.parse({ title: 'Groceries' })).toEqual({ title: 'Groceries', body: '' });
  });

  it('trims surrounding whitespace from the title', () => {
    expect(CreateNoteInput.parse({ title: '  Groceries  ' }).title).toBe('Groceries');
  });

  it('rejects a missing title', () => {
    expect(CreateNoteInput.safeParse({ body: 'Milk' }).success).toBe(false);
  });

  it('rejects a title that is only whitespace', () => {
    expect(CreateNoteInput.safeParse({ title: '   ' }).success).toBe(false);
  });

  it(`accepts a title of exactly ${NOTE_TITLE_MAX} characters`, () => {
    expect(CreateNoteInput.safeParse({ title: 'a'.repeat(NOTE_TITLE_MAX) }).success).toBe(true);
  });

  it(`rejects a title longer than ${NOTE_TITLE_MAX} characters`, () => {
    expect(CreateNoteInput.safeParse({ title: 'a'.repeat(NOTE_TITLE_MAX + 1) }).success).toBe(
      false,
    );
  });

  it(`rejects a body longer than ${NOTE_BODY_MAX} characters`, () => {
    const input = { title: 'Groceries', body: 'a'.repeat(NOTE_BODY_MAX + 1) };
    expect(CreateNoteInput.safeParse(input).success).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(CreateNoteInput.safeParse({ title: 'Groceries', ownerId: 'someone-else' }).success).toBe(
      false,
    );
  });
});

describe('Note', () => {
  const note = {
    id: '0199c3a0-0000-7000-8000-000000000000',
    title: 'Groceries',
    body: '',
    createdAt: '2026-10-13T08:00:00.000Z',
    updatedAt: '2026-10-13T08:00:00.000Z',
  };

  it('accepts a note as the API returns it', () => {
    expect(Note.parse(note)).toEqual(note);
  });

  it('rejects an id that is not a UUID', () => {
    expect(Note.safeParse({ ...note, id: '42' }).success).toBe(false);
  });

  it('rejects a timestamp that is not ISO 8601 UTC', () => {
    expect(Note.safeParse({ ...note, createdAt: '13/10/2026' }).success).toBe(false);
  });
});
