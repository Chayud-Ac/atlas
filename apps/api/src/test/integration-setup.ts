import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client, escapeLiteral, Pool } from 'pg';
import type { TestProject } from 'vitest/node';
import { runMigrationJob } from '../db/migration-job.js';
import { createLogger } from '../logger.js';
import { APP_ROLE, MIGRATIONS_FOLDER } from './postgres.js';

declare module 'vitest' {
  export interface ProvidedContext {
    postgres: { migratorUrl: string; appUrl: string };
  }
}

let container: StartedPostgreSqlContainer | undefined;

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  container = await new PostgreSqlContainer('postgres:17-alpine').withDatabase('atlas').start();
  const adminUrl = container.getConnectionUri();

  const migratorPassword = randomUUID();
  const appPassword = randomUUID();
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(
      `CREATE ROLE atlas_migrator LOGIN PASSWORD ${escapeLiteral(migratorPassword)}`,
    );
    await admin.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD ${escapeLiteral(appPassword)}`);
    await admin.query('GRANT CONNECT, CREATE ON DATABASE atlas TO atlas_migrator');
    await admin.query(`GRANT CONNECT ON DATABASE atlas TO ${APP_ROLE}`);
  } finally {
    await admin.end();
  }

  const migratorUrl = withCredentials(adminUrl, 'atlas_migrator', migratorPassword);
  const appUrl = withCredentials(adminUrl, APP_ROLE, appPassword);

  const migrator = new Pool({ connectionString: migratorUrl });
  try {
    await runMigrationJob(migrator, {
      migrationsFolder: MIGRATIONS_FOLDER,
      appRole: APP_ROLE,
      logger: createLogger('silent'),
    });
  } finally {
    await migrator.end();
  }

  project.provide('postgres', { migratorUrl, appUrl });
  return async () => {
    await container?.stop();
  };
}

function withCredentials(url: string, user: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = user;
  parsed.password = password;
  return parsed.toString();
}
