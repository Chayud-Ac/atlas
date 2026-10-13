import type { CurrentUser, Problem } from '@atlas/shared';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

export const TEST_USER: CurrentUser = {
  id: '01990000-0000-7000-8000-000000000001',
  displayName: 'Ada Lovelace',
  email: 'ada@example.com',
  roles: [],
};

/** An RFC 9457 error response, as the API sends it. */
export function problem(body: Partial<Problem> & Pick<Problem, 'status' | 'title'>) {
  return HttpResponse.json(
    { type: 'about:blank', requestId: 'test-request-id', ...body },
    { status: body.status, headers: { 'content-type': 'application/problem+json' } },
  );
}

/** Intercepts fetch in tests: a small fake of the API. Tests override it with server.use(...). */
export const server = setupServer(http.get('/api/users/me', () => HttpResponse.json(TEST_USER)));
