import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import type { AuthSettings } from '../config.js';
import { server } from '../test/server.js';
import { createMockAuth } from './mock-auth.js';

const settings: AuthSettings = {
  kind: 'mock',
  authority: 'http://mock.test/atlas',
  clientId: 'atlas-web',
  apiScope: 'atlas-api/access_as_user',
};
const TOKEN_URL = 'http://mock.test/atlas/token';
const STORAGE_KEY = 'atlas.mock-token';
const NOW = 1_800_000_000_000;

function setup() {
  const reload = vi.fn();
  const create = () =>
    createMockAuth(settings, { storage: sessionStorage, reload, now: () => NOW });
  return { reload, create };
}

describe('createMockAuth', () => {
  it('is signed out with no stored token', () => {
    expect(setup().create().isSignedIn).toBe(false);
  });

  it('signs in at the mock token endpoint, then reloads', async () => {
    let form: URLSearchParams | undefined;
    server.use(
      http.post(TOKEN_URL, async ({ request }) => {
        form = new URLSearchParams(await request.text());
        return HttpResponse.json({
          access_token: 'mock-token',
          expires_in: 3600,
          token_type: 'Bearer',
        });
      }),
    );
    const { reload, create } = setup();

    await create().signIn();

    expect(form?.get('grant_type')).toBe('client_credentials');
    expect(form?.get('client_id')).toBe('atlas-web');
    expect(form?.get('scope')).toBe('atlas-api/access_as_user');
    expect(reload).toHaveBeenCalledOnce();
    const afterReload = create();
    expect(afterReload.isSignedIn).toBe(true);
    await expect(afterReload.getAccessToken()).resolves.toBe('mock-token');
  });

  it('treats an expired token as signed out', () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ accessToken: 't', expiresAt: NOW - 1 }));
    expect(setup().create().isSignedIn).toBe(false);
  });

  it('ignores a corrupted stored token', () => {
    sessionStorage.setItem(STORAGE_KEY, '{not json');
    expect(setup().create().isSignedIn).toBe(false);
  });

  it('reports a failed sign-in', async () => {
    server.use(http.post(TOKEN_URL, () => new HttpResponse(null, { status: 401 })));
    await expect(setup().create().signIn()).rejects.toThrow('Mock sign-in failed with 401');
  });

  it('signs out by forgetting the token', async () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ accessToken: 't', expiresAt: NOW + 60_000 }),
    );
    const { reload, create } = setup();

    await create().signOut();

    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(reload).toHaveBeenCalledOnce();
  });
});
