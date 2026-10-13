import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, createApiClient } from './api.js';
import { problem, server } from './test/server.js';

const Thing = z.object({ id: z.string() });

function setup() {
  const signIn = vi.fn(() => Promise.resolve());
  const api = createApiClient({ getAccessToken: () => Promise.resolve('test-token'), signIn });
  return { api, signIn };
}

describe('createApiClient', () => {
  it('sends the bearer token and validates the response', async () => {
    let authorization: string | null = null;
    server.use(
      http.get('/api/things/1', ({ request }) => {
        authorization = request.headers.get('authorization');
        return HttpResponse.json({ id: '1' });
      }),
    );

    await expect(setup().api.get('/api/things/1', Thing)).resolves.toEqual({ id: '1' });
    expect(authorization).toBe('Bearer test-token');
  });

  it('rejects a response that breaks the contract', async () => {
    server.use(http.get('/api/things/1', () => HttpResponse.json({ id: 1 })));
    await expect(setup().api.get('/api/things/1', Thing)).rejects.toThrow(z.ZodError);
  });

  it('posts JSON', async () => {
    let body: unknown;
    let contentType: string | null = null;
    server.use(
      http.post('/api/things', async ({ request }) => {
        body = await request.json();
        contentType = request.headers.get('content-type');
        return HttpResponse.json({ id: '2' }, { status: 201 });
      }),
    );

    await expect(setup().api.post('/api/things', { name: 'x' }, Thing)).resolves.toEqual({
      id: '2',
    });
    expect(body).toEqual({ name: 'x' });
    expect(contentType).toBe('application/json');
  });

  it('deletes, ignoring the empty 204 body', async () => {
    server.use(http.delete('/api/things/1', () => new HttpResponse(null, { status: 204 })));
    await expect(setup().api.delete('/api/things/1')).resolves.toBeUndefined();
  });

  it('turns problem+json into an ApiError', async () => {
    server.use(
      http.get('/api/things/1', () =>
        problem({
          status: 404,
          title: 'Not Found',
          detail: 'Thing not found.',
          requestId: 'req-1',
        }),
      ),
    );

    const error: unknown = await setup()
      .api.get('/api/things/1', Thing)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 404,
      message: 'Thing not found.',
      problem: { requestId: 'req-1' },
    });
  });

  it('still reports an error whose body is not problem+json', async () => {
    server.use(
      http.get(
        '/api/things/1',
        () =>
          new HttpResponse('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' }),
      ),
    );
    await expect(setup().api.get('/api/things/1', Thing)).rejects.toMatchObject({
      status: 502,
      message: 'Bad Gateway',
    });
  });

  it('starts sign-in again on a 401', async () => {
    server.use(http.get('/api/things/1', () => problem({ status: 401, title: 'Unauthorized' })));
    const { api, signIn } = setup();

    void api.get('/api/things/1', Thing);

    await vi.waitFor(() => {
      expect(signIn).toHaveBeenCalledOnce();
    });
  });

  it('shows the error instead of looping when a fresh token is rejected too', async () => {
    sessionStorage.setItem('atlas.reauth-at', String(Date.now()));
    server.use(http.get('/api/things/1', () => problem({ status: 401, title: 'Unauthorized' })));
    const { api, signIn } = setup();

    await expect(api.get('/api/things/1', Thing)).rejects.toMatchObject({ status: 401 });
    expect(signIn).not.toHaveBeenCalled();
  });
});
