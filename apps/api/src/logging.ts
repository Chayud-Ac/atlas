import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  pino,
  type DestinationStream,
  type Logger,
  type SerializedRequest,
  type SerializedResponse,
} from 'pino';
import { pinoHttp, type HttpLogger } from 'pino-http';

export type { Logger } from 'pino';

/** Credentials that must never reach the logs (Log Analytics is readable by many people). */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino({ level, redact: { paths: REDACTED_PATHS, censor: '[redacted]' } }, destination);
}

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

export function httpLogger(logger: Logger): HttpLogger {
  return pinoHttp({
    logger,
    genReqId,
    serializers: {
      req: (req: SerializedRequest) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res: SerializedResponse) => ({ statusCode: res.statusCode }),
    },
  });
}

/**
 * The id assigned by `genReqId`. pino-http adds `req.id` with a loose type, so narrow it here.
 * The `& { id?: unknown }` keeps this compiling whether or not pino-http's types are loaded.
 */
export function requestIdOf(req: IncomingMessage & { id?: unknown }): string {
  return typeof req.id === 'string' ? req.id : '';
}
