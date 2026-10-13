import { UnsecuredJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ALICE,
  createTestIssuer,
  TEST_AUDIENCE,
  TEST_ISSUER,
  type SignOptions,
  type TestIssuer,
} from '../test/test-issuer.js';
import { createTokenVerifier, discoverJwksUri, type TokenVerifier } from './tokens.js';

let issuer: TestIssuer;
let verifier: TokenVerifier;

beforeAll(async () => {
  issuer = await createTestIssuer();
  verifier = createTokenVerifier({
    issuer: TEST_ISSUER,
    audience: TEST_AUDIENCE,
    getKey: issuer.getKey,
  });
});

describe('createTokenVerifier', () => {
  it('returns the claims of a valid token', async () => {
    const claims = await verifier.verify(await issuer.sign());
    expect(claims).toMatchObject({ oid: ALICE.oid, tid: ALICE.tid, scp: 'access_as_user' });
  });

  const invalid: [string, SignOptions][] = [
    ['expired', { expiresAt: Math.floor(Date.now() / 1000) - 120 }],
    ['not yet valid', { notBefore: '10m' }],
    ['from another issuer', { issuer: 'https://login.microsoftonline.com/other/v2.0' }],
    ['for another audience', { audience: 'some-other-api' }],
    ['signed with an untrusted key', { untrustedKey: true }],
  ];

  it.each(invalid)('rejects a token that is %s', async (_label, options) => {
    await expect(verifier.verify(await issuer.sign({}, options))).rejects.toThrow();
  });

  it('rejects a token without an oid claim', async () => {
    await expect(verifier.verify(await issuer.sign({ oid: undefined }))).rejects.toThrow();
  });

  it('rejects an unsigned token (alg "none")', async () => {
    const unsigned = new UnsecuredJWT({ ...ALICE, scp: 'access_as_user' })
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_AUDIENCE)
      .setExpirationTime('5m')
      .encode();
    await expect(verifier.verify(unsigned)).rejects.toThrow();
  });

  it('rejects something that is not a JWT', async () => {
    await expect(verifier.verify('not-a-jwt')).rejects.toThrow();
  });
});

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
      issuer: TEST_ISSUER,
      jwks_uri: 'https://keys.example/jwks',
    });
    await expect(discoverJwksUri(TEST_ISSUER, fetchFn)).resolves.toBe('https://keys.example/jwks');
    expect(calls).toEqual([`${TEST_ISSUER}/.well-known/openid-configuration`]);
  });

  it('fails when the discovery document is unavailable', async () => {
    const { fetchFn } = fakeFetch(404, {});
    await expect(discoverJwksUri(TEST_ISSUER, fetchFn)).rejects.toThrow(/404/);
  });

  it('fails when the document belongs to a different issuer', async () => {
    const { fetchFn } = fakeFetch(200, {
      issuer: 'https://evil.example',
      jwks_uri: 'https://evil.example/jwks',
    });
    await expect(discoverJwksUri(TEST_ISSUER, fetchFn)).rejects.toThrow(/issuer mismatch/);
  });
});
