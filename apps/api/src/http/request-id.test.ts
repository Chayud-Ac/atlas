import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { genReqId } from './request-id.js';

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
