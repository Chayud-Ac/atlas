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

Current workspaces: `packages/shared`, `apps/api`, `apps/web`, `tests/e2e`.

## Commands

Run these from the repo root.

| Command                                              | Does                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `npm ci`                                             | Install exactly what the lockfile says                                   |
| `npm run check`                                      | **Definition of done**: lint + typecheck + build + all tests             |
| `npm run lint`                                       | ESLint, Prettier check, actionlint, shellcheck                           |
| `npm run format`                                     | Prettier write                                                           |
| `npm run typecheck`                                  | `tsc --build` across all workspaces                                      |
| `npm run build`                                      | Build every workspace (`vite build` for the web app)                     |
| `npm test`                                           | Unit tests in every workspace (no Docker)                                |
| `npm run test:integration`                           | Integration tests (need Docker)                                          |
| `npm run test:e2e`                                   | Playwright tests against the running full stack (see "E2E tests")        |
| `npm test -w @atlas/shared`                          | Tests for one workspace                                                  |
| `docker compose up -d --wait`                        | Start local Postgres and the mock OIDC issuer                            |
| `npm run db:migrate -w @atlas/api`                   | Apply migrations and grants locally (needs `apps/api/.env.migrate`)      |
| `npm run dev -w @atlas/api`                          | Run the API on :3000 with reload and pretty logs (needs `apps/api/.env`) |
| `npm run db:generate -w @atlas/api`                  | Generate a migration after editing `src/db/schema.ts`                    |
| `npm run dev -w @atlas/web`                          | Run the web app on :5173, proxying `/api` to :3000                       |
| `docker compose --profile full up -d --build --wait` | Build the production images and run migrate, api and web on :8080        |
| `docker compose --profile full down`                 | Stop everything; the database volume stays (`-v` deletes it)             |

`npm run dev -w @atlas/web` needs `apps/web/public/config.json`: copy it from `apps/web/config.example.json` (mock sign-in, ADR 0007). It's git-ignored, so real client IDs never get committed.

`npm run check` needs Docker running: the integration tests start Postgres with Testcontainers. To run one test file without the coverage gate failing on a partial run: `(cd apps/api && npx vitest run src/path/to.test.ts)`.

## Definition of done

`npm run check` passes. Don't disable a lint rule, skip a test or lower a coverage threshold to get there. Fix the cause, or explain the exception in the pull request.

## Conventions

- **TypeScript:** strict, ESM. TypeScript is pinned to 6.0.x (ADR 0013), so don't upgrade it to 7.
  - API and shared use `module: nodenext`, so relative imports end in `.js` (`import { Note } from './notes.js'`).
  - The web app uses Vite's `bundler` resolution: no extensions, and `@/` means `apps/web/src/` (`import { useAuth } from '@/lib/auth/auth-context'`). Use `./` only within the same folder.
- **Tests sit next to the code:** `*.test.ts` for unit tests, `*.int.test.ts` for integration tests, and Playwright `*.spec.ts` in `tests/e2e/src/`. Write the failing test first for new behaviour.
- **Validation:** zod schemas in `@atlas/shared` are the single source of truth for request and response shapes. Infer types with `z.infer`. Never hand-write a duplicate type.
- **API files: group code that changes together** (ADR 0014). A feature is three files: `<feature>.routes.ts`, `<feature>.service.ts` (when there is business logic) and `<feature>.repository.ts`, which holds the record types, the interface _and_ the Postgres implementation. Split a file only when it passes ~200 lines or has two unrelated reasons to change. Don't create a file for one small type, class or function.
- **Web files follow the Bulletproof React layout** (ADR 0015): `app/`, `components/`, `features/<feature>/{api,components}/`, `lib/`, `styles/`, `testing/`. Files are kebab-case (`note-form.tsx` exports `NoteForm`).
- **Naming:** API feature folders use `<feature>.<role>.ts` with a plural feature name (`notes.routes.ts`, `users.repository.ts`). Cross-cutting code uses descriptive kebab-case (`authenticate.ts`, `logging.ts`). Tests mirror their subject (`notes.service.test.ts`, `users.repository.int.test.ts`). Types and schemas are `PascalCase`, functions and variables `camelCase`, database tables and columns `snake_case`.
- **Intentionally unused:** prefix with `_` (`_next`, `const { secret: _secret, ...safe } = obj`). Everything else unused is a lint error.

## Base features and the reference feature

- **Base features ship in every app built on this scaffold:** sign-in, `app.users` (exposed as `GET /api/users/me` → `CurrentUser`, shown in the web header), `app.audit_events`, and the health endpoints. Don't remove them.
- **Notes is the reference feature.** It shows the full pattern: shared zod schema → migration → grants → repository → service → route → tests → UI. Copy its structure for your first real feature, then delete it.
- **Authorization:** every endpoint requires the `access_as_user` scope. What a user _may do_ is decided by Entra App Roles (`req.auth.roles`), never by extra scopes or database role tables.

## Adding a feature (copy the notes pattern)

