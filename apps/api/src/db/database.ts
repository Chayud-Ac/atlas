import { ManagedIdentityCredential } from '@azure/identity';
import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { Pool, PoolConfig } from 'pg';
import { createPgAuditRepository, type AuditRepository } from '../audit/audit.repository.js';
import type { DbConfig } from '../config.js';
import { createPgNotesRepository, type NotesRepository } from '../notes/notes.repository.js';

// --- Connections -----------------------------------------------------------------------------

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

/** Tokens for the container app's user-assigned identity. The credential caches them until near expiry. */
export function managedIdentityTokens(clientId: string): TokenProvider {
  const credential = new ManagedIdentityCredential({ clientId });
  return async (scope) => (await credential.getToken(scope)).token;
}

/** The token provider for a config: managed identity in Azure, unused with password auth. */
export function tokenProviderFor(db: DbConfig): TokenProvider {
  return db.auth === 'entra'
    ? managedIdentityTokens(db.clientId)
    : () => Promise.reject(new Error('Entra tokens are not used with password auth'));
}

// --- Drizzle ---------------------------------------------------------------------------------

export type Database = NodePgDatabase;

/** A database handle or an open transaction. Repositories accept either. */
export type Executor = PgDatabase<NodePgQueryResultHKT>;

export function createDatabase(pool: Pool): Database {
  return drizzle({ client: pool });
}

// --- Unit of work ----------------------------------------------------------------------------

export interface Repositories {
  notes: NotesRepository;
  audit: AuditRepository;
}

/** Runs `work` in one transaction: everything it writes commits or rolls back together. */
export interface UnitOfWork {
  run<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
}

/** Each `run` is one Postgres transaction. Repositories inside it share that transaction. */
export function createPgUnitOfWork(db: Database): UnitOfWork {
  return {
    run: (work) =>
      db.transaction((tx) =>
        work({ notes: createPgNotesRepository(tx), audit: createPgAuditRepository(tx) }),
      ),
  };
}
