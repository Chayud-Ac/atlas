# 0005. Database identity: Entra-only auth, separate migrator and runtime roles, grants allowlist

- **Status:** Accepted
- **Date:** 2026-10-13

## Context

Database passwords are the most common secret in web apps: they get committed, logged, shared and never rotated. A single all-powerful database user also means that any SQL injection or bug in the API can drop tables or rewrite the audit trail.

## Decision

- **Azure:** password authentication is disabled. Each identity connects with a short-lived Entra token, fetched for every new connection (`poolConfig` in `apps/api/src/db/pool.ts`).
- **Two roles:**
  - The **migrator** (`id-atlas-migrator-{env}`, `atlas_migrator` locally) owns schema `app` and is the only role that can change it.
  - The **runtime role** (`id-atlas-api-{env}`, `atlas_app` locally) gets only the privileges listed in `APP_TABLE_GRANTS`. Notably, `app.audit_events` is `SELECT, INSERT` only, so the trail is append-only _in the database_.
- **No default privileges.** The migration job revokes and re-applies the allowlist every run, so drift is corrected. A new table is invisible to the API until someone adds it, deliberately, in a reviewed PR.
- **Local dev and Testcontainers create the same two roles,** so least-privilege bugs show up on a laptop, not in prod.

## Consequences

- No database secret exists anywhere: not in GitHub, not in Container Apps, not in `.env` for the cloud.
- Every new table needs one extra line in `grants.ts`, and the integration tests enforce it.
- Humans don't get standing access to UAT or prod databases (see `docs/runbooks/database-access.md`, M7).
