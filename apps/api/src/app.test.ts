import { CurrentUser, Note, Problem } from '@atlas/shared';
import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createTokenVerifier } from './auth/token-verifier.js';
import { createLogger } from './logger.js';
import { createNotesService, type NotesService } from './notes/notes-service.js';
import { createInMemoryStore, type InMemoryStore } from './test/in-memory-store.js';
import {
  BOB,
  createTestIssuer,
  TEST_AUDIENCE,
  TEST_ISSUER,
  TEST_SCOPE,
  type TestIssuer,
} from './test/test-issuer.js';

let issuer: TestIssuer;
let store: InMemoryStore;
let databaseUp: boolean;

beforeAll(async () => {
  issuer = await createTestIssuer();
});

beforeEach(() => {
  store = createInMemoryStore();
  databaseUp = true;
});

function buildApp(notes: NotesService = createNotesService(store.unitOfWork)): Express {
  return createApp({
    version: 'abc1234',
    requiredScope: TEST_SCOPE,
    logger: createLogger('silent'),
    verifier: createTokenVerifier({
      issuer: TEST_ISSUER,
      audience: TEST_AUDIENCE,
      getKey: issuer.getKey,
    }),
    users: store.users,
    notes,
    checkDatabase: () =>
      databaseUp
        ? Promise.resolve()
        : Promise.reject(new Error('connect ECONNREFUSED 10.0.0.4:5432')),
  });
}

async function asAlice(): Promise<string> {
  return `Bearer ${await issuer.sign()}`;
}

async function asBob(): Promise<string> {
  return `Bearer ${await issuer.sign(BOB)}`;
}

describe('health', () => {
  it('reports liveness and the running version without a token', async () => {
    const res = await request(buildApp()).get('/api/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', version: 'abc1234' });
  });

  it('is ready when the database answers', async () => {
    expect((await request(buildApp()).get('/api/health/ready')).status).toBe(200);
  });

  it('is not ready when the database is down, and hides the reason', async () => {
    databaseUp = false;
    const res = await request(buildApp()).get('/api/health/ready');
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.4');
  });
});

describe('GET /api/me', () => {
  it('requires a token', async () => {
    const res = await request(buildApp()).get('/api/me');
    expect(res.status).toBe(401);
    expect(Problem.parse(res.body).status).toBe(401);
  });

  it('returns the signed-in user', async () => {
    const res = await request(buildApp())
      .get('/api/me')
      .set('Authorization', await asAlice());
    expect(res.status).toBe(200);
    expect(CurrentUser.parse(res.body)).toMatchObject({
      displayName: 'Alice Example',
      email: 'alice@example.com',
      roles: [],
    });
  });

  it('passes through app roles from the token', async () => {
    const token = `Bearer ${await issuer.sign({ roles: ['Admin'] })}`;
    const res = await request(buildApp()).get('/api/me').set('Authorization', token);
    expect(CurrentUser.parse(res.body).roles).toEqual(['Admin']);
  });
});

