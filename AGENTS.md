# AGENTS.md

How to work in this repo. It's written for AI coding agents and humans alike. If a change makes this file wrong, update it in the same pull request.

## What this is

Atlas is a scaffold for internal company apps on Azure: React + Express in TypeScript, PostgreSQL, Azure Container Apps, Bicep and GitHub Actions, with no stored secrets anywhere.

- Design: `docs/specs/2026-10-13-atlas-scaffold-design.md`
- Decisions: `docs/adr/`
- Milestone plans: `docs/plans/`

## Layout

| Path        | Contains                                                              |
| ----------- | --------------------------------------------------------------------- |
| `apps/`     | Deployable apps (`web`, `api`; later `ai`)                            |
| `packages/` | Libraries imported by apps (`@atlas/shared`: zod schemas)             |
| `tests/`    | Cross-app tests (`e2e`)                                               |
| `infra/`    | Bicep                                                                 |
| `scripts/`  | `bootstrap.sh` and other operational scripts (bash, shellcheck-clean) |
| `docs/`     | Specs, plans, ADRs, runbooks                                          |

Current workspaces: `packages/shared`, `apps/api`.

## Commands

Run these from the repo root.

| Command                             | Does                                                                |
| ----------------------------------- | ------------------------------------------------------------------- |
| `npm ci`                            | Install exactly what the lockfile says                              |
| `npm run check`                     | **Definition of done**: lint + typecheck + all tests                |
| `npm run lint`                      | ESLint, Prettier check, actionlint, shellcheck                      |
| `npm run format`                    | Prettier write                                                      |
| `npm run typecheck`                 | `tsc --build` across all workspaces                                 |
| `npm test`                          | Unit tests in every workspace (no Docker)                           |
| `npm run test:integration`          | Integration tests (need Docker)                                     |
| `npm test -w @atlas/shared`         | Tests for one workspace                                             |
| `docker compose up -d --wait`       | Start local Postgres and the mock OIDC issuer                       |
| `npm run db:migrate -w @atlas/api`  | Apply migrations and grants locally (needs `apps/api/.env.migrate`) |
| `npm run dev -w @atlas/api`         | Run the API on :3000 with reload (needs `apps/api/.env`)            |
| `npm run db:generate -w @atlas/api` | Generate a migration after editing `src/db/schema.ts`               |

`npm run check` needs Docker running: the integration tests start Postgres with Testcontainers. To run one test file without the coverage gate failing on a partial run: `(cd apps/api && npx vitest run src/path/to.test.ts)`.

## Definition of done

`npm run check` passes. Don't disable a lint rule, skip a test or lower a coverage threshold to get there. Fix the cause, or explain the exception in the pull request.

## Conventions

- **TypeScript:** strict, ESM, `module: nodenext`. Relative imports end in `.js` (`import { Note } from './notes.js'`). TypeScript is pinned to 6.0.x (ADR 0013), so don't upgrade it to 7.
- **Tests sit next to the code:** `*.test.ts` for unit tests, `*.int.test.ts` for integration tests. Write the failing test first for new behaviour.
- **Validation:** zod schemas in `@atlas/shared` are the single source of truth for request and response shapes. Infer types with `z.infer`. Never hand-write a duplicate type.
- **Files: group code that changes together** (ADR 0014). A feature is three files: `<feature>.routes.ts`, `<feature>.service.ts` (when there is business logic) and `<feature>.repository.ts`, which holds the record types, the interface _and_ the Postgres implementation. Split a file only when it passes ~200 lines or has two unrelated reasons to change. Don't create a file for one small type, class or function.
- **Naming:** feature folders use `<feature>.<role>.ts` with a plural feature name (`notes.routes.ts`, `users.repository.ts`). Cross-cutting code uses descriptive kebab-case (`authenticate.ts`, `logging.ts`). Tests mirror their subject (`notes.service.test.ts`, `users.repository.int.test.ts`). Types and schemas are `PascalCase`, functions and variables `camelCase`, database tables and columns `snake_case`.
- **Intentionally unused:** prefix with `_` (`_next`, `const { secret: _secret, ...safe } = obj`). Everything else unused is a lint error.

