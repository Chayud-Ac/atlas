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
import { createTokenVerifier, type TokenVerifier } from './token-verifier.js';

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