1. **Contract:** zod schemas in `packages/shared/src/<feature>.ts`, with tests.
2. **Table:** add it to `apps/api/src/db/schema.ts` → `npm run db:generate -w @atlas/api` → review the generated SQL (never hand-edit it).
3. **Grants:** add the table to `APP_TABLE_GRANTS` in `apps/api/src/db/migrations.ts`. The integration tests fail until you do.
4. **Repository:** `src/<feature>/<feature>.repository.ts` (types, interface and Postgres implementation), plus an in-memory double in `src/test/in-memory-store.ts`. If it joins the unit of work, add it to `Repositories` in `src/db/database.ts`.
5. **Service:** `<feature>.service.ts`. Writes go through `unitOfWork.run(...)` and record an audit event in the same transaction.
6. **Routes:** `<feature>.routes.ts`. Validate with `parseOrThrow`, take the caller from `authOf(req)`, and mount the router in `app.ts` behind `replicaLimit, signedIn, perUserLimit`.
7. **Tests:** service unit tests, HTTP tests in `app.test.ts`, `*.int.test.ts` for SQL behaviour such as ownership, and a Playwright test in `tests/e2e/src/` for the main user flow.
8. **UI** in `apps/web/src/features/<feature>/`:
   - `api/use-<feature>.ts` holds the TanStack Query hooks. They call `useApi()`, and every response is parsed with the shared schema.
   - `components/` holds the components: a `<feature>-page.tsx` plus its parts (`note-form.tsx`, `note-card.tsx`). UI shared by two or more features goes in `src/components/`.
   - `components/<feature>-page.test.tsx` renders the whole app with `renderApp()` against the fake API in `src/testing/mock-api.ts`. Add the feature's handlers there.

API layout (`apps/api/`):

