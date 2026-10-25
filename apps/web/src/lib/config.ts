import { z } from 'zod';

/** How the app signs users in. Every value here is a public identifier. */
export const AuthSettings = z.object({
  /** `msal`: Entra ID. `mock`: the local mock OIDC server (ADR 0007). */
  kind: z.enum(['msal', 'mock']),
  authority: z.url(),
  clientId: z.string().min(1),
  /** The API's delegated scope, e.g. `api://<api-client-id>/access_as_user`. */
  apiScope: z.string().min(1),
});
export type AuthSettings = z.infer<typeof AuthSettings>;

/**
 * The shape of /config.json. The container writes it at startup from environment
 * variables, so one build runs in every environment (spec §10, ADR 0007).
 */
export const RuntimeConfig = z
  .object({
    env: z.enum(['local', 'ci', 'dev', 'uat', 'prod']),
    auth: AuthSettings,
    /** Application Insights, for the browser SDK. Empty or missing: no telemetry is sent. */
    telemetry: z.object({ connectionString: z.string() }).optional(),
  })
  // Same idea as the API's issuer guard: the mock is for local and CI only.
  .refine((config) => config.auth.kind === 'msal' || ['local', 'ci'].includes(config.env), {
    message: 'Mock sign-in is only allowed when env is local or ci',
    path: ['auth', 'kind'],
  })
  .refine((config) => config.auth.kind === 'mock' || config.auth.authority.startsWith('https://'), {
    message: 'MSAL needs an https authority',
    path: ['auth', 'authority'],
  });
export type RuntimeConfig = z.infer<typeof RuntimeConfig>;

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  // An absolute URL, because Node's fetch (used in tests) can't resolve a relative one.
  // no-store: a redeploy can change the config without changing the URL.
  const response = await fetch(new URL('/config.json', window.location.origin), {
    cache: 'no-store',
  });
  if (!response.ok) throw new ConfigError(`GET /config.json returned ${response.status}`);
  const parsed = RuntimeConfig.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) {
    throw new ConfigError(`Invalid /config.json:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
