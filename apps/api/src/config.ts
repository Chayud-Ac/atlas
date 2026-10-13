import { z } from 'zod';
import { ROLE_NAME } from './db/grants.js';

type Env = Record<string, string | undefined>;

const ENTRA_ISSUER = /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/;
const CLOUD_ENVS: ReadonlySet<string> = new Set(['dev', 'uat', 'prod']);

const Common = z.object({
  ATLAS_ENV: z.enum(['local', 'ci', 'dev', 'uat', 'prod']),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const Api = Common.extend({
  APP_VERSION: z.string().min(1).default('local'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  OIDC_ISSUER: z.url(),
  OIDC_AUDIENCE: z.string().min(1),
  OIDC_JWKS_URI: z.url().optional(),
  REQUIRED_SCOPE: z.string().min(1).default('access_as_user'),
}).superRefine((env, ctx) => {
  // Issuer guard (spec §6.3): only local and CI may trust a non-Entra issuer such as the mock.
  if (CLOUD_ENVS.has(env.ATLAS_ENV) && !ENTRA_ISSUER.test(env.OIDC_ISSUER)) {
    ctx.addIssue({
      code: 'custom',
      path: ['OIDC_ISSUER'],
      message: `must be an Entra ID v2.0 issuer when ATLAS_ENV is ${env.ATLAS_ENV}`,
    });
  }
});

const Migrator = Common.extend({
  API_ROLE_NAME: z.string().regex(ROLE_NAME, 'must be a plain role name'),
  API_PRINCIPAL_ID: z.guid().optional(),
});

const Db = z.discriminatedUnion('DB_AUTH', [
  z.object({ DB_AUTH: z.literal('password'), DATABASE_URL: z.string().min(1) }),
  z.object({
    DB_AUTH: z.literal('entra'),
    PGHOST: z.string().min(1),
    PGPORT: z.coerce.number().int().min(1).max(65_535).default(5432),
    PGDATABASE: z.string().min(1),
    PGUSER: z.string().min(1),
    PGSSLMODE: z.enum(['disable', 'require']).default('require'),
    AZURE_CLIENT_ID: z.string().min(1),
  }),
]);

export type AtlasEnv = z.infer<typeof Common>['ATLAS_ENV'];
export type LogLevel = z.infer<typeof Common>['LOG_LEVEL'];

export type DbConfig =
  | { auth: 'password'; url: string }
  | {
      auth: 'entra';
      host: string;
      port: number;
      database: string;
      user: string;
      ssl: boolean;
      clientId: string;
    };

export interface ApiConfig {
  env: AtlasEnv;
  version: string;
  port: number;
  logLevel: LogLevel;
  oidc: { issuer: string; audience: string; jwksUri: string | undefined; requiredScope: string };
  db: DbConfig;
}

export interface MigratorConfig {
  env: AtlasEnv;
  logLevel: LogLevel;
  db: DbConfig;
  appRole: string;
  appPrincipalId: string | undefined;
}

/** Thrown at startup when the environment is invalid. The message lists every problem. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function loadApiConfig(env: Env): ApiConfig {
  const api = parse(Api, env);
  const db = loadDbConfig(api.ATLAS_ENV, env);
  return {
    env: api.ATLAS_ENV,
    version: api.APP_VERSION,
    port: api.PORT,
    logLevel: api.LOG_LEVEL,
    oidc: {
      issuer: api.OIDC_ISSUER,
      audience: api.OIDC_AUDIENCE,
      jwksUri: api.OIDC_JWKS_URI,
      requiredScope: api.REQUIRED_SCOPE,
    },
    db,
  };
}

export function loadMigratorConfig(env: Env): MigratorConfig {
  const migrator = parse(Migrator, env);
  return {
    env: migrator.ATLAS_ENV,
    logLevel: migrator.LOG_LEVEL,
    db: loadDbConfig(migrator.ATLAS_ENV, env),
    appRole: migrator.API_ROLE_NAME,
    appPrincipalId: migrator.API_PRINCIPAL_ID,
  };
}

function loadDbConfig(atlasEnv: AtlasEnv, env: Env): DbConfig {
  const db = parse(Db, env);
  if (db.DB_AUTH === 'password') {
    if (CLOUD_ENVS.has(atlasEnv)) {
      throw new ConfigError(
        `Invalid configuration:\n✖ DB_AUTH must be "entra" when ATLAS_ENV is ${atlasEnv}\n  → at DB_AUTH`,
      );
    }
    return { auth: 'password', url: db.DATABASE_URL };
  }
  return {
    auth: 'entra',
    host: db.PGHOST,
    port: db.PGPORT,
    database: db.PGDATABASE,
    user: db.PGUSER,
    ssl: db.PGSSLMODE === 'require',
    clientId: db.AZURE_CLIENT_ID,
  };
}

function parse<S extends z.ZodType>(schema: S, env: Env): z.infer<S> {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