| Path                              | Holds                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/app.ts`                      | Middleware order, rate limits, router mounting                                                                  |
| `src/server.ts`, `src/migrate.ts` | The two entrypoints (API, migration job)                                                                        |
| `Dockerfile`                      | Production image: runs the API; the migration job runs it with `node apps/api/dist/migrate.js`                  |
| `src/config.ts`                   | Environment validation, including the issuer guard                                                              |
| `src/logging.ts`                  | pino logger with redaction, request ids, `httpLogger` (one lean line per request)                               |
| `src/errors.ts`                   | `NotFoundError`, `HttpError`, `parseOrThrow`, problem+json error handler                                        |
| `src/auth/`                       | `tokens.ts` (claims, verifier, OIDC discovery), `authenticate.ts` (middleware, `authOf`)                        |
| `src/db/`                         | `schema.ts` (tables), `database.ts` (pool, Entra tokens, unit of work), `migrations.ts` (grants, migration job) |
| `src/<feature>/`                  | `users/`, `notes/`, `audit/`, `health/`                                                                         |

API code rules: `import { Pool } from 'pg'` (pg ships native ESM); routes never touch the database directly; services throw `NotFoundError`/`HttpError`, and the error handler turns them into problem+json. Never send a raw error message to a client.

Web layout (`apps/web/src/`, Bulletproof React style, ADR 0015):

| Path                  | Holds                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| `main.tsx`            | Startup: load `/config.json` → create `Auth` → render. The only file without tests                        |
| `app/`                | `app.tsx` (layout: header, signed-out prompt, page), `providers.tsx` (Fluent theme, TanStack Query, auth) |
| `styles/global.css`   | The only global CSS: a small reset. Components style themselves with Fluent's `makeStyles` and tokens     |
| `components/`         | Shared UI used by two or more features (`error-message.tsx`)                                              |
| `features/<feature>/` | `api/` (TanStack Query hooks) and `components/` (UI) per feature: `users/`, `notes/`                      |
| `lib/`                | Infrastructure without UI: `config.ts` (`/config.json`), `api-client.ts` (fetch wrapper), `auth/`         |
| `lib/auth/`           | `auth-context.ts` (`Auth` interface, `useAuth`), `msal-auth.ts` (Entra ID), `mock-auth.ts` (local/ci)     |
| `testing/`            | `setup.ts` (MSW lifecycle), `mock-api.ts` (fake API), `test-utils.tsx` (`fakeAuth`, `renderApp`)          |

The web image is `apps/web/Dockerfile` plus `apps/web/nginx/`: nginx serves the build, proxies `/api/`, sets the security headers and CSP, and renders `/config.json` from environment variables at startup (ADR 0016).

Imports flow one way: `app` → `features` → `components` / `lib`. A feature never imports another feature; shared code moves to `components/` or `lib/`.

Web code rules:

- **Components never import MSAL.** They use `useAuth()`.
- **Data goes through the feature's `api/` hooks,** never `fetch` in a component. Server data lives in TanStack Query, not in hand-written React contexts.
- **Styling is Fluent UI v9:** components from `@fluentui/react-components`, styles with `makeStyles` and `tokens` next to the component. No Tailwind, and no CSS files besides `styles/global.css`.
- **Show failures with `<ErrorMessage>`.** It shows only API problem details (never raw errors) and the request id.
- **Validate forms with the shared zod schema** before calling the API, then map any problem `errors` from the API onto the fields.
- **Tests go through MSW.** Never mock `fetch` by hand. Query by role and label (`getByRole('button', { name: 'Add note' })`), as a user or screen reader would.

## E2E tests (`tests/e2e`)

Playwright drives Chromium against the compose `full` stack (ADR 0009). CI runs them on every pull request (`e2e`).

```bash
docker compose --profile full up -d --build --wait   # the stack, built from your working tree
npx playwright install chromium                      # once per machine
npm run test:e2e                                     # HTML report: tests/e2e/playwright-report
```

- Import `test`, `expect` and `signIn` from `./fixtures.js`. That `test` fails any test whose page reports a CSP violation.
- `signIn(page)` signs in as Local Developer. For a second user, copy `users see only their own notes`: it sets `auth.clientId` to `atlas-e2e-second-user` in `/config.json`.
- The database is shared with manual testing: create your own data with unique names, look only for it, and delete it at the end.
- Query by role and label, as in the component tests.

## Azure (`infra/`)

Three environments (dev, uat, prod), all in `japaneast` on an Azure for Students subscription. The subscription allows **one Container Apps environment**, so `cae-atlas` lives in `rg-atlas-shared` and every stage runs its own apps in it (ADR 0017). Identities and the absence of credentials: ADR 0004. Networking (dev's Postgres is public, UAT and prod are private in the shared VNet): ADR 0008.

| Path                             | Holds                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `infra/config/environments.json` | Every per-environment setting (location, network, replicas, retention). Templates read only this file |
| `infra/shared.bicep`             | What all stages share: the registry, the VNet, logs and the one Container Apps environment            |
| `infra/platform.bicep`           | One stage's own resources: workload identities and Postgres (private in UAT and prod)                 |
| `infra/migrate.bicep`            | The migration job (the API image with the migrate command)                                            |
| `infra/apps.bicep`               | The API (internal ingress) and web (public) container apps                                            |
| `infra/modules/`                 | Pieces deployed from those templates: AcrPull on the registry, the Postgres Entra admins              |

- **Changes reach Azure only through `deploy.yml`.**
  - A merge to `main` runs CI, deploys the registry, builds both images once (tagged with the commit SHA), and deploys that SHA to dev.
  - Then **the same SHA** goes to UAT, then prod. Each waits for an approval in GitHub, because their environments require a reviewer.
  - Each environment has its own deploy lock, so a run waiting for approval doesn't stop a later merge reaching dev. A later run's UAT deploy queues behind it: reject the stale approval to let the newest through.
  - Every environment's deploy ends with smoke tests that check the deployed version.
  - A prod deploy ends with a GitHub Release, `prod-<date>-<sha>`.
  - To roll back, run `deploy.yml` by hand with an older `sha`.
- **Pull requests get two infrastructure checks:**
  - `bicep` builds and lints every template.
  - `what-if` writes a redacted preview of the Azure changes to the job summary.
- **Templates find each other's resources by name** (`existing`), so no IDs pass between pipeline steps.
- **These are run by a human, never the pipeline:**
  - `scripts/bootstrap.sh shared|dev|uat|prod`: identities, roles, app registrations, groups, policies, budget, GitHub environments (with reviewers for UAT and prod), and prod's delete lock. Per-environment behaviour comes from flags in `environments.json` (`requiresApproval`, `deleteLock`, `humanDbAccess`, `localhostRedirect`)
  - `scripts/add-redirect-uri.sh <env>`: once, after an environment's first deploy
  - `scripts/teardown.sh <env>|all`: when you're done, so the credit stops being spent. It removes prod's lock first

## Git and pull requests

- Branch from `main`. Direct pushes to `main` are blocked by a ruleset.
- The PR title is a Conventional Commit (`feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `perf:`, `test:`, `build:`, `ci:`, `chore:`, `revert:`). It becomes the squash commit on `main`.
- Every required check must be green before merging. The checks are listed in `scripts/bootstrap.sh` (`REQUIRED_CHECKS`).

## Security rules (public repo)

- There are no secrets to commit, by design: CI uses OIDC and the apps use managed identities. If you think you need a secret, stop and raise it in the pull request.
- Never commit Azure tenant, subscription, client or object IDs, UPNs or email addresses. They belong in GitHub Actions **secrets** or git-ignored `.env` files. They aren't credentials, but GitHub masks secrets in its logs, and doesn't mask variables (ADR 0004).
- Never print those values in CI logs. Public-repo logs are world-readable. Redact anything Azure prints, as `scripts/what-if.sh` does.

## Database rules (from M2)

- Schema changes only through committed Drizzle migrations.
- **Expand, then contract.** Every migration must work with both the current and the previous API version. To rename or drop something: add the new thing → ship → switch reads and writes → ship → remove the old thing.
- A new table must be added to the grants allowlist (`APP_TABLE_GRANTS` in `apps/api/src/db/migrations.ts`), or the API can't read it.
