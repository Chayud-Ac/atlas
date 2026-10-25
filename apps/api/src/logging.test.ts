import type { IncomingMessage, ServerResponse } from 'node:http';
import { Writable } from 'node:stream';
import { ROOT_CONTEXT, TraceFlags, trace } from '@opentelemetry/api';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createLogger, genReqId, httpLogger, traceIdOf } from './logging.js';

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

describe('httpLogger', () => {
  it('logs one lean line per request, without headers', async () => {
    const { lines, stream } = captureLogs();
    const app = express();
    app.use(httpLogger(createLogger('info', stream)));
    app.get('/ping', (_req, res) => {
      res.status(204).end();
    });

    await request(app)
      .get('/ping?probe=1')
      .set('x-request-id', 'req-1')
      .set('Authorization', 'Bearer secret-token');

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('secret-token');
    const entry = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
    expect(entry.req).toEqual({ id: 'req-1', method: 'GET', url: '/ping?probe=1' });
    expect(entry.res).toEqual({ statusCode: 204 });
    expect(typeof entry.responseTime).toBe('number');
  });
});

function fakeExchange(requestId?: string) {
  const headers: Record<string, string> = {};
  const req = { headers: requestId === undefined ? {} : { 'x-request-id': requestId } };
  const res = {
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  };
  return {
    req: req as unknown as IncomingMessage,
    res: res as unknown as ServerResponse,
    headers,
  };
}

describe('genReqId', () => {
  it("reuses a caller's safe request id and echoes it", () => {
    const { req, res, headers } = fakeExchange('frontend-7f3a.42');
    expect(genReqId(req, res)).toBe('frontend-7f3a.42');
    expect(headers['x-request-id']).toBe('frontend-7f3a.42');
  });

  it('mints a UUID when the caller sends none', () => {
    const { req, res } = fakeExchange();
    expect(genReqId(req, res)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('replaces ids that could forge log lines', () => {
    const { req, res } = fakeExchange('ok\n{"level":"fatal","msg":"forged"}');
    expect(genReqId(req, res)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('replaces ids longer than 128 characters', () => {
    const { req, res } = fakeExchange('a'.repeat(129));
    expect(genReqId(req, res)).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('traceIdOf', () => {
  it('returns the trace id of the active span', () => {
    const ctx = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331',
      traceFlags: TraceFlags.SAMPLED,
    });
    expect(traceIdOf(ctx)).toBe('0af7651916cd43dd8448eb211c80319c');
  });

  it('returns null when there is no trace (telemetry is off)', () => {
    expect(traceIdOf()).toBeNull();
    expect(traceIdOf(ROOT_CONTEXT)).toBeNull();
  });
});
