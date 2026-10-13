import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';

export const TEST_TENANT = '00000000-0000-4000-8000-000000000001';
export const TEST_ISSUER = `https://login.microsoftonline.com/${TEST_TENANT}/v2.0`;
export const TEST_AUDIENCE = 'atlas-api-test';
export const TEST_SCOPE = 'access_as_user';

export const ALICE = {
  oid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tid: TEST_TENANT,
  name: 'Alice Example',
  preferred_username: 'alice@example.com',
};

export const BOB = {
  oid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  tid: TEST_TENANT,
  name: 'Bob Example',
  preferred_username: 'bob@example.com',
};

export interface SignOptions {
  issuer?: string;
  audience?: string;
  /** Absolute epoch seconds, or a relative time such as '5m'. */
  expiresAt?: number | string;
  notBefore?: number | string;
  /** Sign with a key the verifier doesn't trust. */
  untrustedKey?: boolean;
}

export async function createTestIssuer() {
  const trusted = await generateKeyPair('RS256');
  const untrusted = await generateKeyPair('RS256');
  const publicJwk = {
    ...(await exportJWK(trusted.publicKey)),
    kid: 'test-key',
    alg: 'RS256',
    use: 'sig',
  };
  const getKey = createLocalJWKSet({ keys: [publicJwk] });

  /** A token for Alice with the API scope, unless `claims` overrides it. */
  async function sign(claims: JWTPayload = {}, options: SignOptions = {}): Promise<string> {
    const jwt = new SignJWT({ ...ALICE, scp: TEST_SCOPE, ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(options.issuer ?? TEST_ISSUER)
      .setAudience(options.audience ?? TEST_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(options.expiresAt ?? '5m');
    if (options.notBefore !== undefined) jwt.setNotBefore(options.notBefore);
    return jwt.sign(options.untrustedKey ? untrusted.privateKey : trusted.privateKey);
  }

  return { getKey, sign };
}

export type TestIssuer = Awaited<ReturnType<typeof createTestIssuer>>;
