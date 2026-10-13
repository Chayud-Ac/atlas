import { pino, type DestinationStream, type Logger } from 'pino';

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
