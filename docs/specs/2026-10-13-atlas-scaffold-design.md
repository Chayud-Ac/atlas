# Atlas scaffold — design

- **Date:** 2026-10-13
- **Author:** Chayud Mahithiphark (with Claude Code)
- **Status:** Approved (v2.3)
- **Changes from v1:** three environments, build once and promote,
  per-environment identities, private networking, migrations as a job,
  least-privilege database role, runtime web config, observability,
  governance, supply-chain controls, E2E tests.
- **Changes in v2.1:** notes become the removable _reference feature_.
  `GET /api/me` exposes the base `app.users` table, and the API scope is
  renamed from `Notes.ReadWrite` to the conventional `access_as_user`
  (authorization stays with App Roles).
- **Changes in v2.2:** `GET /api/me` moves to `GET /api/users/me`, so the users
  router owns every `/users` endpoint. The API source follows the
  `<feature>.<role>.ts` layout (ADR 0014).
- **Changes in v2.3:** MSAL refuses `http:` authorities, so local and CI
  sign-in uses a small mock provider instead of MSAL in `protocolMode: OIDC`
  (`auth.kind` in `/config.json`). The web app uses `@azure/msal-browser`
  without `@azure/msal-react`, and Fluent UI v9 with TanStack Query (ADR 0007).
  Its source follows the Bulletproof React layout (ADR 0015).

## 1. Purpose

Atlas is a reusable scaffold for **internal company apps** on Azure, written
in TypeScript end to end. It exists for two reasons:

1. To be the starting point for future apps. The hard-to-change decisions
   (identity, IDs, schema conventions, environments, pipeline,
   infrastructure) are made once, following the practices of large
   companies.
2. To recap modern full-stack practice: React, Express, testing, OIDC, IaC
   and CI/CD, in a layout an AI coding agent can work in.

A small **notes** feature exists only so that every layer carries real
traffic. Notes are not the product. They're the **reference feature**: copy
their structure (schema, migration, grants, repository, service, route,
tests, UI) for the first real feature, then delete them. The **base
features** stay in every app: `app.users` (exposed as `GET /api/users/me`),
`app.audit_events`, sign-in and health checks.

**Constraints.**

- The Azure for Students subscription has $100 of credit. It may all be
  spent within one month, and everything is torn down at the end of that
  month.
- The subscription is one of many in the university's Entra tenant, so
  directory-level admin is not available.
- The GitHub repo is public.

**Out of scope:** the Python FastAPI AI service (`apps/ai`, a later spec).
Items excluded on cost or tenant grounds are listed in §17.

## 2. Decisions at a glance

| Area                 | Decision                                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo                 | Public `Chayud-Ac/atlas`, npm workspaces monorepo, trunk-based (`main` only)                                                                                                |
| Language / runtime   | TypeScript (strict), Node 24 LTS                                                                                                                                            |
| Web                  | Vite + React, Fluent UI v9, TanStack Query, MSAL behind an app-owned `Auth`, runtime `/config.json`, nginx (unprivileged)                                                   |
| API                  | Express 5, zod, pino, OpenTelemetry, Drizzle ORM                                                                                                                            |
| Database             | PostgreSQL 17 Flexible Server B1ms per environment, Entra-only auth, schema `app`                                                                                           |
| Hosting              | Azure Container Apps, VNet-integrated (web external, API internal), migrations as a Container Apps Job                                                                      |
| Environments         | `dev` → `uat` → `prod`, one resource group each, plus `shared` (registry) and `cicd` (pipeline identities)                                                                  |
| Promotion            | Build once (tag = git SHA), deploy the same image to each environment. UAT and prod need approval                                                                           |
| Infra as code        | Bicep, with all per-environment differences in one `infra/config/environments.json`                                                                                         |
| Pipeline → Azure     | User-assigned managed identities with federated credentials (OIDC), one per environment plus `shared` and `plan`                                                            |
| Users → app          | Entra ID, app registrations `atlas-{env}-web` / `atlas-{env}-api`, single-tenant                                                                                            |
| App → Azure services | Per-app user-assigned managed identities (ACR pull, Postgres)                                                                                                               |
| Observability        | Application Insights (workspace-based) + Log Analytics per environment. Alerts and availability tests in prod                                                               |
| Governance           | Tags, Azure Policy (allowed locations, required `env` tag), $100 budget alerts, delete lock on prod                                                                         |
| Supply chain         | CodeQL, dependency review, secret scanning + push protection, Dependabot, Trivy, SBOM + provenance attestations, SHA-pinned actions, PSRule for Azure                       |
| Tests                | Vitest, Supertest, Testcontainers, React Testing Library, MSW, Playwright + mock OIDC server                                                                                |
| Region               | `japaneast` for everything, with one Container Apps environment shared by all stages (the student offer allows five regions and one environment per subscription; ADR 0017) |

## 3. Environments and promotion

### 3.1 Environment matrix

The source of truth is `infra/config/environments.json`. Every Bicep template
reads its settings from there. Nothing environment-specific is hard-coded
anywhere else.

| Setting                            | dev                                                                        | uat                                             | prod                                            |
| ---------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| Region                             | `japaneast` (one shared Container Apps environment and VNet, ADR 0017)     | `japaneast`                                     | `japaneast`                                     |
| Deploy gate                        | automatic after build                                                      | required reviewer                               | required reviewer                               |
| Container Apps replicas (web, api) | min 0 / max 1                                                              | min 0 / max 2                                   | **min 1** / max 3                               |
| Replica size                       | 0.25 vCPU / 0.5 GiB                                                        | same                                            | same                                            |
| Postgres network                   | public endpoint; firewall = Azure services + developer IP opened on demand | **private (VNet-integrated), no public access** | **private (VNet-integrated), no public access** |
| Human DB access                    | `atlas-dev-db-admins` group (you)                                          | none by default (§11.4)                         | none by default (§11.4)                         |
| Postgres backup retention          | 7 days                                                                     | 7 days                                          | 35 days                                         |
| Log Analytics retention            | 30 days                                                                    | 30 days                                         | 90 days                                         |
| Alerts + availability tests        | no                                                                         | no                                              | yes                                             |
| Delete lock                        | no                                                                         | no                                              | `CanNotDelete` on the Postgres server           |
| VNet address space                 | `10.10.0.0/16`                                                             | `10.20.0.0/16`                                  | `10.30.0.0/16`                                  |

Address spaces don't overlap, so the VNets can later be peered into a hub
without renumbering.

### 3.2 Promotion flow

