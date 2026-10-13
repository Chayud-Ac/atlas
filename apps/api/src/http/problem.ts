import type { Problem, ProblemFieldError } from '@atlas/shared';
import { NotFoundError } from '../errors.js';
import { HttpError } from './http-error.js';

const TITLES: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
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