describe('/api/notes', () => {
  it('creates a note and lists it', async () => {
    const app = buildApp();
    const created = await request(app)
      .post('/api/notes')
      .set('Authorization', await asAlice())
      .send({ title: 'Groceries', body: 'Milk' });

    expect(created.status).toBe(201);
    const note = Note.parse(created.body);
    expect(note).toMatchObject({ title: 'Groceries', body: 'Milk' });

    const listed = await request(app)
      .get('/api/notes')
      .set('Authorization', await asAlice());
    expect(listed.body).toEqual([note]);
  });

  it('lists newest first', async () => {
    const app = buildApp();
    const auth = await asAlice();
    await request(app).post('/api/notes').set('Authorization', auth).send({ title: 'First' });
    await request(app).post('/api/notes').set('Authorization', auth).send({ title: 'Second' });

    const listed = await request(app).get('/api/notes').set('Authorization', auth);
    expect(
      Note.array()
        .parse(listed.body)
        .map((note) => note.title),
    ).toEqual(['Second', 'First']);
  });

  it('rejects an invalid note with field errors', async () => {
    const res = await request(buildApp())
      .post('/api/notes')
      .set('Authorization', await asAlice())
      .send({ title: '   ' });
    expect(res.status).toBe(400);
    expect(res.get('Content-Type')).toMatch(/^application\/problem\+json/);
    expect(Problem.parse(res.body).errors).toEqual([
      { path: 'title', message: 'Title is required' },
    ]);
  });

  it('rejects fields the client may not set', async () => {
    const res = await request(buildApp())
      .post('/api/notes')
      .set('Authorization', await asAlice())
      .send({ title: 'Mine', ownerId: '0199c3a0-0000-7000-8000-000000000999' });
    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON', async () => {
    const res = await request(buildApp())
      .post('/api/notes')
      .set('Authorization', await asAlice())
      .set('Content-Type', 'application/json')
      .send('{"title":');
    expect(res.status).toBe(400);
    expect(Problem.parse(res.body).status).toBe(400);
  });

  it('rejects bodies over 100 kB', async () => {
    const res = await request(buildApp())
      .post('/api/notes')
      .set('Authorization', await asAlice())
      .send({ title: 'Big', body: 'a'.repeat(200_000) });
    expect(res.status).toBe(413);
  });

  it("hides other users' notes and refuses to delete them", async () => {
    const app = buildApp();
    const created = await request(app)
      .post('/api/notes')
      .set('Authorization', await asAlice())
      .send({ title: 'Private' });
    const { id } = Note.parse(created.body);

    const bobsList = await request(app)
      .get('/api/notes')
      .set('Authorization', await asBob());
    expect(bobsList.body).toEqual([]);

    const bobsDelete = await request(app)
      .delete(`/api/notes/${id}`)
      .set('Authorization', await asBob());
    expect(bobsDelete.status).toBe(404);
    expect(store.allNotes()).toHaveLength(1);
  });

  it('deletes your own note', async () => {
    const app = buildApp();
    const auth = await asAlice();
    const created = await request(app)
      .post('/api/notes')
      .set('Authorization', auth)
      .send({ title: 'Temp' });
    const { id } = Note.parse(created.body);

    const deleted = await request(app).delete(`/api/notes/${id}`).set('Authorization', auth);
    expect(deleted.status).toBe(204);
    expect((await request(app).get('/api/notes').set('Authorization', auth)).body).toEqual([]);
  });

  it('rejects a malformed note id', async () => {
    const res = await request(buildApp())
      .delete('/api/notes/42')
      .set('Authorization', await asAlice());
    expect(res.status).toBe(400);
  });
});

describe('cross-cutting behaviour', () => {
  it('answers unknown routes with a problem', async () => {
    const res = await request(buildApp()).get('/api/nope');
    expect(res.status).toBe(404);
    expect(Problem.parse(res.body).title).toBe('Not Found');
  });

  it('echoes a safe x-request-id and puts it in problem bodies', async () => {
    const res = await request(buildApp()).get('/api/nope').set('x-request-id', 'trace-me-123');
    expect(res.get('x-request-id')).toBe('trace-me-123');
    expect(Problem.parse(res.body).requestId).toBe('trace-me-123');
  });

  it('turns unexpected failures into a generic 500', async () => {
    const failing: NotesService = {
      list: () => Promise.reject(new Error('relation "app.notes" does not exist')),
      create: () => Promise.reject(new Error('unused')),
      remove: () => Promise.reject(new Error('unused')),
    };
    const res = await request(buildApp(failing))
      .get('/api/notes')
      .set('Authorization', await asAlice());
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('app.notes');
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(buildApp()).get('/api/health/live');
    expect(res.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.get('X-Powered-By')).toBeUndefined();
  });
});