```
pull request ──► ci.yml        lint · typecheck · unit · integration · e2e
                               build + scan images · bicep lint/PSRule · what-if (all envs)
                               dependency review · PR-title check · CodeQL
merge to main ─► deploy.yml
                 1. ci         (reuses ci.yml)
                 2. shared     shared.bicep (registry)
                 3. build      build web + api once → tag <git-sha> → Trivy → push
                               → SBOM + provenance attestations
                 4. dev        deploy-env.yml  (automatic)
                 5. uat        deploy-env.yml  (waits for approval)
                 6. prod       deploy-env.yml  (waits for approval)
                 7. release    GitHub Release + tag prod-<yyyymmdd>-<shortsha>

deploy-env.yml (ONE job, so ONE approval per environment):
   platform.bicep → migrate.bicep → start migration job, wait for success
   → apps.bicep → smoke test (version check included)
```

- **Build once.** The image deployed to prod is byte-for-byte the one that
  passed dev and UAT. Runtime web config (§10) is what makes this possible
  for the frontend.
- **Rollback** is a `workflow_dispatch` of `deploy.yml` with an older SHA.
  That skips the build and promotes an image that already exists. See
  `docs/runbooks/rollback.md`.
- **Concurrency.** One lock per deploy target, not per run: the `shared`
  job uses group `deploy-shared`, and each environment's deploy uses
  `deploy-<env>`, all with `cancel-in-progress: false`. A run waiting for
  UAT approval doesn't stop a later merge reaching dev. For each target,
  GitHub keeps only the newest waiting job, so the latest merge wins.
- **Branching.** Trunk-based. Environments are deployment targets, not
  branches. There are no `develop` or `release` branches.

## 4. Architecture

### 4.1 Per environment

> **As built (M6, ADR 0017):** the subscription allows one Container Apps
> environment, so `cae-atlas`, `vnet-atlas-shared` and `log-atlas-shared` live
> in `rg-atlas-shared` and serve every stage. Each `rg-atlas-{env}` keeps its
> identities, Postgres, apps and migration job; UAT and prod Postgres use
> private subnets of the shared VNet (ADR 0008).

```
                    ┌──────────────── vnet-atlas-{env} ──────────────────────────────────┐
Browser ──HTTPS──►  │ cae-atlas-{env} (external, VNet-integrated, snet-cae)              │
                    │   ca-atlas-web-{env}  nginx: SPA + /config.json + /api/* proxy     │
                    │          │ internal                                                │
                    │          ▼                                                         │
                    │   ca-atlas-api-{env}  Express (internal ingress only)              │
                    │   caj-atlas-migrate-{env}  same API image, migrate command         │
                    │          │                                                         │
                    │          ▼  uat/prod: private (snet-psql, private DNS)             │
                    │   psql-atlas-{env}-<suffix>     dev: public endpoint + firewall    │
                    └────────────────────────────────────────────────────────────────────┘
   telemetry ─► appi-atlas-{env} ─► log-atlas-{env} ◄─ container + Postgres logs
   images    ◄─ cratlas<suffix> (rg-atlas-shared), pulled with each app's own identity
```

### 4.2 Trust relationships (no secrets anywhere)

| Caller → target                           | Mechanism                                                           |
| ----------------------------------------- | ------------------------------------------------------------------- |
| GitHub `pull_request` → Azure (read only) | `id-atlas-github-plan`, federated credential, custom what-if role   |
| GitHub env `shared` → registry            | `id-atlas-github-shared`, federated credential                      |
| GitHub env `{env}` → `rg-atlas-{env}`     | `id-atlas-github-{env}`, federated credential                       |
| User → web/API                            | Entra ID sign-in, API validates the access token                    |
| Web, API, migrator → registry             | `id-atlas-{web,api,migrator}-{env}` with AcrPull                    |
| Migrator → Postgres                       | `id-atlas-migrator-{env}`, a Postgres Entra admin (owns the schema) |
| API → Postgres                            | `id-atlas-api-{env}`, a non-admin Postgres role, DML only           |

### 4.3 Resource naming (Cloud Adoption Framework abbreviations)

| Scope                                                 | Resources                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rg-atlas-cicd` (created and changed by a human only) | `id-atlas-github-plan`, `id-atlas-github-shared`, `id-atlas-github-dev`, `id-atlas-github-uat`, `id-atlas-github-prod`                                                                                                                                                                                                                                                                                                                                                                              |
| `rg-atlas-shared`                                     | `cratlas<suffix>` (ACR Basic)                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `rg-atlas-{env}`                                      | `vnet-atlas-{env}` (`snet-cae`, `snet-psql`), `nsg-atlas-{env}-cae`, `nsg-atlas-{env}-psql`, `log-atlas-{env}`, `appi-atlas-{env}`, `cae-atlas-{env}`, `id-atlas-web-{env}`, `id-atlas-api-{env}`, `id-atlas-migrator-{env}`, `ca-atlas-web-{env}`, `ca-atlas-api-{env}`, `caj-atlas-migrate-{env}`, `psql-atlas-{env}-<suffix>` (database `atlas`). uat/prod also: private DNS zone `atlas-{env}.private.postgres.database.azure.com`. prod also: `ag-atlas-prod`, availability tests, alert rules |
| Entra ID                                              | `atlas-{env}-web`, `atlas-{env}-api` (app registrations), `atlas-{env}-db-admins` (security group)                                                                                                                                                                                                                                                                                                                                                                                                  |
| Subscription                                          | Custom roles `Atlas What-If Reader` and `Atlas Deployment Runner`, policy assignments, budget `budget-atlas`                                                                                                                                                                                                                                                                                                                                                                                        |

`<suffix>` is `uniqueString(subscription().id)`, used for names that must be
globally unique.

**Why the pipeline identities live in `rg-atlas-cicd`.** If an
environment's pipeline identity lived in the resource group it deploys to,
its Contributor role would let it edit its own federated credentials. It
could also delete itself when the group is torn down.

## 5. Repository layout

```
atlas/
├─ AGENTS.md                  # commands, conventions, definition of done, migration rules
├─ CLAUDE.md                  # "@AGENTS.md"
├─ README.md                  # what this is, quickstart, links to docs
├─ SECURITY.md · LICENSE (MIT) · .editorconfig · .gitattributes · .nvmrc (24)
├─ package.json               # workspaces: apps/*, packages/*, tests/*
├─ tsconfig.base.json · eslint.config.js · .prettierrc · ps-rule.yaml
├─ .husky/pre-commit          # lint-staged
├─ compose.yaml               # postgres, mock-oidc; profile "full" adds migrate, api, web
├─ apps/
│  ├─ web/                    # @atlas/web  — AGENTS.md, Dockerfile, nginx/ templates, public/
│  └─ api/                    # @atlas/api  — AGENTS.md, Dockerfile, drizzle/ migrations
├─ packages/
│  └─ shared/                 # @atlas/shared — zod schemas + inferred types
├─ tests/
│  └─ e2e/                    # @atlas/e2e — Playwright against the compose "full" stack
├─ infra/
│  ├─ bicepconfig.json        # linter rules
│  ├─ config/environments.json
│  ├─ shared.bicep            # registry
│  ├─ platform.bicep          # network, monitoring, identities, CAE, Postgres, AcrPull grants
│  ├─ migrate.bicep           # migration job (takes image tag)
│  ├─ apps.bicep              # web + api container apps (takes image tag)
│  └─ modules/
├─ scripts/
│  ├─ bootstrap.sh            # bootstrap.sh shared|dev|uat|prod — idempotent
│  ├─ add-redirect-uri.sh     # add deployed web URL to atlas-{env}-web
│  ├─ db-access.sh            # dev only: open/close firewall for your current IP
│  └─ teardown.sh             # teardown.sh dev|uat|prod|all
├─ docs/
│  ├─ specs/                  # design docs (this file)
│  ├─ adr/                    # architecture decision records (§17)
│  └─ runbooks/               # rollback, add-environment, database-access
└─ .github/
   ├─ workflows/ci.yml · codeql.yml · deploy.yml · deploy-env.yml
   ├─ dependabot.yml · CODEOWNERS · pull_request_template.md
