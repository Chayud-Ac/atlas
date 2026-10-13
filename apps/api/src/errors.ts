import type { Problem, ProblemFieldError } from '@atlas/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { z } from 'zod';
import { requestIdOf } from './logging.js';

/** Thrown by services when an entity doesn't exist or isn't visible to the caller. */
export class NotFoundError extends Error {
  override name = 'NotFoundError';
}

/** An error that maps directly to an HTTP status. Its message is safe to show to clients. */
export class HttpError extends Error {
  override name = 'HttpError';
  readonly status: number;
  readonly errors: ProblemFieldError[] | undefined;

  constructor(status: number, detail: string, errors?: ProblemFieldError[]) {
    super(detail);
    this.status = status;
    this.errors = errors;
  }
}

/** Validates request input; on failure throws a 400 listing every invalid field. */
export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new HttpError(
    400,
    'The request is invalid.',
    result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  );
}

const TITLES: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

/** Errors from Express's body parser (the http-errors package) that are safe to show. */
interface ExposedHttpError {
  status: number;
  expose: true;
  message: string;
}

function isExposedClientError(err: unknown): err is ExposedHttpError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    typeof err.status === 'number' &&
    err.status >= 400 &&
    err.status < 500 &&
    'expose' in err &&
    err.expose === true &&
    'message' in err &&
    typeof err.message === 'string'
  );
}

/** Turns anything thrown during a request into an RFC 9457 problem. Unknown errors reveal nothing. */
export function toProblem(err: unknown): Problem {
  if (err instanceof HttpError) return problem(err.status, err.message, err.errors);
  if (err instanceof NotFoundError) return problem(404, err.message);
  if (isExposedClientError(err)) return problem(err.status, err.message);
  return problem(500, 'An unexpected error occurred.');
}

function problem(status: number, detail: string, errors?: ProblemFieldError[]): Problem {
  return {
    type: 'about:blank',
    title: TITLES[status] ?? 'Error',
    status,
    detail,
    ...(errors ? { errors } : {}),
  };
}

export const notFound: RequestHandler = (req) => {
  throw new HttpError(404, `No route matches ${req.method} ${req.path}.`);
};

/** Last middleware: every error becomes application/problem+json. */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const body = toProblem(err);
  if (body.status >= 500) req.log.error({ err }, 'request failed');
  // RFC 6750: tell the client which authentication scheme to use.
  if (body.status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
  res
    .status(body.status)
    .type('application/problem+json')
    .json({ ...body, requestId: requestIdOf(req) });
};
