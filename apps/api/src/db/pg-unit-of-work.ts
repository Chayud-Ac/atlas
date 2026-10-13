import { createPgAuditRepository } from '../audit/pg-audit-repository.js';
import { createPgNotesRepository } from '../notes/pg-notes-repository.js';
import type { UnitOfWork } from '../unit-of-work.js';
import type { Database } from './client.js';

/** Each `run` is one Postgres transaction. Repositories inside it share that transaction. */
export function createPgUnitOfWork(db: Database): UnitOfWork {
  return {
    run: (work) =>
      db.transaction((tx) =>
        work({ notes: createPgNotesRepository(tx), audit: createPgAuditRepository(tx) }),
      ),
  };
}