```

`apps/ai` (FastAPI) will be added later as another internal container app,
with its own identity, image and E2E coverage. The structure above won't
need to change.

## 6. Identity and access

### 6.1 Pipeline identities

All of these are created by `scripts/bootstrap.sh`, run by you as
subscription Owner.

| Identity                 | Federated subject                         | Roles                                                                                                                                                                                                                               |
| ------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id-atlas-github-plan`   | `repo:Chayud-Ac/atlas:pull_request`       | `Atlas What-If Reader` on `rg-atlas-shared` and each `rg-atlas-{env}`                                                                                                                                                               |
| `id-atlas-github-shared` | `repo:Chayud-Ac/atlas:environment:shared` | Contributor on `rg-atlas-shared`. AcrPush on the registry                                                                                                                                                                           |
| `id-atlas-github-{env}`  | `repo:Chayud-Ac/atlas:environment:{env}`  | Contributor on `rg-atlas-{env}`. On `rg-atlas-shared`: Reader + `Atlas Deployment Runner` + Role Based Access Control Administrator **limited by condition to assigning/removing AcrPull** (`7f951dda-4ed3-4680-a7ca-43fe172d538d`) |

All credentials use issuer `https://token.actions.githubusercontent.com` and
audience `api://AzureADTokenExchange`.

**Custom roles.** The exact action lists are verified during
implementation.

- `Atlas What-If Reader`: `*/read`,
  `Microsoft.Resources/deployments/validate/action`,
  `Microsoft.Resources/deployments/whatIf/action`.
- `Atlas Deployment Runner`: `Microsoft.Resources/deployments/*`. This lets
  an environment pipeline deploy the cross-resource-group module that
  grants AcrPull on the shared registry. A deployment can only do what its
  caller is already allowed to do, so this role grants nothing extra on its
  own.

**Done by a human, never the pipeline:** the prod delete lock, policy
assignments, the budget, app registrations, Entra groups, and anything in
`rg-atlas-cicd`.

### 6.2 GitHub configuration

`bootstrap.sh` sets all of this through `gh api`.

**Repository settings:**

- squash merge only, with the PR title as the commit message
- delete branches on merge
- secret scanning + push protection
- Dependabot alerts + security updates
- private vulnerability reporting

**Environments:**

| Environment | Branch policy | Required reviewers | Secrets (IDs) and variables                                                                                                           |
| ----------- | ------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `shared`    | `main` only   | none               | `AZURE_CLIENT_ID`                                                                                                                     |
| `dev`       | `main` only   | none               | `AZURE_CLIENT_ID`, `ENTRA_TENANT_ID`, `ENTRA_WEB_CLIENT_ID`, `ENTRA_API_CLIENT_ID`, `DB_ADMIN_GROUP_OBJECT_ID`, `DB_ADMIN_GROUP_NAME` |
| `uat`       | `main` only   | `Chayud-Ac`        | same as dev                                                                                                                           |
| `prod`      | `main` only   | `Chayud-Ac`        | same as dev, plus `ALERT_EMAIL`                                                                                                       |

Self-review is allowed, because this is a solo project.

**Repository secrets** (IDs, ADR 0004): `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`,
`AZURE_PLAN_CLIENT_ID`.

**Ruleset on `main`:**

- changes go through a pull request
- 0 required approvals (solo project; the ADR records that a team uses ≥1
  plus code-owner review)
- required status checks: `check`, `e2e`, `build-images`, `bicep`,
  `what-if`, `pr-title`, `dependency-review`, CodeQL
- linear history
- conversations must be resolved
- force pushes and deletion blocked
- no bypass actors

**Public-repo rule.**

- Tenant, subscription, client and object IDs, UPNs and email addresses are
  **never committed**. They live only in GitHub variables and git-ignored
  `.env` files.
- They're stored as GitHub Actions **secrets**, which GitHub masks in every
  log line, step headers included (ADR 0004). Variables would print them,
  and `::add-mask::` on a `${{ }}` expression still leaks the value.
- What-if and deployment output is redacted before it goes into a job
  summary, because public-repo logs are world-readable.

### 6.3 Users → app (Entra ID)

**Tenant.** The UTCC directory that owns the subscription. On 2026-10-13
it allowed users to create apps (`allowedToCreateApps`), groups and
tenants. Sign-in is **single-tenant**.

**Registrations, per environment:**

- `atlas-{env}-api`:
  - identifier URI `api://<api-client-id>`
  - delegated scope `access_as_user`
  - `requestedAccessTokenVersion: 2`
  - `preAuthorizedApplications` = `atlas-{env}-web`, so no consent prompt
    can be blocked by tenant policy
- `atlas-{env}-web`:
  - SPA platform (public client, PKCE, no secret)
  - redirect URIs: `http://localhost:5173` (dev only) and
    `https://<web-fqdn>`, added by `add-redirect-uri.sh` after the first
    deploy of each environment

**Web.**

- Uses `@azure/msal-browser` (no `@azure/msal-react`: with redirects only,
  the signed-in state is known at startup and never changes without a page
  load).
- Sign-in uses a redirect. Tokens come from `acquireTokenSilent`, falling
  back to a redirect when interaction is required.
- Sign-in sits behind an app-owned `Auth` interface (`isSignedIn`, `signIn`,
  `signOut`, `getAccessToken`) read with `useAuth()`, so components and tests
  never import MSAL. Tests pass a fake.
- Two implementations, chosen by `auth.kind` in `/config.json` (§10):
  `msal` (Entra ID) and `mock` (the local mock OIDC server; MSAL refuses
  `http:` authorities). The config schema accepts `mock` only when `env` is
  `local` or `ci`, and the API's issuer guard rejects mock tokens anywhere
  else (ADR 0007).

