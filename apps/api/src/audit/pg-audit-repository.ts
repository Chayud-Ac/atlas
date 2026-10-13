import type { Executor } from '../db/client.js';
import { auditEvents } from '../db/schema.js';
import type { AuditRepository } from './audit-repository.js';

export function createPgAuditRepository(db: Executor): AuditRepository {
  return {
    async record(event) {
      await db.insert(auditEvents).values({
        actorUserId: event.actorUserId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        data: event.data ?? {},
        requestId: event.requestId ?? null,
      });
    },
  };
}
