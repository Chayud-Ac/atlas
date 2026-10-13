import type { ProblemFieldError } from '@atlas/shared';

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