**API token validation** (`jose`):

- Signing keys come from the issuer's JWKS (`createRemoteJWKSet`).
- Checks: signature, `iss` = `OIDC_ISSUER`, `aud` = `OIDC_AUDIENCE`,
  `exp`/`nbf`, and `scp` includes `REQUIRED_SCOPE`.
- Results: missing or invalid token → 401; missing scope → 403.
- On success: upsert `app.users` (§8.2) and attach
  `req.auth = { userId, oid, tid, roles, name, email }`.
- **Issuer guard.** Config validation (zod) refuses to start unless
  `OIDC_ISSUER` matches
  `^https://login\.microsoftonline\.com/<uuid>/v2\.0$` whenever `ATLAS_ENV`
  is `dev`, `uat` or `prod`. Only `ATLAS_ENV=local` or `ci` may point at the
  mock OIDC server (§14.3).

**Roles.**

- The `roles` claim is parsed into `req.auth.roles`.
- No app roles are defined today. When the first is needed, it's added as
  an Entra App Role on `atlas-{env}-api` and checked by `requireRole()`.
- Roles are never stored in the database.

### 6.4 Workload identities

Per environment, created in `platform.bicep`. They're user-assigned, so
AcrPull exists before the first image pull.

| Identity                  | Used by       | Grants                                                  |
| ------------------------- | ------------- | ------------------------------------------------------- |
| `id-atlas-web-{env}`      | web app       | AcrPull                                                 |
| `id-atlas-api-{env}`      | API app       | AcrPull. Postgres role `id-atlas-api-{env}` (DML, §8.5) |
| `id-atlas-migrator-{env}` | migration job | AcrPull. **Postgres Entra admin**                       |

The second Postgres Entra admin is the group `atlas-{env}-db-admins`. You
are a member in dev. In UAT and prod it's empty by default.

## 7. Network

- **Each environment has `vnet-atlas-{env}`:**
  - `snet-cae` (`/24`), delegated to `Microsoft.App/environments`, with
    `nsg-atlas-{env}-cae`
  - `snet-psql` (`/27`), delegated to
    `Microsoft.DBforPostgreSQL/flexibleServers`, with `nsg-atlas-{env}-psql`
    (allows 5432 from `snet-cae` only). Used in uat/prod; dev reserves it
    unused, so dev can switch to private later.
- **`cae-atlas-{env}`** is a workload-profiles environment (Consumption
  profile), VNet-integrated and _external_, so the web app can have public
  ingress. The API has internal ingress only.
- **Postgres, uat/prod:** VNet-integrated into `snet-psql`, with private DNS
  zone `atlas-{env}.private.postgres.database.azure.com` linked to the VNet.
  Public access is disabled.
- **Postgres, dev:** public endpoint with Entra-only auth and TLS. The
  firewall allows Azure services, plus your current IP only while
  `scripts/db-access.sh dev` has it open (`--revoke` closes it).
- **TLS:** Container Apps manages HTTPS on the default
  `*.azurecontainerapps.io` domain. HTTP redirects to HTTPS.

## 8. Data

### 8.1 Conventions (every table, every app built on this scaffold)

- Everything lives in Postgres schema **`app`**. Drizzle's migration ledger
  lives in schema `drizzle`.
- `id uuid primary key`, a **UUIDv7** generated in the app (`uuid` package,
  Drizzle `$defaultFn`).
- `created_at timestamptz not null default now()`, and `updated_at
timestamptz not null default now()` maintained by Drizzle `$onUpdate`.
- Tables are plural snake_case. Columns are snake_case. Foreign keys
  reference `app.users.id`, never Entra identifiers.
- Schema changes happen only through committed Drizzle migrations
  (`apps/api/drizzle/*.sql`), reviewed in pull requests.
- **Expand, then contract** (also in `AGENTS.md`). The migration job runs
  _before_ the new API revision starts, so every migration must work with
  both the old and the new API versions. To rename or drop something: add
  the new column/table → ship → move reads and writes over → ship → drop the
  old one in a later release.

### 8.2 Base tables

```sql
app.users (
  id               uuid primary key,
  entra_tenant_id  uuid not null,          -- tid claim
  entra_object_id  uuid not null,          -- oid claim
  email            text,
  display_name     text,
  last_seen_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (entra_tenant_id, entra_object_id)
)

app.audit_events (                          -- append-only, enforced by grants (§8.5)
  id               uuid primary key,
  occurred_at      timestamptz not null default now(),
  actor_user_id    uuid references app.users(id),
  action           text not null,          -- e.g. 'note.created', 'note.deleted'
  entity_type      text not null,
  entity_id        uuid,
  data             jsonb not null default '{}',   -- small context only, never secrets
  request_id       text,
  trace_id         text                    -- W3C trace ID, for App Insights correlation
)
index (entity_type, entity_id, occurred_at desc)
```

- **`app.users`** is upserted from token claims on each authenticated
  request (just-in-time provisioning). `last_seen_at` is only written when
  it is more than 5 minutes old.
- **`app.audit_events`** rows are written by the service layer, in the same
  transaction as the change they describe.
- **Not included, on purpose:**
  - `organizations`: apps are single-organization
  - roles and permissions tables: Entra App Roles cover this
  - soft delete: the audit trail keeps the history

### 8.3 Example feature table

```sql
app.notes (
  id          uuid primary key,
  owner_id    uuid not null references app.users(id),
  title       text not null,              -- 1..200 chars (zod)
  body        text not null default '',   -- 0..10 000 chars (zod)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
)
index (owner_id, created_at desc)
```

### 8.4 Server and connection

- **Server:** PostgreSQL 17, Burstable B1ms, 32 GB storage, password auth
  **disabled** (Entra only), TLS required. Logs go to Log Analytics through
  diagnostic settings.
- **Cloud connection:** a `pg` `Pool` whose `password` is an async function
  returning a token from `ManagedIdentityCredential({ clientId })` for
  `https://ossrdbms-aad.database.windows.net/.default`. `PGUSER` is the
  identity's name.
- **Local:** `DB_AUTH=password`. `compose.yaml` Postgres creates
  **`atlas_migrator`** (owns schema `app`) and **`atlas_app`** (DML only),
  matching the cloud split exactly.

### 8.5 Migrations and privileges

`apps/api/src/migrate.ts` is built into the same image as the API and run
by `caj-atlas-migrate-{env}` as `id-atlas-migrator-{env}`. It does three
things:

1. Applies Drizzle migrations to schema `app`. A failure exits non-zero, and
   the pipeline stops before `apps.bicep`.
2. Ensures the runtime role exists with
   `pgaadauth_create_principal_with_oid('id-atlas-api-{env}', <principalId>,
'service', false, false)`. This runs only in cloud environments, and
   whether it must run in the `postgres` database is verified during
   implementation.