## Base features and the reference feature

- **Base features ship in every app built on this scaffold:** sign-in, `app.users` (exposed as `GET /api/users/me` → `CurrentUser`), `app.audit_events`, and the health endpoints. Don't remove them.
- **Notes is the reference feature.** It shows the full pattern: shared zod schema → migration → grants → repository → service → route → tests → UI. Copy its structure for your first real feature, then delete it.
- **Authorization:** every endpoint requires the `access_as_user` scope. What a user _may do_ is decided by Entra App Roles (`req.auth.roles`), never by extra scopes or database role tables.

## Adding a feature to the API (copy the notes pattern)

1. **Contract:** zod schemas in `packages/shared/src/<feature>.ts`, with tests.
2. **Table:** add it to `apps/api/src/db/schema.ts` → `npm run db:generate -w @atlas/api` → review the generated SQL (never hand-edit it).
3. **Grants:** add the table to `APP_TABLE_GRANTS` in `apps/api/src/db/migrations.ts`. The integration tests fail until you do.
4. **Repository:** `src/<feature>/<feature>.repository.ts` (types, interface and Postgres implementation), plus an in-memory double in `src/test/in-memory-store.ts`. If it joins the unit of work, add it to `Repositories` in `src/db/database.ts`.
5. **Service:** `<feature>.service.ts`. Writes go through `unitOfWork.run(...)` and record an audit event in the same transaction.
6. **Routes:** `<feature>.routes.ts`. Validate with `parseOrThrow`, take the caller from `authOf(req)`, and mount the router in `app.ts` behind `replicaLimit, signedIn, perUserLimit`.
7. **Tests:** service unit tests, HTTP tests in `app.test.ts`, and `*.int.test.ts` for SQL behaviour such as ownership.

API layout:

| Path                              | Holds                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/app.ts`                      | Middleware order, rate limits, router mounting                                                                  |
| `src/server.ts`, `src/migrate.ts` | The two entrypoints (API, migration job)                                                                        |
| `src/config.ts`                   | Environment validation, including the issuer guard                                                              |
| `src/logging.ts`                  | pino logger with redaction, request ids                                                                         |
| `src/errors.ts`                   | `NotFoundError`, `HttpError`, `parseOrThrow`, problem+json error handler                                        |
| `src/auth/`                       | `tokens.ts` (claims, verifier, OIDC discovery), `authenticate.ts` (middleware, `authOf`)                        |
| `src/db/`                         | `schema.ts` (tables), `database.ts` (pool, Entra tokens, unit of work), `migrations.ts` (grants, migration job) |
| `src/<feature>/`                  | `users/`, `notes/`, `audit/`, `health/`                                                                         |

API code rules: `import { Pool } from 'pg'` (pg ships native ESM); routes never touch the database directly; services throw `NotFoundError`/`HttpError`, and the error handler turns them into problem+json. Never send a raw error message to a client.

## Git and pull requests

- Branch from `main`. Direct pushes to `main` are blocked by a ruleset.
- The PR title is a Conventional Commit (`feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `perf:`, `test:`, `build:`, `ci:`, `chore:`, `revert:`). It becomes the squash commit on `main`.
- Every required check must be green before merging. The checks are listed in `scripts/bootstrap.sh` (`REQUIRED_CHECKS`).

## Security rules (public repo)

- There are no secrets to commit, by design: CI uses OIDC and the apps use managed identities. If you think you need a secret, stop and raise it in the pull request.
- Never commit Azure tenant, subscription, client or object IDs, UPNs or email addresses. They belong in GitHub environment variables or git-ignored `.env` files.
- Never print those values in CI logs. Public-repo logs are world-readable.

## Database rules (from M2)

- Schema changes only through committed Drizzle migrations.
- **Expand, then contract.** Every migration must work with both the current and the previous API version. To rename or drop something: add the new thing → ship → switch reads and writes → ship → remove the old thing.
- A new table must be added to the grants allowlist (`APP_TABLE_GRANTS` in `apps/api/src/db/migrations.ts`), or the API can't read it.
