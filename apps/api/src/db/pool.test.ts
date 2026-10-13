import { describe, expect, it } from 'vitest';
import { ENTRA_DB_SCOPE, poolConfig, type TokenProvider } from './pool.js';

describe('poolConfig', () => {
  it('uses the connection string for password auth', () => {
    const config = poolConfig({ auth: 'password', url: 'postgres://localhost/atlas' }, () =>
      Promise.reject(new Error('not used')),
    );
    expect(config).toMatchObject({ connectionString: 'postgres://localhost/atlas' });
  });

  it('fetches a fresh Entra token as the password for every new connection', async () => {
    const scopes: string[] = [];
    const tokens: TokenProvider = (scope) => {
      scopes.push(scope);
      return Promise.resolve(`token-${scopes.length}`);
    };
    const config = poolConfig(
      {
        auth: 'entra',
        host: 'db.example',
        port: 5432,
        database: 'atlas',
        user: 'id-atlas-api-dev',
        ssl: true,
        clientId: 'client-id',
      },
      tokens,
    );

    expect(config).toMatchObject({
      host: 'db.example',
      port: 5432,
      database: 'atlas',
      user: 'id-atlas-api-dev',
      ssl: { rejectUnauthorized: true },
    });
    const password = config.password;
    if (typeof password !== 'function') throw new Error('expected a password function');
    expect(await password()).toBe('token-1');
    expect(await password()).toBe('token-2');
    expect(scopes).toEqual([ENTRA_DB_SCOPE, ENTRA_DB_SCOPE]);
  });
});