3. Re-applies grants idempotently from an explicit per-table list in
   `apps/api/src/db/grants.ts`:

```
app.users         SELECT, INSERT, UPDATE
app.notes         SELECT, INSERT, UPDATE, DELETE
app.audit_events  SELECT, INSERT                 -- no UPDATE/DELETE: append-only
schema app        USAGE
```

There are **no default privileges**. A new table is unreachable by the API
until it's added to `grants.ts`, and a test fails if any table in `app` is
missing from that list.

**Locally and in CI,** `npm run db:migrate` runs steps 1 and 3 as
`atlas_migrator`. In the compose `full` profile it runs as the one-off
`migrate` service.

## 9. API (`apps/api`)

| Method | Path                | Auth             | Behaviour                                                                                                                         |
| ------ | ------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/health/live`  | none             | `200 { status, version }`. `version` = `APP_VERSION` (git SHA). Liveness probe                                                    |
| GET    | `/api/health/ready` | none             | 200 when `SELECT 1` succeeds. Readiness probe                                                                                     |
| GET    | `/api/users/me`     | `access_as_user` | The signed-in user as `CurrentUser`: the `app.users` row (`id`, `displayName`, `email`) plus `roles` from the token. Base feature |
| GET    | `/api/notes`        | `access_as_user` | The caller's notes, newest first                                                                                                  |
| POST   | `/api/notes`        | `access_as_user` | Creates a note, returns 201 + note                                                                                                |
| DELETE | `/api/notes/:id`    | `access_as_user` | 204 if the caller owns it, otherwise 404                                                                                          |

- **Layers:**
  - `routes` → `services` → `repositories`. Repositories are interfaces with
    Postgres and in-memory implementations.
  - `createApp(deps)` builds the Express app from injected dependencies.
  - `server.ts` wires the real ones and listens.
  - `telemetry.ts` is loaded first with `node --import`.
- **Config:** read from environment variables and validated with zod at
  startup. The API fails fast with a clear message, and that validation
  includes the issuer guard (§6.3).
- **Validation:** request bodies and params are checked against
  `@atlas/shared` zod schemas.
- **Errors:**
  - One error middleware returns `application/problem+json` (RFC 9457:
    `type`, `title`, `status`, `detail`, `errors` for validation,
    `traceId`).
  - Statuses: 400, 401, 403, 404 (also for notes that aren't yours), 500
    (generic text; details only in logs and traces).
  - Express 5 forwards errors from async handlers automatically.
- **Logging:**
  - `pino-http` writes JSON to stdout.
  - Every line carries `request_id` (from `x-request-id`, or generated and
    echoed back) plus `trace_id` / `span_id`.
- **Security headers:** `helmet` defaults. The JSON body limit is 100 kB.
- **Container:** multi-stage `node:24-alpine`, production dependencies only,
  runs as the non-root `node` user on port 3000. Both entrypoints are in the
  image: `server.js` (default) and `migrate.js` (job command override).

## 10. Web (`apps/web`)

- **App:** Vite + React with TypeScript.
  - A header (base feature) shows the signed-in user's name from
    `GET /api/users/me`, with a sign-out button.
  - One notes page (reference feature): a list, a create form validated with
    the shared zod schema, and delete.
- **Runtime config:** `main.tsx` fetches `/config.json` _before_ creating
  the MSAL instance:

  ```json
  {
    "env": "uat",
    "auth": {
      "authority": "...",
      "clientId": "...",
      "apiScope": "...",
      "kind": "msal"
    },
    "telemetry": { "connectionString": "..." }
  }
  ```

  - In the container, nginx renders it from environment variables at
    startup (ADR 0016).
  - In Vite dev, it's a git-ignored `public/config.json`, copied from
    `apps/web/config.example.json` (mock sign-in).
  - Every value in it is a public identifier.

- **API client:** a `fetch` wrapper that:
  - attaches the bearer token
  - validates every response with the shared zod schema
  - parses problem+json errors into an `ApiError` (shown with its request id)
  - restarts sign-in on a 401, at most once a minute so a misconfigured
    audience can't cause a redirect loop
  - W3C `traceparent` is added by the App Insights SDK in M7
- **Telemetry:** `@microsoft/applicationinsights-web` with W3C distributed
  tracing, so a browser action, its API request and its SQL query share one
  trace.
- **Container:** multi-stage build, then `nginxinc/nginx-unprivileged`
  (non-root, port 8080). nginx provides:
  - SPA fallback
  - immutable caching for hashed assets; `no-store` for `index.html` and
    `config.json`
  - security headers: CSP limited to self + `login.microsoftonline.com` +
    App Insights ingestion, `X-Content-Type-Options`, `Referrer-Policy`,
    `frame-ancestors 'none'`
  - `location /api/ { proxy_pass http://${API_UPSTREAM}; }`
- **Local dev:**
  - `docker compose up -d` (Postgres + mock OIDC)
  - `npm run db:migrate`
  - `npm run dev -w @atlas/api` (`tsx watch` on 3000) and
    `npm run dev -w @atlas/web` (Vite on 5173, proxying `/api` to 3000)
  - Local sign-in uses the mock OIDC server by default. Editing
    `public/config.json` (`kind: "msal"`) switches it to the real
    `atlas-dev-*` Entra registrations.

## 11. Observability and operations

### 11.1 Telemetry

- **One workspace-based Application Insights per environment**
  (`appi-atlas-{env}`), connected to `log-atlas-{env}`.
- **API:** `@azure/monitor-opentelemetry` auto-instruments HTTP, Express and
  `pg`.
- **Web:** browser SDK.
- **Local auth stays enabled** on App Insights, because the browser SDK
  can't use Entra auth. The connection string is not a secret.
- **Container Apps environment and Postgres logs** go to Log Analytics
  through diagnostic settings (Azure Monitor destination, no workspace
  shared keys).

### 11.2 Alerts (prod only)

- **Action group** `ag-atlas-prod`, emailing `ALERT_EMAIL`.
- **Standard availability tests** for `/` and `/api/health/ready`, from 3
  locations every 5 minutes. The alert fires when 2 or more locations fail.
- **Log alerts:**
  - API failed requests > 5 in 5 minutes
  - any failed migration job execution

### 11.3 Runbooks (`docs/runbooks/`)

- `rollback.md`: redeploy an older SHA. Covers what to do when a
  migration has already run (expand/contract makes the previous app version
  safe).
- `add-environment.md`: add an entry in `environments.json`, run
  `bootstrap.sh <env>`, add a job in `deploy.yml`, run
  `add-redirect-uri.sh`.
- `database-access.md`:
  - **dev:** `db-access.sh dev`, then `psql` with
    `az account get-access-token --resource-type oss-rdbms`
  - **uat/prod:** no interactive human access. Data fixes ship as reviewed
    migrations.
  - **Emergency:** add yourself to `atlas-{env}-db-admins` and run a
    reviewed one-off query through a manual run of the migration job. Every
    step is recorded.

### 11.4 Human database access (summary)

| Environment | Who                         | How                                                                        |
| ----------- | --------------------------- | -------------------------------------------------------------------------- |
| dev         | `atlas-dev-db-admins` (you) | open the firewall with `db-access.sh dev`, then `psql` with an Entra token |
| uat, prod   | nobody by default           | reviewed migrations; emergency procedure in `database-access.md`           |

## 12. Governance and cost

- **Tags** on every resource and resource group, from
  `environments.json`: `env`, `app=atlas`, `owner=Chayud-Ac`,
  `costCenter=personal-learning`.
- **Azure Policy**, assigned by `bootstrap.sh` to each atlas resource group:
  - _Allowed locations_: `japaneast`, `malaysiawest` (`allowedLocations` in
    `environments.json`, ADR 0017). Deny.
  - _Require a tag on resources_: `env`. Deny.
- **Budget** `budget-atlas`: $100 a month on the subscription, emailing at
  50%, 80% and 100% actual, and at 100% forecast. If the Azure for Students
  offer doesn't support budgets, `bootstrap.sh` warns and continues.
- **Locks:** `CanNotDelete` on the prod Postgres server (not the whole group: see §18), set by `bootstrap.sh prod`
  and removed by `teardown.sh`.
- **Teardown:** `teardown.sh all` removes the locks, deletes every
  `rg-atlas-*`, the app registrations, the groups, the custom roles, the
  policy assignments and the budget. It's run before the credit runs out at
  the end of the month.

**Estimated cost, one full month with everything running:**

| Item                                                       | Estimate                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| Postgres B1ms + 32 GB × 3                                  | ~$48 (−$16 if the 750-hour free offer applies to one server) |
| Container Apps: prod web + API at min 1 (mostly idle rate) | ~$12                                                         |
| Container Apps: dev/uat (scale to zero)                    | ~$0, within the free allowance                               |
| ACR Basic (shared)                                         | ~$5                                                          |
| Log Analytics / App Insights (first 5 GB/month free)       | ~$0–3                                                        |
| Private DNS zones ×2, availability tests, alert rules      | ~$3                                                          |
| **Total**                                                  | **~$70** (budget alerts at $50 / $80 / $100)                 |

## 13. Quality gates (local)

| Script                     | Runs                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `npm run lint`             | ESLint (typescript-eslint, flat config) + Prettier check                           |
| `npm run typecheck`        | `tsc --build` across workspaces                                                    |
| `npm test`                 | Vitest unit + component tests (no Docker)                                          |
| `npm run test:integration` | Vitest + Testcontainers `postgres:17` (needs Docker)                               |
| `npm run test:e2e`         | compose `full` profile + Playwright                                                |
| `npm run check`            | lint + typecheck + test + test:integration (the definition of done in `AGENTS.md`) |

The pre-commit hook (husky + lint-staged) runs ESLint and Prettier on staged
files.

## 14. Testing

### 14.1 Unit, component and HTTP tests

- **`packages/shared`:** schema accept/reject cases.
- **API auth middleware:** tokens signed with a local key pair:
  - missing, expired, not-yet-valid, wrong `iss`, wrong `aud`, forged
    signature → 401
  - valid token without the scope → 403
  - valid token → passes, and the user is upserted
- **API issuer guard:** config with `ATLAS_ENV=prod` and a non-Entra issuer
  fails validation.
- **API routes:** Supertest against `createApp` with a fake verifier and
  in-memory repositories:
  - problem+json shape
  - `/api/users/me` returns the upserted user with `roles` taken from the token
  - 404 for notes that aren't yours
  - ordering
  - delete
  - `x-request-id` echoed back
- **Web:** React Testing Library + MSW with a fake `AuthProvider`:
  - the header shows the signed-in user's name from `/api/users/me`
  - list rendering
  - form validation messages
  - delete
  - a 401 restarts sign-in
  - the runtime config loader

### 14.2 Integration tests (Testcontainers)

- Migrations apply from empty, and re-running them is a no-op.
- Repository queries **run as `atlas_app`**:
  - user upsert
  - an audit row is written in the same transaction
  - user A cannot list or delete user B's notes
- **Privilege tests:**
  - `atlas_app` gets a permission error on `UPDATE`/`DELETE` of
    `app.audit_events` and on any DDL
  - every table in schema `app` appears in `grants.ts`

### 14.3 End-to-end tests (Playwright)

- **The stack:** the compose `full` profile builds the **same Dockerfiles as
  production**: `postgres`, `migrate`, `api`, `web`, plus `mock-oidc`
  (`ghcr.io/navikt/mock-oauth2-server`).
- **The mock issues tokens** shaped like Entra's: `oid`, `tid`, `aud`,
  `scp=access_as_user`.
- **The web app** signs in against it with `auth.kind: "mock"` in
  `/config.json` (ADR 0007).
- **The API** trusts it only because `ATLAS_ENV=ci` (§6.3).
- **Scenarios:**
  - sign in, and the header shows the mock user's name (from `/api/users/me`)
  - create a note, see it, reload and still see it, delete it, see it gone
  - a second user can't see the first user's notes
  - a direct `/api/notes` call without a token returns 401
- **Why a mock and not Entra:** we can't create MFA-exempt test users in the
  university tenant. The ADR records that a company would add Entra-backed
  E2E tests in UAT with a dedicated test user excluded from MFA by
  conditional access.

### 14.4 Coverage and smoke tests

- **Coverage:** Vitest v8 provider. CI fails if `api` or `shared` drop below
  80% line coverage. `web` is reported only.
- **Post-deploy smoke test** (each environment), with retries for cold
  starts:
  - `GET /` → 200
  - `GET /config.json` → `env` matches the environment
  - `GET /api/health/live` → `version` equals the deployed SHA
  - `GET /api/health/ready` → 200
  - `GET /api/notes` without a token → 401

## 15. CI/CD

### `ci.yml`

**Triggers:** `pull_request` to `main`, `workflow_call`. Permissions are
`contents: read` unless a job needs more. Concurrency is per ref, and newer
runs cancel older ones.

| Job                 | Does                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `check`             | `npm ci` → lint → typecheck → test → test:integration → coverage summary                                                                                                                                                                                                                                                                                                                               |
| `e2e`               | `npm run test:e2e`. The Playwright report is uploaded as an artifact when it fails                                                                                                                                                                                                                                                                                                                     |
| `build-images`      | Builds both images (GitHub Actions cache, no push), then a Trivy scan that fails on CRITICAL/HIGH with a fix available                                                                                                                                                                                                                                                                                 |
| `bicep`             | `az bicep build` + lint on every template, then PSRule for Azure (`ps-rule.yaml`, with every exception justified inline)                                                                                                                                                                                                                                                                               |
| `what-if`           | Matrix: `shared`, `dev`, `uat`, `prod`. Signs in as `id-atlas-github-plan` (`id-token: write`) and writes **redacted** what-if output to the job summary. **Runs only on `pull_request` events**, because the federated credential trusts only PR tokens, so it is skipped when `deploy.yml` reuses `ci.yml`. Also skipped for forks and Dependabot, which get no OIDC token. A skip counts as passing |
| `pr-title`          | Conventional Commits check on the PR title (it becomes the squash commit message)                                                                                                                                                                                                                                                                                                                      |
| `dependency-review` | Blocks new dependencies with known high-severity vulnerabilities or disallowed licenses                                                                                                                                                                                                                                                                                                                |

### `codeql.yml`

Advanced setup for `javascript-typescript` and `actions`. Runs on pull
requests, pushes to `main` and weekly.

### `deploy.yml`

**Triggers:** `push` to `main`, and `workflow_dispatch` with an optional
`sha` input for rollback.

| Job                    | Environment            | Does                                                                                                                                                                                                                                                          |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci`                   | –                      | `uses: ./.github/workflows/ci.yml` (skipped for rollback)                                                                                                                                                                                                     |
| `shared`               | `shared`               | `shared.bicep`                                                                                                                                                                                                                                                |
| `build`                | `shared`               | Builds web + api once, tags `<sha>`, runs Trivy, pushes to ACR, then `anchore/sbom-action` (SPDX) and `actions/attest-build-provenance` + `actions/attest-sbom` with `push-to-registry: true`. `attestations: write`, `id-token: write`. Skipped for rollback |
| `dev` / `uat` / `prod` | `dev` / `uat` / `prod` | `uses: ./.github/workflows/deploy-env.yml` with `environment` and `sha`. Each needs the previous one. Approvals come from environment protection rules                                                                                                        |
| `release`              | –                      | `gh release create prod-<yyyymmdd>-<shortsha> --generate-notes --target <sha>`. `contents: write`                                                                                                                                                             |

### `deploy-env.yml` (reusable)

One job with `environment: ${{ inputs.environment }}`, so there's exactly
one approval per environment. Its steps:

1. Mask IDs → `azure/login` (OIDC).
2. `az deployment group create` with `platform.bicep`
   (`environmentName`, admin group parameters).
3. `migrate.bicep` (image `<sha>`), then `az containerapp job start`, then
   poll the execution until it succeeds. It fails on failure or after a
   10-minute timeout, with the job logs linked in the summary.
4. `apps.bicep` (image `<sha>`, `APP_VERSION=<sha>`).
5. Smoke tests (§14.4).

### Settings

- **Actions are pinned by commit SHA,** with a version comment. Dependabot
  keeps them current.
- **`dependabot.yml`:** weekly updates for `npm` (minor/patch grouped),
  `github-actions` and `docker` (both Dockerfiles).
- **Container Apps:** single-revision mode. The API has liveness and
  readiness probes on the health endpoints. The web app runs on port 8080
  with external ingress and HTTPS only. Scale rule: HTTP concurrency 50.

## 16. Configuration reference

**API (container environment variables):**

| Variable                                                | Value                                                                              |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `ATLAS_ENV`                                             | `local` · `ci` · `dev` · `uat` · `prod`                                            |
| `APP_VERSION`                                           | git SHA                                                                            |
| `PORT`                                                  | `3000`                                                                             |
| `LOG_LEVEL`                                             | `info` (`debug` locally)                                                           |
| `OIDC_ISSUER`                                           | `https://login.microsoftonline.com/<tenant>/v2.0` (cloud) · mock issuer (local/ci) |
| `OIDC_AUDIENCE`                                         | `atlas-{env}-api` client ID                                                        |
| `OIDC_JWKS_URI`                                         | optional; defaults to OIDC discovery                                               |
| `REQUIRED_SCOPE`                                        | `access_as_user`                                                                   |
| `DB_AUTH`                                               | `entra` (cloud) · `password` (local/ci)                                            |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGSSLMODE` | server FQDN, `5432`, `atlas`, identity name, `require`                             |
| `DATABASE_URL`                                          | local/ci only                                                                      |
| `AZURE_CLIENT_ID`                                       | the client ID of the API's (or migrator's) managed identity                        |
| `API_PRINCIPAL_ID`, `API_ROLE_NAME`                     | migration job only: the runtime role to ensure                                     |
| `APPLICATIONINSIGHTS_CONNECTION_STRING`                 | from `appi-atlas-{env}`                                                            |

**Web (container environment variables, rendered into `/config.json`):**

| Variable                                | Value                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `ATLAS_ENV`                             | as above                                                                      |
| `AUTH_AUTHORITY`                        | `https://login.microsoftonline.com/<tenant>` (cloud) · mock issuer (local/ci) |
| `AUTH_CLIENT_ID`                        | `atlas-{env}-web` client ID                                                   |
| `AUTH_API_SCOPE`                        | `api://<api-client-id>/access_as_user`                                        |
| `AUTH_KIND`                             | `msal` (cloud) · `mock` (local/ci only)                                       |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | from `appi-atlas-{env}`                                                       |
| `API_UPSTREAM`                          | `ca-atlas-api-{env}` (nginx only, not rendered into JSON)                     |

Local values live in git-ignored `.env` files. Committed `.env.example`
files document every variable.

## 17. ADRs and exclusions

**ADRs written while building** (`docs/adr/NNNN-title.md`):

| #    | Decision                                                               |
| ---- | ---------------------------------------------------------------------- |
| 0001 | npm-workspaces monorepo, `apps/` + `packages/` + `tests/`              |
| 0002 | Trunk-based development + build once / promote by SHA                  |
| 0003 | Azure Container Apps (web external, API internal, migration job)       |
| 0004 | No-secrets identity model (federated credentials + managed identities) |
| 0005 | Postgres Entra-only auth, migrator vs runtime role, grants allowlist   |
| 0006 | Migrations as a pre-deploy job + expand/contract                       |
| 0007 | Runtime web config (`/config.json`) and local sign-in                  |
| 0008 | Network model, and dev's public Postgres endpoint                      |
| 0009 | Mock OIDC for E2E tests, with the issuer guard                         |
| 0010 | Single shared registry for all environments                            |
| 0011 | Solo-developer ruleset (0 approvals) and what a team would change      |
| 0012 | Exclusions (below)                                                     |
| 0013 | Pin TypeScript 6.0 until typescript-eslint supports 7                  |
| 0014 | API file layout: `<feature>.<role>.ts`                                 |
| 0015 | Web file layout: Bulletproof React                                     |

**Excluded, with reasons (recorded in ADR 0012):**

| Item                                             | Why it's excluded                          | What a company would do                              |
| ------------------------------------------------ | ------------------------------------------ | ---------------------------------------------------- |
| Subscription per environment (landing zones)     | Only one subscription                      | Management groups, one subscription per environment  |
| Front Door + WAF, Azure Firewall, hub-and-spoke  | $300–900 a month                           | Hub VNet, firewall egress, WAF at the edge           |
| API Management                                   | The API is internal behind the web app     | APIM in front of APIs shared between teams           |
| Postgres HA, geo-redundant backup                | General Purpose tier needed, ~$280 a month | Zone-redundant HA in prod                            |
| Key Vault                                        | There are no secrets to store              | Add when the first third-party credential appears    |
| Blue/green traffic shifting                      | Two apps would need to switch together     | Multi-revision mode + labels + gradual traffic shift |
| Private ACR / private endpoints for the registry | Needs ACR Premium                          | Premium + private endpoint                           |
| Custom domain + managed certificate              | No domain owned                            | Company DNS + managed certificates                   |
| Defender for Cloud paid plans                    | Cost                                       | Defender for Containers / Databases                  |

## 18. Risks

| Risk                                                                     | Mitigation                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The university disables the student account                              | Everything is code. Re-run `bootstrap.sh` + deploy elsewhere                                                                                                                                                                            |
| Tenant policy changes and blocks app registration                        | `bootstrap.sh` checks first. Fallback: a personal Entra tenant for the registrations (`ENTRA_TENANT_ID` is separate from `AZURE_TENANT_ID`)                                                                                             |
| Postgres offer-restricted in `japaneast`                                 | Change `location` in `environments.json` to `malaysiawest`. The policy already allows it (ADR 0017)                                                                                                                                     |
| ACR Tasks blocked on free-credit subscriptions                           | Images are built on GitHub runners                                                                                                                                                                                                      |
| The tag-required Deny policy blocks a resource type that can't take tags | Found on the first dev deploy; switch that assignment to Audit and record it in the ADR                                                                                                                                                 |
| Custom-role action lists are incomplete (what-if, cross-RG deploy)       | Verified on dev first, with errors pointing to the missing action                                                                                                                                                                       |
| `pgaadauth_create_principal_with_oid` needs the `postgres` database      | `migrate.ts` opens a separate connection for this step if required                                                                                                                                                                      |
| MSAL in `protocolMode: OIDC` doesn't work with the mock server           | Confirmed in M3 (MSAL refuses `http:` authorities). Resolved by the `mock` sign-in kind, accepted only for `env` local/ci. The API still fully validates those tokens, and its issuer guard rejects the mock in dev/uat/prod (ADR 0007) |
| Public-repo logs leak identifiers                                        | `::add-mask::`, redacted summaries, no `set -x` in Azure steps                                                                                                                                                                          |
| Credit runs out, the subscription is disabled                            | Budget alerts. `teardown.sh all` at month end                                                                                                                                                                                           |
| Scale-to-zero cold starts make smoke tests flaky                         | Smoke tests retry with backoff for up to ~2 minutes                                                                                                                                                                                     |
| The prod delete lock blocks a deployment step                            | It did (M6): a group-wide `CanNotDelete` lock blocked Postgres's own changes to its private DNS zone. The lock now sits on the prod Postgres server, which still stops the group from being deleted                                     |

## 19. Prerequisites

- Docker Desktop running.
- Node 24 LTS (local is 22.12), installed with `fnm` or `nvm`.
- `az` signed in to the Azure for Students subscription as Owner. Done.
- `gh` signed in as `Chayud-Ac` with `repo` + `workflow` scopes. Done.

## 20. Milestones

Each milestone ends with `npm run check` green and a merged pull request.

| #   | Milestone           | Ends with                                                                                                                                                                                                                     |
| --- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Repo foundation     | GitHub repo, workspaces, TS/ESLint/Prettier/husky, AGENTS.md, README/SECURITY/LICENSE/CODEOWNERS/PR template, `ci.yml` (`check`, `pr-title`, `dependency-review`), CodeQL, Dependabot, repo security settings, ruleset        |
| M2  | API + data          | `@atlas/shared`, API (auth, notes, errors, logging), Drizzle schema + migrations + grants, migrator/app roles in compose, unit + HTTP + integration tests                                                                     |
| M3  | Web                 | React app, AuthProvider/MSAL, runtime config, API client, component tests                                                                                                                                                     |
| M4  | Containers + E2E    | Dockerfiles, nginx, compose `full` profile + mock OIDC, Playwright E2E, `build-images` + Trivy in CI                                                                                                                          |
| M5  | Azure: shared + dev | `bootstrap.sh shared` + `dev` (identities, roles, app registrations, groups, environments, variables, policies, budget), all Bicep, `bicep` + `what-if` CI jobs, `deploy.yml` → dev green, redirect URI, sign-in works in dev |
| M6  | UAT + prod          | `bootstrap.sh uat` + `prod`, private Postgres networking, approvals, prod lock, promotion to prod, GitHub Release                                                                                                             |
| M7  | Observability       | OpenTelemetry + App Insights (API + web), diagnostic settings, prod alerts + availability tests, runbooks                                                                                                                     |
| M8  | Supply chain        | SBOM + provenance attestations, SHA-pinned actions, PSRule exceptions reviewed                                                                                                                                                |
| M9  | Wrap-up             | ADRs 0001–0012, docs pass, demo, then `teardown.sh all` before the credit ends                                                                                                                                                |

The target for today (the original goal: coding, testing, OIDC, CI/CD) is
**M1–M5**. M6–M9 follow over the next sessions.

## 21. Success criteria

1. `npm run check` and `npm run test:e2e` pass locally.
2. Every pull request runs all `ci.yml` jobs, and the ruleset blocks merging
   while any of them is red.
3. A merge to `main` builds **one** image per app, deploys it automatically
   to dev, and promotes the **same SHA** to UAT and then prod after
   approval. The smoke tests prove the version in each environment.
4. No credentials exist anywhere. IDs are GitHub secrets only so that logs mask them (ADR 0004),
   and no IDs are committed.
5. In each environment, a UTCC account can sign in and create, list and
   delete notes. Each change writes an `app.audit_events` row with a trace
   ID that can be found in App Insights.
6. The API has no public endpoint. The UAT and prod databases have no public
   endpoint. The runtime database role can't change the schema or audit
   rows.
7. Prod alerts fire on a failed availability test, and the alert email
   arrives.
8. `AGENTS.md` lets a fresh agent session run, test and extend the project
   without extra explanation.
