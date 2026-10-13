# 0007. Runtime web config (`/config.json`) and local sign-in

- **Status:** Accepted
- **Date:** 2026-10-13

## Context

- **We build once and promote the same image** from dev to UAT to prod (ADR 0002). Vite normally bakes settings into the bundle at build time (`import.meta.env`), which would mean one build per environment. The web app still needs per-environment settings: the Entra authority, its client ID and the API scope.
- **MSAL refuses any authority that isn't `https:`, `localhost` included.** It throws `authority_uri_insecure` (`UrlString.validateAsUri` in `@azure/msal-common`). Our local and CI issuer, the mock OIDC server in `compose.yaml`, is `http://localhost:8090/atlas`. The spec planned MSAL in `protocolMode: OIDC` against it and listed this as a risk; M3 confirmed the risk.
- **We can't create MFA-exempt test users in the tenant,** so automated tests can't sign in to real Entra.
- **The mock's token endpoint** answers CORS for the dev origin and issues access tokens shaped like Entra's (`iss`, `aud`, `scp`, `oid`, `tid`, `name`).

## Decision

- **`main.tsx` fetches `/config.json`** (`cache: 'no-store'`) before anything else and validates it with zod (`RuntimeConfig` in `apps/web/src/config.ts`). A bad config stops startup with a clear error.
- **The file holds only public identifiers:** `env`, plus `auth.kind`, `auth.authority`, `auth.clientId` and `auth.apiScope`.
- **Where the file comes from:**
  - In the container, a startup script renders it from environment variables (M4).
  - Locally, it's a git-ignored copy of `apps/web/config.example.json` in `apps/web/public/`. Switching to the real `atlas-dev-*` registrations means putting client IDs in it, which is why the copy is git-ignored.
- **`auth.kind` chooses the implementation** of the app-owned `Auth` interface:
  - `msal`: Entra ID through `@azure/msal-browser` redirects.
  - `mock`: asks the mock's token endpoint directly (`client_credentials`) and keeps the token in `sessionStorage`.

  Components and tests only see `Auth`.

- **Two guards keep the mock out of the cloud:**
  - The config schema accepts `kind: "mock"` only when `env` is `local` or `ci`.
  - The API's issuer guard refuses to start with a non-Entra issuer in dev, UAT and prod, so a mock token is useless there. This is the real protection.
- **No `@azure/msal-react`.** Sign-in and sign-out are redirects, so the signed-in state is known once at startup and only changes with a page load. msal-react's reactive state and event wiring would add a dependency and nothing else.

## Consequences

- **One web image runs everywhere,** and a config change needs a restart, not a rebuild. `/config.json` must be served `no-store` (nginx, M4).
- **MSAL itself is only exercised against real Entra,** in deployed environments: the M5 sign-in check and manual use. Unit tests cover our wrapper's logic (silent token, a redirect when interaction is required, other errors passed on) with a fake client.
- **A company would add Entra-backed E2E tests in UAT,** using a dedicated test user excluded from MFA by conditional access.
- **The mock path ships in the production bundle,** because E2E tests run the production build. It's a small part of the 7 kB app chunk, and it can only be turned on through `/config.json`, which the schema and the API's issuer guard both reject outside local and CI.
- **The container variables `AUTH_PROTOCOL_MODE` and `AUTH_KNOWN_AUTHORITIES` become `AUTH_KIND`** (spec §16).
