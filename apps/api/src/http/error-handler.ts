import type { ErrorRequestHandler, RequestHandler } from 'express';
import { HttpError } from './http-error.js';
import { toProblem } from './problem.js';
import { requestIdOf } from './request-id.js';

export const notFound: RequestHandler = (req) => {
  throw new HttpError(404, `No route matches ${req.method} ${req.path}.`);
};

/** Last middleware: every error becomes application/problem+json. */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const problem = toProblem(err);
  if (problem.status >= 500) req.log.error({ err }, 'request failed');
  // RFC 6750: tell the client which authentication scheme to use.
  if (problem.status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
  res
    .status(problem.status)
    .type('application/problem+json')
    .json({ ...problem, requestId: requestIdOf(req) });
};
