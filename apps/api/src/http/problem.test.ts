import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../errors.js';
import { HttpError } from './http-error.js';
import { toProblem } from './problem.js';

describe('toProblem', () => {
  it('uses the status, detail and field errors of an HttpError', () => {
    const errors = [{ path: 'title', message: 'Title is required' }];
    expect(toProblem(new HttpError(400, 'The request is invalid.', errors))).toEqual({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'The request is invalid.',
      errors,
    });
  });

  it('maps NotFoundError to 404', () => {
    expect(toProblem(new NotFoundError('Note not found.'))).toMatchObject({
      status: 404,
      title: 'Not Found',
      detail: 'Note not found.',
    });
  });

  it("passes through the body parser's client errors", () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      status: 413,
      expose: true,
    });
    expect(toProblem(tooLarge)).toMatchObject({ status: 413, title: 'Content Too Large' });
  });

  it('never trusts a 5xx from a dependency', () => {
    const upstream = Object.assign(new Error('upstream exploded'), { status: 502, expose: true });
    expect(toProblem(upstream)).toMatchObject({ status: 500 });
  });

  it('hides the message of unexpected errors', () => {
    const problem = toProblem(new Error('password authentication failed for user "atlas_app"'));
    expect(problem).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: 'An unexpected error occurred.',
    });
  });

  it('handles thrown values that are not errors', () => {
    expect(toProblem('boom')).toMatchObject({ status: 500 });
  });
});
