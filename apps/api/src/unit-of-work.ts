import type { AuditRepository } from './audit/audit-repository.js';
import type { NotesRepository } from './notes/notes-repository.js';

export interface Repositories {
  notes: NotesRepository;
  audit: AuditRepository;
}

/** Runs `work` in one transaction: everything it writes commits or rolls back together. */
export interface UnitOfWork {
  run<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
}
