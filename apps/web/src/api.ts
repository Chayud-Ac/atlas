import { Problem } from '@atlas/shared';
import { useMemo } from 'react';
import type { z } from 'zod';
import { type Auth, untilNavigation, useAuth } from './auth/auth.js';

/** A non-2xx API response, with its RFC 9457 problem body. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly problem: Problem;

  constructor(problem: Problem) {
    super(problem.detail ?? problem.title);
    this.problem = problem;
  }

  get status(): number {
    return this.problem.status;
  }
}

export interface ApiClient {
  get: <T>(path: string, schema: z.ZodType<T>) => Promise<T>;
  post: <T>(path: string, body: unknown, schema: z.ZodType<T>) => Promise<T>;
  delete: (path: string) => Promise<void>;
}

const REAUTH_KEY = 'atlas.reauth-at';
const REAUTH_INTERVAL_MS = 60_000;

/** Calls the API on this origin. Every response is checked against its shared zod schema. */
export function createApiClient(auth: Pick<Auth, 'getAccessToken' | 'signIn'>): ApiClient {
  async function send(method: string, path: string, body?: unknown): Promise<Response> {
    const headers = new Headers({
      accept: 'application/json',
      authorization: `Bearer ${await auth.getAccessToken()}`,
    });
    if (body !== undefined) headers.set('content-type', 'application/json');

    const response = await fetch(new URL(path, window.location.origin), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.ok) return response;

    const problem = await readProblem(response);
    // 401: the API rejected our token, so sign in again.
    if (response.status === 401 && claimReauth()) {
      await auth.signIn();
      return untilNavigation();
    }
    throw new ApiError(problem);
  }

  return {
    get: async (path, schema) => schema.parse(await (await send('GET', path)).json()),
    post: async (path, body, schema) => schema.parse(await (await send('POST', path, body)).json()),
    delete: async (path) => {
      await send('DELETE', path);
    },
  };
}

/** The API client for the signed-in user. */
export function useApi(): ApiClient {
  const auth = useAuth();
  return useMemo(() => createApiClient(auth), [auth]);
}

/**
 * At most one sign-in retry a minute. If a fresh token is rejected too (say, the
 * API expects another audience), the error is shown instead of redirecting forever.
 */
function claimReauth(): boolean {
  const last = Number(sessionStorage.getItem(REAUTH_KEY) ?? 0);
  if (Date.now() - last < REAUTH_INTERVAL_MS) return false;
  sessionStorage.setItem(REAUTH_KEY, String(Date.now()));
  return true;
}

async function readProblem(response: Response): Promise<Problem> {
  const parsed = Problem.safeParse(await response.json().catch(() => undefined));
  if (parsed.success) return parsed.data;
  // A proxy or gateway error page: keep the status, not the body.
  return {
    type: 'about:blank',
    title: response.statusText || 'Request failed',
    status: response.status,
  };
}
