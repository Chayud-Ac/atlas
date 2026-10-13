import { z } from 'zod';

/** One validation failure, pointing at the offending field. */
export const ProblemFieldError = z.strictObject({
  path: z.string(),
  message: z.string(),
});
export type ProblemFieldError = z.infer<typeof ProblemFieldError>;

/**
 * Error body for every non-2xx API response (RFC 9457, application/problem+json).
 * `requestId` matches the x-request-id response header and the API's log lines.
 * Not strict: RFC 9457 allows extension members, which are ignored.
 */
export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.int().min(400).max(599),
  detail: z.string().optional(),
  errors: z.array(ProblemFieldError).optional(),
  requestId: z.string().optional(),
});
export type Problem = z.infer<typeof Problem>;
