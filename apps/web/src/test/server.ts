import { CreateNoteInput, type CurrentUser, type Note, type Problem } from '@atlas/shared';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

export const TEST_USER: CurrentUser = {
  id: '01990000-0000-7000-8000-000000000001',
  displayName: 'Ada Lovelace',
  email: 'ada@example.com',
  roles: [],
};

/** The notes the fake API holds. Tests seed it; setup.ts empties it after each test. */
export const notesDb: Note[] = [];

export function makeNote(overrides: Partial<Note> = {}): Note {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: 'A note',
    body: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** An RFC 9457 error response, as the API sends it. */
export function problem(body: Partial<Problem> & Pick<Problem, 'status' | 'title'>) {
  return HttpResponse.json(
    { type: 'about:blank', requestId: 'test-request-id', ...body },
    { status: body.status, headers: { 'content-type': 'application/problem+json' } },
  );
}

/** Intercepts fetch in tests: a small fake of the API. Tests override it with server.use(...). */
export const server = setupServer(
  http.get('/api/users/me', () => HttpResponse.json(TEST_USER)),
  http.get('/api/notes', () => HttpResponse.json(notesDb)),
  http.post('/api/notes', async ({ request }) => {
    const note = makeNote(CreateNoteInput.parse(await request.json()));
    notesDb.unshift(note);
    return HttpResponse.json(note, { status: 201 });
  }),
  http.delete('/api/notes/:id', ({ params }) => {
    const index = notesDb.findIndex((note) => note.id === params.id);
    if (index === -1)
      return problem({ status: 404, title: 'Not Found', detail: 'Note not found.' });
    notesDb.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),
);
