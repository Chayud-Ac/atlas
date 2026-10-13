import type { PoolConfig } from 'pg';
import type { DbConfig } from '../config.js';

export const ENTRA_DB_SCOPE = 'https://ossrdbms-aad.database.windows.net/.default';

export type TokenProvider = (scope: string) => Promise<string>;

export function poolConfig(db: DbConfig, getToken: TokenProvider): PoolConfig {
  if (db.auth === 'password') return { connectionString: db.url, max: 10 };
  return {
    host: db.host,
    port: db.port,
    database: db.database,
    user: db.user,
    ssl: db.ssl ? { rejectUnauthorized: true } : false,
    max: 10,
    // Called for every new connection, so an expired token is never reused.
    password: () => getToken(ENTRA_DB_SCOPE),
  };
}
