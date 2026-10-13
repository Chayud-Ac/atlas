import type { z } from 'zod';
import { HttpError } from './http-error.js';

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
