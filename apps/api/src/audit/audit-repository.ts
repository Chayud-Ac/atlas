/** One row in app.audit_events. Keep `data` small, and never put secrets in it. */
export interface AuditEvent {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  data?: Record<string, unknown>;
  requestId?: string | null;
}

export interface AuditRepository {
  record(event: AuditEvent): Promise<void>;
}
