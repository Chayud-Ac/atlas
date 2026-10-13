import { describe, expect, it } from 'vitest';
import { Problem } from './problem.js';

describe('Problem', () => {
  it('accepts a minimal problem', () => {
    const problem = { type: 'about:blank', title: 'Not Found', status: 404 };
    expect(Problem.parse(problem)).toEqual(problem);
  });

  it('accepts a validation problem with field errors and a request id', () => {
    const problem = {
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'The request is invalid.',
      errors: [{ path: 'title', message: 'Title is required' }],
      requestId: 'req-123',
    };
    expect(Problem.parse(problem)).toEqual(problem);
  });

  it('ignores extension members, which RFC 9457 allows', () => {
    const parsed = Problem.parse({
      type: 'about:blank',
      title: 'Gone',
      status: 410,
      retryAfter: 5,
    });
    expect(parsed).toEqual({ type: 'about:blank', title: 'Gone', status: 410 });
  });

  it('rejects a success status', () => {
    expect(Problem.safeParse({ type: 'about:blank', title: 'OK', status: 200 }).success).toBe(
      false,
    );
  });

  it('rejects a non-integer status', () => {
    expect(Problem.safeParse({ type: 'about:blank', title: 'X', status: 404.5 }).success).toBe(
      false,
    );
  });
});
