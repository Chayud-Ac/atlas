import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { Pool } from 'pg';

export type Database = NodePgDatabase;

/** A database handle or an open transaction. Repositories accept either. */
export type Executor = PgDatabase<NodePgQueryResultHKT>;

export function createDatabase(pool: Pool): Database {
  return drizzle({ client: pool });
}
