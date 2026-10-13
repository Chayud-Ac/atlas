import { describe, expect, it } from 'vitest';
import { ConfigError, loadApiConfig, loadMigratorConfig } from './config.js';

const ENTRA_ISSUER = 'https://login.microsoftonline.com/00000000-0000-4000-8000-000000000001/v2.0';

const localEnv = {
  ATLAS_ENV: 'local',
  OIDC_ISSUER: 'http://localhost:8090/atlas',
  OIDC_AUDIENCE: 'atlas-api',
  DB_AUTH: 'password',
  DATABASE_URL: 'postgres://localhost:5432/atlas',
};

const cloudEnv = {
  ATLAS_ENV: 'prod',
  APP_VERSION: 'abc1234',
  OIDC_ISSUER: ENTRA_ISSUER,
  OIDC_AUDIENCE: 'api-client-id',
  DB_AUTH: 'entra',
  PGHOST: 'psql-atlas-prod.postgres.database.azure.com',
  PGDATABASE: 'atlas',
  PGUSER: 'id-atlas-api-prod',
  AZURE_CLIENT_ID: 'identity-client-id',
};

describe('loadApiConfig', () => {
  it('applies defaults for local development', () => {
    expect(loadApiConfig(localEnv)).toEqual({
      env: 'local',
      version: 'local',
      port: 3000,
      logLevel: 'info',
      oidc: {
        issuer: 'http://localhost:8090/atlas',
        audience: 'atlas-api',
        jwksUri: undefined,
        requiredScope: 'access_as_user',
      },
      db: { auth: 'password', url: 'postgres://localhost:5432/atlas' },
    });
  });

  it('builds an Entra token connection for cloud environments, with TLS on by default', () => {
    expect(loadApiConfig(cloudEnv).db).toEqual({
      auth: 'entra',
      host: 'psql-atlas-prod.postgres.database.azure.com',
      port: 5432,
      database: 'atlas',
      user: 'id-atlas-api-prod',
      ssl: true,
      clientId: 'identity-client-id',
    });
  });

  it('names the missing variable', () => {
    const { DATABASE_URL: _missing, ...env } = localEnv;
    expect(() => loadApiConfig(env)).toThrow(/DATABASE_URL/);
  });

  it('throws a ConfigError, so startup failures are recognisable', () => {
    expect(() => loadApiConfig({})).toThrow(ConfigError);
  });

  it.each(['dev', 'uat', 'prod'])('rejects a non-Entra issuer when ATLAS_ENV is %s', (env) => {
    expect(() =>
      loadApiConfig({ ...cloudEnv, ATLAS_ENV: env, OIDC_ISSUER: 'http://localhost:8090/atlas' }),
    ).toThrow(/OIDC_ISSUER/);
  });

  it.each(['local', 'ci'])('allows the mock issuer when ATLAS_ENV is %s', (env) => {
    expect(loadApiConfig({ ...localEnv, ATLAS_ENV: env }).oidc.issuer).toBe(
      'http://localhost:8090/atlas',
    );
  });

  it('rejects password database auth in cloud environments', () => {
    expect(() =>
      loadApiConfig({ ...localEnv, ATLAS_ENV: 'uat', OIDC_ISSUER: ENTRA_ISSUER }),
    ).toThrow(/DB_AUTH/);
  });

  it('rejects a port outside 1-65535', () => {
    expect(() => loadApiConfig({ ...localEnv, PORT: '70000' })).toThrow(/PORT/);
  });
});

describe('loadMigratorConfig', () => {
  const migratorEnv = { ...localEnv, API_ROLE_NAME: 'atlas_app' };

  it('reads the runtime role to grant to', () => {
    const config = loadMigratorConfig(migratorEnv);
    expect(config.appRole).toBe('atlas_app');
    expect(config.appPrincipalId).toBeUndefined();
  });

  it('rejects a role name that could break out of an identifier', () => {
    expect(() =>
      loadMigratorConfig({ ...migratorEnv, API_ROLE_NAME: 'x"; DROP ROLE y; --' }),
    ).toThrow(/API_ROLE_NAME/);
  });

  it('requires the principal id to be a GUID', () => {
    expect(() => loadMigratorConfig({ ...migratorEnv, API_PRINCIPAL_ID: 'nope' })).toThrow(
      /API_PRINCIPAL_ID/,
    );
  });
});
