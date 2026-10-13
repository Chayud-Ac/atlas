import { describe, expect, it } from 'vitest';
import { discoverJwksUri } from './discovery.js';

const ISSUER = 'https://login.microsoftonline.com/00000000-0000-4000-8000-000000000001/v2.0';

function fakeFetch(status: number, body: unknown) {
  const calls: string[] = [];
  const fetchFn = ((input: string | URL | Request) => {
    calls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as typeof fetch;
  return { calls, fetchFn };
}

describe('discoverJwksUri', () => {
  it("reads jwks_uri from the issuer's OpenID configuration", async () => {
    const { calls, fetchFn } = fakeFetch(200, {
      issuer: ISSUER,
      jwks_uri: 'https://keys.example/jwks',
    });
    await expect(discoverJwksUri(ISSUER, fetchFn)).resolves.toBe('https://keys.example/jwks');
    expect(calls).toEqual([`${ISSUER}/.well-known/openid-configuration`]);
  });

  it('fails when the discovery document is unavailable', async () => {
    const { fetchFn } = fakeFetch(404, {});
    await expect(discoverJwksUri(ISSUER, fetchFn)).rejects.toThrow(/404/);
  });

  it('fails when the document belongs to a different issuer', async () => {
    const { fetchFn } = fakeFetch(200, {
      issuer: 'https://evil.example',
      jwks_uri: 'https://evil.example/jwks',
    });
    await expect(discoverJwksUri(ISSUER, fetchFn)).rejects.toThrow(/issuer mismatch/);
  });
});
