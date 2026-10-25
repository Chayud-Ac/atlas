import type { Executor } from '../db/database.js';
import { auditEvents } from '../db/schema.js';

/** One row in app.audit_events. Keep `data` small, and never put secrets in it. */
export interface AuditEvent {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  data?: Record<string, unknown>;
  requestId?: string | null;
  traceId?: string | null;
}

export interface AuditRepository {
  record(event: AuditEvent): Promise<void>;
}

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
        traceId: event.traceId ?? null,
      });
    },
  };
}
