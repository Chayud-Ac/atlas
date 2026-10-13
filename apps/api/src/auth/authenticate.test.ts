import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { errorHandler } from '../http/error-handler.js';
import { genReqId } from '../http/request-id.js';
import { createLogger } from '../logger.js';
import { createInMemoryStore, type InMemoryStore } from '../test/in-memory-store.js';
import {
  ALICE,
  createTestIssuer,
  TEST_AUDIENCE,
  TEST_ISSUER,
  TEST_SCOPE,
  type TestIssuer,
} from '../test/test-issuer.js';
import { authenticate } from './authenticate.js';
import { createTokenVerifier } from './token-verifier.js';

let issuer: TestIssuer;
let store: InMemoryStore;
let app: Express;

beforeAll(async () => {
  issuer = await createTestIssuer();
});

beforeEach(() => {
  store = createInMemoryStore();
  app = express();
  app.use(pinoHttp({ logger: createLogger('silent'), genReqId }));
  app.get(
    '/probe',
    authenticate({
      verifier: createTokenVerifier({
        issuer: TEST_ISSUER,
        audience: TEST_AUDIENCE,
        getKey: issuer.getKey,
      }),
      requiredScope: TEST_SCOPE,
      users: store.users,
    }),
    (req, res) => {
      res.json(req.auth);
    },
  );
  app.use(errorHandler);
});

describe('authenticate', () => {
  it('rejects a request without a token, naming the scheme to use', async () => {
    const res = await request(app).get('/probe');
    expect(res.status).toBe(401);
    expect(res.get('WWW-Authenticate')).toBe('Bearer');
    expect(res.get('Content-Type')).toMatch(/^application\/problem\+json/);
  });

  it('rejects a non-Bearer scheme', async () => {
    const res = await request(app).get('/probe').set('Authorization', 'Basic dXNlcjpwYXNz');
    expect(res.status).toBe(401);
  });

  it('rejects an invalid token', async () => {
    const token = await issuer.sign({}, { expiresAt: Math.floor(Date.now() / 1000) - 120 });
    const res = await request(app).get('/probe').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ detail: 'The access token is invalid or expired.' });
  });

  it('rejects a valid token without the API scope', async () => {
    const token = await issuer.sign({ scp: 'User.Read' });
    const res = await request(app).get('/probe').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('accepts the scope among several', async () => {
    const token = await issuer.sign({ scp: `openid profile ${TEST_SCOPE}` });
    const res = await request(app).get('/probe').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('attaches the caller and provisions the user just in time', async () => {
    const token = await issuer.sign({ roles: ['Admin'] });
    const res = await request(app).get('/probe').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(store.allUsers()).toHaveLength(1);
    expect(res.body).toEqual({
      userId: store.allUsers()[0]?.id,
      oid: ALICE.oid,
      tid: ALICE.tid,
      roles: ['Admin'],
      name: ALICE.name,
      email: ALICE.preferred_username,
    });
  });

  it('reuses the same user on later requests', async () => {
    const token = await issuer.sign();
    await request(app).get('/probe').set('Authorization', `Bearer ${token}`);
    await request(app).get('/probe').set('Authorization', `Bearer ${token}`);
    expect(store.allUsers()).toHaveLength(1);
  });

  it('defaults roles to an empty list', async () => {
    const token = await issuer.sign();
    const res = await request(app).get('/probe').set('Authorization', `Bearer ${token}`);
    expect(res.body).toMatchObject({ roles: [] });
  });
});
