import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

function captureLogs() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { lines, stream };
}

describe('createLogger', () => {
  it('never writes bearer tokens or cookies to the log', () => {
    const { lines, stream } = captureLogs();
    const logger = createLogger('info', stream);

    logger.info(
      {
        req: {
          headers: { authorization: 'Bearer secret-token', cookie: 'session=abc', accept: 'json' },
        },
      },
      'request',
    );

    const line = lines[0] ?? '';
    expect(line).not.toContain('secret-token');
    expect(line).not.toContain('session=abc');
    const entry = JSON.parse(line) as { req: { headers: Record<string, string> } };
    expect(entry.req.headers).toEqual({
      authorization: '[redacted]',
      cookie: '[redacted]',
      accept: 'json',
    });
  });

  it('respects the level', () => {
    const { lines, stream } = captureLogs();
    createLogger('warn', stream).info('hidden');
    expect(lines).toEqual([]);
  });
});
