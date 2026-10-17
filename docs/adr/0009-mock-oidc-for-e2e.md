# 0009. Mock OIDC for end-to-end tests, with the issuer guard

- **Status:** Accepted
- **Date:** 2026-10-17

## Context

- **End-to-end tests have to sign in.** Real Entra ID would need test users exempt from MFA. We can't create those in the university tenant, and automated tests can't do MFA.
- **The mock OIDC server** (`ghcr.io/navikt/mock-oauth2-server` in `compose.yaml`) issues signed tokens shaped like Entra's (`iss`, `aud`, `scp`, `oid`, `tid`, `name`). The web app's `mock` sign-in kind asks it for tokens directly (ADR 0007).
- **The tests need at least two users,** to prove that one can't see the other's notes.
- **In compose, the mock has two addresses.** The browser reaches it as `localhost:8090`, so tokens carry that issuer. The API container reaches it as `mock-oidc:8080`.

## Decision

- **Playwright tests (`tests/e2e`) run against the compose `full` stack with `ATLAS_ENV=ci`.** The API trusts the mock only because of that: its issuer guard refuses a non-Entra issuer in dev, UAT and prod.
- **Two test users in `dev/mock-oidc/config.json`, picked by the token request's `client_id`:**
  - `atlas-e2e-second-user` gets "Second User"
  - anything else gets "Local Developer", the default for development and the first test user

  The mock uses the first mapping that matches, so the second user's mapping comes first.

- **A test signs in as the second user by changing `auth.clientId` in `/config.json`** for its browser context (a Playwright route). The sign-in code is the app's own; nothing test-only ships in the bundle.
- **The API checks the token's `iss` against `http://localhost:8090/atlas`** and fetches the keys from `OIDC_JWKS_URI=http://mock-oidc:8080/atlas/jwks`.
- **Playwright runs on the host and the CI runner, not in a container,** so the browser uses the same addresses as a developer. Chromium only, for now.
- **A CSP violation fails any test** (ADR 0016).

## Consequences

- **The tests cover our whole path:** UI, nginx, the API's token validation, the database and ownership. They don't cover Entra itself. MSAL is exercised against real Entra in deployed environments (the M5 sign-in check).
- **A company would add Entra-backed E2E tests in UAT,** with a dedicated test user excluded from MFA by conditional access, and keep this mock suite on every pull request.
- **The mock's signing keys are generated when it starts,** so its tokens are worthless anywhere else.
- **A role-based scenario later means another mock user** with a `roles` claim.
