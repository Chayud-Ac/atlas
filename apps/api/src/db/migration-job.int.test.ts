import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../logger.js';
import { APP_ROLE, connectAs, MIGRATIONS_FOLDER } from '../test/postgres.js';
import { APP_TABLE_GRANTS } from './grants.js';
import { runMigrationJob } from './migration-job.js';

let migrator: Pool;

beforeAll(() => {
  migrator = connectAs('migrator');
});

afterAll(async () => {
  await migrator.end();
});

describe('runMigrationJob', () => {
  it('creates exactly the tables in the grants allowlist', async () => {
    const { rows } = await migrator.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'app' ORDER BY table_name",
    );
    expect(rows.map((row) => row.table_name)).toEqual(Object.keys(APP_TABLE_GRANTS).sort());
  });

  it('is a no-op when re-run, even by two instances at once', async () => {
    const applied = async () =>
      (
        await migrator.query<{ n: string }>(
          'SELECT count(*) AS n FROM drizzle.__drizzle_migrations',
        )
      ).rows[0]?.n;
    const before = await applied();
    const options = {
      migrationsFolder: MIGRATIONS_FOLDER,
      appRole: APP_ROLE,
      logger: createLogger('silent'),
    };

    await Promise.all([runMigrationJob(migrator, options), runMigrationJob(migrator, options)]);

    expect(await applied()).toBe(before);
  });
});
