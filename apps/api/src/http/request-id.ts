import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Request id for logs, problem bodies and audit rows (pino-http `genReqId`).
 * Reuses the caller's x-request-id when it can't forge log lines; otherwise mints one.
 */
export function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const id =
    typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', id);
  return id;
}

/**
 * The id assigned by `genReqId`. pino-http adds `req.id` with a loose type, so narrow it here.
 * The `& { id?: unknown }` keeps this compiling whether or not pino-http's types are loaded.
 */
export function requestIdOf(req: IncomingMessage & { id?: unknown }): string {
  return typeof req.id === 'string' ? req.id : '';
}
