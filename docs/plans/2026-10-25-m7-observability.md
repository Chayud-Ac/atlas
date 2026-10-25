# M7: Observability Implementation Plan

> **How this plan will be executed:** inline, in one session (no subagents). For each step, Claude explains it and writes the code, the user approves each write, Claude runs the checks, and the user commits. The Azure checks run after the merge, and the user clicks the approvals. Steps use checkboxes (`- [ ]`) so progress can be ticked off here.

**Goal:** Every stage sends its API and browser telemetry to its own Application Insights, and each audit row's `trace_id` finds its request there (success criterion 5). Prod emails an alert when its health check fails from two locations (criterion 7), when the API returns server errors, and when a migration fails. The runbooks (rollback, add an environment, database access) and `scripts/db-access.sh` exist (spec §11).

**Architecture:**

- **Each stage gets its own telemetry** in `platform.bicep`:
  - a Log Analytics workspace `log-atlas-{env}`
  - a workspace-based Application Insights `appi-atlas-{env}` in it
  - a diagnostic setting sending Postgres's server log there
  - Container Apps logs for every stage stay in `log-atlas-shared` (ADR 0017).
- **API:**
  - `apps/api/src/telemetry.ts` starts `@azure/monitor-opentelemetry` (HTTP and `pg`), plus the Express instrumentation for route names.
  - The Dockerfile loads it with `node --import`, before `server.js`. Without `APPLICATIONINSIGHTS_CONNECTION_STRING` (locally, in CI) it stays off.
  - Routes put the active trace ID on the `Actor`, and the notes service writes it to `audit_events.trace_id`.
- **Web:**
  - `apps/web/src/lib/telemetry.ts` starts `@microsoft/applicationinsights-web` when `/config.json` has a connection string.
  - nginx renders the connection string into `/config.json` and adds its ingestion origin to the CSP's `connect-src`.
  - Same-origin API calls carry W3C `traceparent`, so the page view, its API requests and their SQL share one trace.
- **Prod alerts** live in `infra/modules/alerts.bicep`, deployed by `apps.bicep` when the stage's `alerts` flag is true (prod only):
  - one action group
  - one availability test of `/api/health/ready`, with its metric alert
  - two log alerts
- **`ALERT_EMAIL`** is a prod environment secret, set by `bootstrap.sh prod`. `deploy-env.yml` refuses to deploy a stage that has alerts but no email. `what-if.sh` redacts email addresses as well as GUIDs.

**Tech stack:**

- `@azure/monitor-opentelemetry` 1.20.1
- `@opentelemetry/api` 1.10, `@opentelemetry/instrumentation` 0.221, `@opentelemetry/instrumentation-express` 0.69 (this version on purpose, see the checks below)
- `@microsoft/applicationinsights-web` 3.4.5
- Bicep: `Microsoft.Insights` components, web tests, metric and scheduled query alerts, action groups
- Playwright route interception for the browser telemetry

## Checked before writing (read-only)

| Check                                                    | Result                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@azure/monitor-opentelemetry` 1.20.1 with ESM           | Needs `node --import @azure/monitor-opentelemetry/loader`. The loader registers `@opentelemetry/instrumentation/hook.mjs`, so ES modules loaded later can be patched                                                                                                                |
| Its built-in instrumentations                            | http, pg, mysql, mongodb, redis, Azure SDK. **Not Express**                                                                                                                                                                                                                         |
| `@opentelemetry/instrumentation-express`                 | The latest (0.72.0) needs `@opentelemetry/instrumentation` 0.300 and core 3. Azure Monitor uses 0.221 and core 2. **0.69.0 is the version built on 0.221**. Two copies would mean two ESM hooks, and Express would be missed, so the version is pinned                              |
| Browser SDK 3.4.5 at startup                             | By default it fetches `https://js.monitor.azure.com/scripts/b/ai.config.1.cfg.json`, which the CSP would block. `extensionConfig.AppInsightsCfgSyncPlugin.blkCdnCfg: true` turns that off                                                                                           |
| Availability test locations (Microsoft's list)           | Japan East `apac-jp-kaw-edge`, Southeast Asia `apac-sg-sin-azr`, East Asia `apac-hk-hkn-azr`                                                                                                                                                                                        |
| Prices (Japan East)                                      | Standard web test: $0.000725 per run. Log alert: $1.50 a month at 5 minutes, $0.50 at 15. Metric alert: about $0.10                                                                                                                                                                 |
| Migration job events in `log-atlas-shared`, last 10 days | 8 executions, all successful. Each logs `ProcessExited` (`… exit code: 0, and reason: ProcessExited`) and `ContainerTerminated` (`… exit code '0' …`). The draft failure query below matches none of them. A job's console lines carry `JobName`; their `ContainerAppName` is empty |
| Pipeline permissions                                     | Stage pipelines are Contributor on their own group and Reader on `rg-atlas-shared`. That's enough to create everything here, including a log alert that reads `log-atlas-shared`. Confirmed only by the first prod deploy                                                           |

## Decisions (the user's)

1. **Availability:** one test of `/api/health/ready` through the public web URL, from 3 locations every 15 minutes:
   - It covers nginx, the API and Postgres in one request.
   - It costs about **$6 a month**, against about $38 for the spec's two tests every 5 minutes.
   - Worst case, an outage is noticed in about 30 minutes.
2. **Workspaces:** App Insights and Postgres logs go in a new **per-stage** `log-atlas-{env}`, as the spec had it. Container logs stay in `log-atlas-shared`. No new permissions are needed.
3. **Alert email:** the signed-in account's email, which the budget already uses. `bootstrap.sh prod` stores it as the `ALERT_EMAIL` secret, so it's never committed.
4. **Proving the alert works:** a real outage in prod. The web app's ingress refuses every caller until the test fails from 2 locations and the email arrives, then the restriction is removed. That's a small change from "deactivate the API revision": single-revision mode may refuse to deactivate its only revision, while an ingress restriction is one command each way, and the next deploy would remove it anyway.

**Added cost:** about $8.40 a month, or $0.28 a day:

- availability test $6.30
- API error alert $1.50
- migration alert $0.50
- availability alert $0.10

Ingestion should stay within Log Analytics' free 5 GB a month.

## Deviations from the spec

1. **One availability test every 15 minutes, not two every 5** (decision 1).
2. **Container Apps logs stay in `log-atlas-shared`** (ADR 0017). Only App Insights and Postgres logs go to `log-atlas-{env}`.
3. **"Failed requests" means server errors (5xx).** A 4xx is the caller's problem (an expired token is a 401), and alerting on it would fire on every stale browser tab.
4. **Emergency database access in UAT and prod is a reviewed migration,** not joining `atlas-{env}-db-admins`. Those databases have no network path from outside the VNet, so joining the group gives a human nothing to connect with.
5. **Health-probe requests aren't recorded.** Container Apps probes `/api/health/*` every 10 seconds per replica, which would bury real requests. The availability test records its own results.

## File map

| Path                                                             | Change                                                                                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/logging.ts`, `logging.test.ts`                     | `traceIdOf()`: the active W3C trace ID, or null                                                                                  |
| `apps/api/src/notes/notes.service.ts`, `notes.routes.ts`         | `Actor.traceId`, written to every audit row                                                                                      |
| `apps/api/src/audit/audit.repository.ts`                         | `AuditEvent.traceId` → `trace_id`                                                                                                |
| `apps/api/src/notes/notes.service.test.ts`, `.int.test.ts`       | Expect the trace ID in audit rows                                                                                                |
| `apps/api/src/telemetry.ts`, `telemetry.test.ts`                 | New: starts Azure Monitor OpenTelemetry when there's a connection string                                                         |
| `apps/api/Dockerfile`                                            | `CMD` loads the OpenTelemetry loader and `telemetry.js` first                                                                    |
| `apps/api/package.json`, `package-lock.json`                     | `@azure/monitor-opentelemetry`, `@opentelemetry/api`, `@opentelemetry/instrumentation`, `@opentelemetry/instrumentation-express` |
| `.github/dependabot.yml`                                         | Hold the two OpenTelemetry instrumentation packages to Azure Monitor's versions                                                  |
| `apps/web/src/lib/config.ts`, `config.test.ts`                   | Optional `telemetry.connectionString` in `/config.json`                                                                          |
| `apps/web/src/lib/telemetry.ts`, `telemetry.test.ts`             | New: the browser SDK, the `atlas-web` role name                                                                                  |
| `apps/web/src/main.tsx`, `vite.config.ts`, `config.example.json` | Start telemetry after sign-in is set up; a `telemetry` chunk; the example gets an empty connection string                        |
| `apps/web/package.json`                                          | `@microsoft/applicationinsights-web`                                                                                             |
| `apps/web/nginx/*`, `apps/web/Dockerfile`                        | Render the connection string into `/config.json`, derive `TELEMETRY_ORIGIN` for the CSP, allow both in `NGINX_ENVSUBST_FILTER`   |
| `compose.yaml`, `tests/e2e/src/telemetry.spec.ts`                | A fake connection string for the web app, and a test that answers for its ingestion endpoint                                     |
| `infra/config/environments.json`                                 | Per-stage `logRetentionDays` and `alerts`                                                                                        |
| `infra/platform.bicep`                                           | `log-atlas-{env}`, `appi-atlas-{env}`, the Postgres diagnostic setting                                                           |
| `infra/apps.bicep`                                               | Connection string and OpenTelemetry settings for both apps, `alertEmail`, the alerts module                                      |
| `infra/modules/alerts.bicep`                                     | New: action group, availability test, three alert rules                                                                          |
| `.github/workflows/deploy-env.yml`                               | Check and pass `ALERT_EMAIL`; fix the migration-failure message (its logs are in `log-atlas-shared`)                             |
| `scripts/bootstrap.sh`                                           | `signed_in_email`; set `ALERT_EMAIL` for stages with alerts                                                                      |
| `scripts/what-if.sh`                                             | Redact email addresses                                                                                                           |
| `scripts/smoke-test.sh`                                          | Check that `/config.json` has a connection string                                                                                |
| `scripts/db-access.sh`                                           | New: open or close dev's Postgres firewall for your IP                                                                           |
| `docs/runbooks/*.md`                                             | New: `rollback.md`, `add-environment.md`, `database-access.md`                                                                   |
| Spec, ADRs 0016 and 0017, AGENTS.md, README                      | §11 as built; where telemetry and logs are; the new script and runbooks                                                          |

## Tasks

Unit tests for one file: `(cd apps/api && npx vitest run src/<file>)` or `(cd apps/web && npx vitest run src/<file>)`. This runs a single file without tripping the coverage threshold.

### Task 0: Branch

- [x] `git switch -c feat/m7-observability main`

### Task 1: Audit rows carry the trace ID

**Files:** `apps/api/src/logging.ts`, `logging.test.ts`, `audit/audit.repository.ts`, `notes/notes.service.ts`, `notes/notes.routes.ts`, `notes/notes.service.test.ts`, `notes/notes.service.int.test.ts`, `apps/api/package.json`

- [x] **Step 1: Add `@opentelemetry/api`.** It's the API only: with no SDK started, every call is a cheap no-op.

  ```bash
  npm install -w @atlas/api @opentelemetry/api@^1.10.0
  ```

- [x] **Step 2: Write the failing test.** In `apps/api/src/logging.test.ts`:
  - add `import { ROOT_CONTEXT, TraceFlags, trace } from '@opentelemetry/api';` to the imports
  - add `traceIdOf` to the `./logging.js` import
  - then append:

  ```ts
  describe('traceIdOf', () => {
    it('returns the trace id of the active span', () => {
      const ctx = trace.setSpanContext(ROOT_CONTEXT, {
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        traceFlags: TraceFlags.SAMPLED,
      });
      expect(traceIdOf(ctx)).toBe('0af7651916cd43dd8448eb211c80319c');
    });

    it('returns null when there is no trace (telemetry is off)', () => {
      expect(traceIdOf()).toBeNull();
      expect(traceIdOf(ROOT_CONTEXT)).toBeNull();
    });
  });
  ```

- [x] **Step 3: Run it.** `(cd apps/api && npx vitest run src/logging.test.ts)`. Expected: FAIL, because `traceIdOf` isn't exported.

- [x] **Step 4: Implement it in `apps/api/src/logging.ts`.** Add the import, then this after `requestIdOf`:

  ```ts
  import { context, isSpanContextValid, trace, type Context } from '@opentelemetry/api';
  ```

  ```ts
  /**
   * The W3C trace id of the current request, for audit rows: search for it in Application Insights
   * (`OperationId`) to see the page, the API request and its SQL. Null when telemetry is off.
   */
  export function traceIdOf(ctx: Context = context.active()): string | null {
    const span = trace.getSpanContext(ctx);
    return span && isSpanContextValid(span) ? span.traceId : null;
  }
  ```

- [x] **Step 5: Run it again.** Expected: PASS.

- [x] **Step 6: Expect the trace ID in the service tests.** In `notes.service.test.ts`, give the actors trace IDs (one real, one null):

  ```ts
  const alice: Actor = {
    userId: '0199c3a0-0000-7000-8000-00000000000a',
    requestId: 'req-alice',
    traceId: '0af7651916cd43dd8448eb211c80319c',
  };
  const bob: Actor = {
    userId: '0199c3a0-0000-7000-8000-00000000000b',
    requestId: 'req-bob',
    traceId: null,
  };
  ```

  In the first test, rename it to `'creates a note owned by the actor and audits it with the request and trace ids'` and add `traceId: '0af7651916cd43dd8448eb211c80319c',` after `requestId: 'req-alice',` in the expected event.

  In `notes.service.int.test.ts`:

  ```ts
  alice = { userId: a.id, requestId: 'req-a', traceId: '4bf92f3577b34da6a3ce929d0e0e4736' };
  bob = { userId: b.id, requestId: 'req-b', traceId: null };
  ```

  and in `'writes an audit row with each change'`:

  ```ts
  const { rows } = await migrator.query<{
    action: string;
    entity_id: string;
    request_id: string;
    trace_id: string | null;
  }>(
    'SELECT action, entity_id, request_id, trace_id FROM app.audit_events ORDER BY occurred_at, id',
  );
  const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
  expect(rows).toEqual([
    { action: 'note.created', entity_id: note.id, request_id: 'req-a', trace_id: traceId },
    { action: 'note.deleted', entity_id: note.id, request_id: 'req-a', trace_id: traceId },
  ]);
  ```

- [x] **Step 7: Run them.** `npm run typecheck` fails: `Actor` has no `traceId`.

- [x] **Step 8: Implement it.**
  - In `notes.service.ts`, `Actor` gains `traceId: string | null;` (doc comment unchanged), and both `audit.record` calls gain `traceId: actor.traceId,` after `requestId`.
  - In `audit.repository.ts`, `AuditEvent` gains `traceId?: string | null;`, and the insert gains `traceId: event.traceId ?? null,`.
  - In `notes.routes.ts`, import `traceIdOf` with `requestIdOf`, and:

  ```ts
  function actorOf(req: Request): Actor {
    return { userId: authOf(req).userId, requestId: requestIdOf(req), traceId: traceIdOf() };
  }
  ```

  The route handler calls `actorOf` before its first `await`, so the active context is still the request's.

- [x] **Step 9: Run the tests.**
  - `(cd apps/api && npx vitest run src/notes/notes.service.test.ts)`: PASS.
  - With Docker running, `(cd apps/api && npx vitest run --config vitest.integration.config.ts src/notes/notes.service.int.test.ts)`: PASS.
  - `npm run typecheck`: clean.

- [x] **Step 10: The user commits.** `git add apps/api package-lock.json && git commit -m "feat(api): record the trace id in audit rows"`

### Task 2: API telemetry

**Files:** create `apps/api/src/telemetry.ts` and `telemetry.test.ts`; modify `apps/api/Dockerfile`, `apps/api/package.json` and `.github/dependabot.yml`.

- [x] **Step 1: Add the packages.** The two instrumentation versions match what `@azure/monitor-opentelemetry` 1.20.1 depends on.

  ```bash
  npm install -w @atlas/api @azure/monitor-opentelemetry@^1.20.1 \
    @opentelemetry/instrumentation@^0.221.0 @opentelemetry/instrumentation-express@^0.69.0
  npm ls @opentelemetry/instrumentation @opentelemetry/core
  ```

  Expected: one version of each. Every other line says `deduped`. If npm shows two versions, stop: the ESM hook would only see one copy.

- [x] **Step 2: Write the failing test** `apps/api/src/telemetry.test.ts`:

  ```ts
  import { describe, expect, it } from 'vitest';
  import { startTelemetry } from './telemetry.js';

  describe('startTelemetry', () => {
    it('stays off without a connection string (locally and in CI)', () => {
      expect(startTelemetry({})).toBe(false);
      expect(startTelemetry({ APPLICATIONINSIGHTS_CONNECTION_STRING: '' })).toBe(false);
    });
  });
  ```

- [x] **Step 3: Run it.** `(cd apps/api && npx vitest run src/telemetry.test.ts)`. Expected: FAIL, because `./telemetry.js` doesn't exist.

- [x] **Step 4: Write `apps/api/src/telemetry.ts`:**

  ```ts
  import type { IncomingMessage } from 'node:http';
  import { useAzureMonitor } from '@azure/monitor-opentelemetry';
  import { metrics, trace } from '@opentelemetry/api';
  import { registerInstrumentations } from '@opentelemetry/instrumentation';
  import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';

  /**
   * Sends the API's requests, SQL queries, metrics and exceptions to Application Insights (spec
   * §11.1). Off without a connection string, so local runs and CI send nothing. The Dockerfile
   * loads this file with `node --import`, before server.js imports http, express and pg:
   * OpenTelemetry can only patch an ES module that hasn't been loaded yet.
   */
  export function startTelemetry(env: Record<string, string | undefined>): boolean {
    const connectionString = env.APPLICATIONINSIGHTS_CONNECTION_STRING;
    if (!connectionString) return false;

    // Container Apps probes the health endpoints every 10 seconds per replica: leave them out, so
    // they don't bury real requests (and Log Analytics bills per GB). Azure Monitor types this as
    // InstrumentationConfig, but hands it to OpenTelemetry's HttpInstrumentation, which reads the hook.
    const http = {
      enabled: true,
      ignoreIncomingRequestHook: (req: IncomingMessage) =>
        req.url?.startsWith('/api/health/') ?? false,
    };
    // The cloud role name, atlas-api, comes from OTEL_SERVICE_NAME (apps.bicep).
    useAzureMonitor({
      azureMonitorExporterOptions: { connectionString },
      instrumentationOptions: { http },
    });
    // Express isn't one of Azure Monitor's built-in instrumentations. It names each request by its
    // route (`DELETE /api/notes/:id`) instead of its URL.
    registerInstrumentations({
      tracerProvider: trace.getTracerProvider(),
      meterProvider: metrics.getMeterProvider(),
      instrumentations: [new ExpressInstrumentation()],
    });
    return true;
  }

  startTelemetry(process.env);
  ```

- [x] **Step 5: Run the tests.** The telemetry test passes, then `npm test -w @atlas/api` passes, with coverage still above 80%.

- [x] **Step 6: Load it first in the image.** Replace the last line of `apps/api/Dockerfile`:

  ```dockerfile
  # Telemetry first (spec §11.1): the loader lets OpenTelemetry patch ES modules, and telemetry.js
  # starts it before server.js imports anything. Without APPLICATIONINSIGHTS_CONNECTION_STRING it
  # stays off. The migration job runs its own command, without either.
  CMD ["node", "--import", "@azure/monitor-opentelemetry/loader", "--import", "./apps/api/dist/telemetry.js", "apps/api/dist/server.js"]
  ```

- [x] **Step 7: Hold the instrumentation versions.** In `.github/dependabot.yml`, under the npm entry's `ignore:`:

  ```yaml
  # Must match the versions @azure/monitor-opentelemetry depends on. A second copy means a second
  # ESM hook, and Express goes untraced. Move them by hand when it moves.
  - dependency-name: '@opentelemetry/instrumentation'
    update-types: ['version-update:semver-minor', 'version-update:semver-major']
  - dependency-name: '@opentelemetry/instrumentation-express'
    update-types: ['version-update:semver-minor', 'version-update:semver-major']
  ```

- [x] **Step 8: Check that the image starts with telemetry on.** The user runs these in their own terminal:

  ```bash
  docker compose --profile full up -d --build --wait
  # Telemetry on, sending to a closed port: the API must still start and answer.
  docker compose --profile full run --rm --no-deps -p 3001:3000 \
    -e 'APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=00000000-0000-4000-8000-000000000000;IngestionEndpoint=http://127.0.0.1:9/;LiveEndpoint=http://127.0.0.1:9/' \
    -e OTEL_SERVICE_NAME=atlas-api api
  ```

  Then, in another terminal, `curl -s -o /dev/null -w '%{http_code}\n' localhost:3001/api/health/ready`. Expected: `200`. Stop the API with Ctrl-C.

- [x] **Step 9: The user commits.** `git add apps/api .github/dependabot.yml package-lock.json && git commit -m "feat(api): send telemetry to Application Insights"`

### Task 3: Web telemetry

**Files:** create `apps/web/src/lib/telemetry.ts` and `telemetry.test.ts`; modify `apps/web/src/lib/config.ts`, `config.test.ts`, `main.tsx`, `vite.config.ts`, `config.example.json` and `apps/web/package.json`.

- [x] **Step 1: Add the SDK.** `npm install -w @atlas/web @microsoft/applicationinsights-web@^3.4.5`

- [x] **Step 2: Write the failing config tests.** In `apps/web/src/lib/config.test.ts`, inside `describe('RuntimeConfig')`:

  ```ts
  it('accepts an Application Insights connection string', () => {
    const config = {
      ...msalConfig,
      telemetry: { connectionString: 'InstrumentationKey=k;IngestionEndpoint=https://in.example/' },
    };
    expect(RuntimeConfig.parse(config)).toEqual(config);
  });

  it('accepts an empty connection string: telemetry is off', () => {
    const config = { ...mockConfig, telemetry: { connectionString: '' } };
    expect(RuntimeConfig.parse(config)).toEqual(config);
  });
  ```

- [x] **Step 3: Run them.** `(cd apps/web && npx vitest run src/lib/config.test.ts)`. Expected: FAIL, because zod drops the unknown `telemetry` key.

- [x] **Step 4: Add it to the schema.** In `apps/web/src/lib/config.ts`, after `auth: AuthSettings,` inside `RuntimeConfig`'s object:

  ```ts
  /** Application Insights, for the browser SDK. Empty or missing: no telemetry is sent. */
  telemetry: z.object({ connectionString: z.string() }).optional(),
  ```

  In `apps/web/config.example.json`, add `"telemetry": { "connectionString": "" }` after `auth`.

- [x] **Step 5: Run them again.** Expected: PASS.

- [x] **Step 6: Write the failing telemetry tests** `apps/web/src/lib/telemetry.test.ts`:

  ```ts
  import type { ITelemetryItem } from '@microsoft/applicationinsights-web';
  import { describe, expect, it } from 'vitest';
  import { setRoleName, startTelemetry } from './telemetry';

  describe('startTelemetry', () => {
    it('does nothing without a connection string', () => {
      expect(startTelemetry(undefined)).toBeUndefined();
      expect(startTelemetry('')).toBeUndefined();
    });
  });

  describe('setRoleName', () => {
    it('names the browser in the application map, keeping other tags', () => {
      const item: ITelemetryItem = { name: 'pageview', tags: { 'ai.session.id': 's1' } };
      setRoleName(item);
      expect(item.tags).toEqual({ 'ai.session.id': 's1', 'ai.cloud.role': 'atlas-web' });
    });
  });
  ```

  Sending telemetry for real is the E2E test's job (Task 5): jsdom can't show what Chromium does with the CSP.

- [x] **Step 7: Run them.** Expected: FAIL, because `./telemetry` doesn't exist.

- [x] **Step 8: Write `apps/web/src/lib/telemetry.ts`:**

  ```ts
  import {
    ApplicationInsights,
    DistributedTracingModes,
    type ITelemetryItem,
  } from '@microsoft/applicationinsights-web';

  /** How Application Insights' application map tells the browser from the API (atlas-api). */
  export function setRoleName(item: ITelemetryItem): void {
    item.tags = { ...item.tags, 'ai.cloud.role': 'atlas-web' };
  }

  /**
   * Starts the Application Insights browser SDK when this environment has a connection string
   * (spec §10). It records page views, errors and fetches, and adds W3C `traceparent` to
   * same-origin requests, so a page view, its API calls and their SQL share one trace.
   */
  export function startTelemetry(
    connectionString: string | undefined,
  ): ApplicationInsights | undefined {
    if (!connectionString) return undefined;
    const appInsights = new ApplicationInsights({
      config: {
        connectionString,
        // traceparent only: the default also sends the SDK's older Request-Id header.
        distributedTracingMode: DistributedTracingModes.W3C,
        // No ai_user or ai_session cookies.
        disableCookiesUsage: true,
        // By default the SDK fetches settings from js.monitor.azure.com, which the CSP blocks.
        extensionConfig: { AppInsightsCfgSyncPlugin: { blkCdnCfg: true } },
      },
    });
    appInsights.loadAppInsights();
    appInsights.addTelemetryInitializer(setRoleName);
    appInsights.trackPageView();
    return appInsights;
  }
  ```

- [x] **Step 9: Run them again.** Expected: PASS.

- [x] **Step 10: Start it in `main.tsx`.** Import `startTelemetry` from `@/lib/telemetry`, and in the `try` block:

  ```tsx
  const config = await loadRuntimeConfig();
  const auth = await createAuth(config);
  // After MSAL has handled a sign-in redirect, so the first page view's URL has no auth response in it.
  startTelemetry(config.telemetry?.connectionString);
  root.render(
  ```

- [x] **Step 11: Give the SDK its own chunk.** In `apps/web/vite.config.ts`, add this group before `vendor`:

  ```ts
  { name: 'telemetry', test: /node_modules[\\/](@microsoft|@nevware21)[\\/]/ },
  ```

- [x] **Step 12: Check the web workspace.** `npm test -w @atlas/web` and `npm run build -w @atlas/web`. Expected: both pass, and the build lists a `telemetry-*.js` chunk.

- [x] **Step 13: The user commits.** `git add apps/web package-lock.json && git commit -m "feat(web): send browser telemetry to Application Insights"`

### Task 4: nginx serves the connection string and allows its origin

**Files:** `apps/web/nginx/19-atlas-env.envsh`, `default.conf.template`, `security-headers.conf.template`, `apps/web/Dockerfile`

- [x] **Step 1: Validate the connection string and derive its origin.** Append to `19-atlas-env.envsh`:

  ```sh
  # Optional: without it (locally) the app sends no telemetry. It's written into JSON and into the
  # CSP header, so only the characters a connection string uses are allowed. Exported even when
  # empty: envsubst leaves an unset variable's ${NAME} in the file.
  APPLICATIONINSIGHTS_CONNECTION_STRING="${APPLICATIONINSIGHTS_CONNECTION_STRING:-}"
  case "$APPLICATIONINSIGHTS_CONNECTION_STRING" in
    *[!A-Za-z0-9=\;:/._-]*)
      echo "APPLICATIONINSIGHTS_CONNECTION_STRING contains unexpected characters" >&2
      exit 1
      ;;
  esac
  export APPLICATIONINSIGHTS_CONNECTION_STRING

  # The browser SDK posts to the connection string's IngestionEndpoint, so the CSP must allow its
  # origin: ...;IngestionEndpoint=https://japaneast-1.in.applicationinsights.azure.com/;... gives
  # https://japaneast-1.in.applicationinsights.azure.com
  TELEMETRY_ORIGIN=$(printf '%s' "$APPLICATIONINSIGHTS_CONNECTION_STRING" |
    sed -n -E 's#.*IngestionEndpoint=(https?://[^/;]+).*#\1#p')
  export TELEMETRY_ORIGIN
  ```

- [x] **Step 2: Put it in `/config.json`.** In `default.conf.template`, the `return 200` line becomes:

  ```nginx
  return 200 '{"env":"${ATLAS_ENV}","auth":{"kind":"${AUTH_KIND}","authority":"${AUTH_AUTHORITY}","clientId":"${AUTH_CLIENT_ID}","apiScope":"${AUTH_API_SCOPE}"},"telemetry":{"connectionString":"${APPLICATIONINSIGHTS_CONNECTION_STRING}"}}';
  ```

- [x] **Step 3: Allow the origin in the CSP.** In `security-headers.conf.template`, `connect-src 'self' ${AUTH_ORIGIN};` becomes `connect-src 'self' ${AUTH_ORIGIN} ${TELEMETRY_ORIGIN};`, and the comment above it gains:

  ```nginx
  # connect-src includes Application Insights' ingestion origin, from the connection string.
  ```

- [x] **Step 4: Let envsubst substitute both.** In `apps/web/Dockerfile`:

  ```dockerfile
  ENV NGINX_ENVSUBST_FILTER="^(ATLAS_ENV|AUTH_[A-Z_]+|API_UPSTREAM|APPLICATIONINSIGHTS_CONNECTION_STRING|TELEMETRY_ORIGIN)$"
  ```

- [x] **Step 5: Lint.** `npm run lint`. shellcheck covers the `.envsh` file.

- [x] **Step 6: The user commits.** `git add apps/web && git commit -m "feat(web): serve the telemetry connection string and allow it in the CSP"`

### Task 5: E2E: the browser sends telemetry and traces its API calls

**Files:** `compose.yaml`; create `tests/e2e/src/telemetry.spec.ts`.

- [x] **Step 1: Give the compose web app a fake connection string.** Under `web:` → `environment:`:

  ```yaml
  # A fake Application Insights, so the E2E tests see the browser SDK run under the real CSP.
  # Nothing listens on 8091: telemetry.spec.ts answers for it. In manual testing, the browser
  # console shows the failed sends.
  APPLICATIONINSIGHTS_CONNECTION_STRING: 'InstrumentationKey=00000000-0000-4000-8000-000000000000;IngestionEndpoint=http://localhost:8091/'
  ```

- [x] **Step 2: Write the test** `tests/e2e/src/telemetry.spec.ts`:

  ```ts
  import { expect, signIn, test } from './fixtures.js';

  // compose.yaml gives the web app a fake connection string whose ingestion endpoint is
  // http://localhost:8091/. Nothing listens there, so the test answers for it. The fixture's CSP
  // check proves the CSP allows that origin and that the SDK fetches nothing else.
  test('the browser sends telemetry and traces its API calls', async ({ page }) => {
    // The SDK sends its first batch after 15 seconds.
    test.setTimeout(60_000);
    const batches: string[] = [];
    await page.route('http://localhost:8091/**', async (route) => {
      batches.push(route.request().postData() ?? '');
      await route.fulfill({ json: { itemsReceived: 1, itemsAccepted: 1, errors: [] } });
    });
    const me = page.waitForRequest('**/api/users/me');

    await signIn(page);

    // W3C trace context on the API call, so the API's spans join the browser's trace (spec §10).
    expect((await me).headers()['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
    await expect
      .poll(() => batches.join('\n'), { timeout: 30_000 })
      .toContain('"ai.cloud.role":"atlas-web"');
  });
  ```

- [x] **Step 3: Run the full E2E suite.** The user runs:

  ```bash
  docker compose --profile full up -d --build --wait
  npm run test:e2e
  ```

  Expected: every test passes, the new one included, with no CSP violations. Two failures to look for:
  - A CSP violation for `localhost:8091`: `TELEMETRY_ORIGIN` wasn't rendered. Check the filter (Task 4, Step 4).
  - A violation for any other Microsoft host: turn that SDK feature off, rather than widen the CSP.

- [x] **Step 4: The user commits.** `git add compose.yaml tests/e2e && git commit -m "test(e2e): browser telemetry and trace propagation"`

### Task 6: Per-stage telemetry in Azure

**Files:** `infra/config/environments.json`, `infra/platform.bicep`, `infra/apps.bicep`, `scripts/smoke-test.sh`

- [x] **Step 1: Add the settings.** In `environments.json`, add to each environment, after `localhostRedirect`:
  - dev: `"logRetentionDays": 30, "alerts": false`
  - uat: `"logRetentionDays": 30, "alerts": false`
  - prod: `"logRetentionDays": 30, "alerts": true`

- [x] **Step 2: Add the workspace, App Insights and Postgres logs to `platform.bicep`.** Append:

  ```bicep
  // ---- Telemetry (spec §11.1): this stage's Application Insights and Postgres logs ----
  // Container Apps logs from every stage stay in log-atlas-shared, next to the environment (ADR 0017).

  resource logs 'Microsoft.OperationalInsights/workspaces@2026-03-01' = {
    name: 'log-atlas-${environmentName}'
    location: location
    tags: tags
    properties: {
      sku: { name: 'PerGB2018' }
      retentionInDays: env.logRetentionDays
    }
  }

  resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
    name: 'appi-atlas-${environmentName}'
    location: location
    tags: tags
    kind: 'web'
    properties: {
      Application_Type: 'web'
      WorkspaceResourceId: logs.id
      // The browser SDK can't use Entra ID, so local auth stays on. The connection string only
      // lets you send telemetry, and the web app publishes it in /config.json anyway.
      DisableLocalAuth: false
    }
  }

  // The same API version as shared.bicep's diagnostic setting.
  #disable-next-line use-recent-api-versions
  resource postgresLogs 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
    name: 'to-log-analytics'
    scope: postgres
    properties: {
      workspaceId: logs.id
      // The server log: connections, authentication failures and errors.
      logs: [{ category: 'PostgreSQLLogs', enabled: true }]
    }
  }
  ```

- [x] **Step 3: Give both apps the connection string.** In `apps.bicep`, after the `registry` resource:

  ```bicep
  resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
    name: 'appi-atlas-${environmentName}'
  }
  ```

  Append to the API container's `env`:

  ```bicep
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
  // The cloud role name in App Insights, and the version that served each request.
  { name: 'OTEL_SERVICE_NAME', value: 'atlas-api' }
  { name: 'OTEL_RESOURCE_ATTRIBUTES', value: 'service.version=${imageTag}' }
  ```

  Append to the web container's `env`:

  ```bicep
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
  ```

- [x] **Step 4: Smoke-test the connection string.** In `scripts/smoke-test.sh`, after the `/config.json` check:

  ```bash
  check "/config.json has an Application Insights connection string" \
    field_is /config.json '.telemetry.connectionString != ""' true
  ```

  `field_is` prints nothing but `ok:`, so the connection string never reaches the public log.

- [x] **Step 5: Build and lint.** `for t in infra/*.bicep infra/modules/*.bicep; do az bicep build --file "$t" --stdout > /dev/null; done`. Expected: no errors. If `use-recent-api-versions` warns, take the newest GA version it suggests.

- [x] **Step 6: The user commits.** `git add infra scripts/smoke-test.sh && git commit -m "feat(infra): Application Insights and Postgres logs per stage"`

### Task 7: Prod alerts

**Files:** create `infra/modules/alerts.bicep`; modify `infra/apps.bicep`, `.github/workflows/deploy-env.yml`, `scripts/bootstrap.sh` and `scripts/what-if.sh`.

- [x] **Step 1: Write `infra/modules/alerts.bicep`:**

  ```bicep
  // A stage's alerts (spec §11.2, prod only): an availability test of the public health check,
  // and log alerts for API server errors and failed migrations. All email ALERT_EMAIL.
  targetScope = 'resourceGroup'

  @description('The environment: a key of environments.json.')
  param environmentName string

  @description('Where alerts are emailed (the ALERT_EMAIL secret).')
  param alertEmail string

  @description('The public URL the availability test requests.')
  param healthUrl string

  var config = loadJsonContent('../config/environments.json')
  var location = config.environments[environmentName].location
  var tags = union(config.tags, { env: environmentName })
  var name = 'atlas-${environmentName}'

  resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
    name: 'appi-${name}'
  }

  resource logs 'Microsoft.OperationalInsights/workspaces@2026-03-01' existing = {
    name: 'log-${name}'
  }

  // Container Apps writes every stage's job events here (ADR 0017).
  resource sharedLogs 'Microsoft.OperationalInsights/workspaces@2026-03-01' existing = {
    name: 'log-atlas-shared'
    scope: resourceGroup(config.shared.resourceGroup)
  }

  resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
    name: 'ag-${name}'
    location: 'global'
    tags: tags
    properties: {
      groupShortName: name
      enabled: true
      emailReceivers: [{ name: 'owner', emailAddress: alertEmail, useCommonAlertSchema: true }]
    }
  }

  // One request every 15 minutes from 3 locations. It goes through nginx to the API and Postgres,
  // for about $6 a month (two tests every 5 minutes would be about $38).
  resource availability 'Microsoft.Insights/webtests@2022-06-15' = {
    name: 'avail-${name}-health'
    location: location
    // Azure requires this tag: it links the test to its App Insights.
    tags: union(tags, { 'hidden-link:${appInsights.id}': 'Resource' })
    kind: 'standard'
    properties: {
      SyntheticMonitorId: 'avail-${name}-health'
      Name: 'Health check (${environmentName})'
      Kind: 'standard'
      Enabled: true
      Frequency: 900
      Timeout: 30
      // A location reports a failure only after three attempts in a row fail.
      RetryEnabled: true
      Locations: [
        { Id: 'apac-jp-kaw-edge' } // Japan East
        { Id: 'apac-sg-sin-azr' } // Southeast Asia
        { Id: 'apac-hk-hkn-azr' } // East Asia
      ]
      Request: { RequestUrl: healthUrl, HttpVerb: 'GET', ParseDependentRequests: false }
      ValidationRules: { ExpectedHttpStatusCode: 200, SSLCheck: true, SSLCertRemainingLifetimeCheck: 7 }
    }
  }

  // Two failed locations, not one, so one location's network trouble doesn't page anyone.
  resource availabilityAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
    name: 'alert-${name}-availability'
    location: 'global'
    tags: tags
    properties: {
      description: 'The ${environmentName} health check fails from 2 or more locations.'
      severity: 1
      enabled: true
      scopes: [availability.id, appInsights.id]
      evaluationFrequency: 'PT5M'
      windowSize: 'PT15M'
      criteria: {
        'odata.type': 'Microsoft.Azure.Monitor.WebtestLocationAvailabilityCriteria'
        webTestId: availability.id
        componentId: appInsights.id
        failedLocationCount: 2
      }
      actions: [{ actionGroupId: actionGroup.id }]
    }
  }

  resource apiErrorsAlert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
    name: 'alert-${name}-api-errors'
    location: location
    tags: tags
    properties: {
      description: 'More than 5 API requests failed with a server error in 5 minutes.'
      severity: 2
      enabled: true
      scopes: [logs.id]
      evaluationFrequency: 'PT5M'
      windowSize: 'PT5M'
      criteria: {
        allOf: [
          {
            // Server errors only: a 4xx is the caller's mistake (an expired token is a 401).
            query: 'AppRequests | where AppRoleName == "atlas-api" and toint(ResultCode) >= 500'
            timeAggregation: 'Count'
            operator: 'GreaterThan'
            threshold: 5
            failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
          }
        ]
      }
      autoMitigate: true
      actions: { actionGroups: [actionGroup.id] }
    }
  }

  // Every 15 minutes, over 30, so a late-arriving event still lands in a window. The pipeline
  // already fails a deploy whose migration fails; this also catches manual runs.
  resource migrationAlert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
    name: 'alert-${name}-migration'
    location: location
    tags: tags
    properties: {
      description: 'A migration job execution exited with a non-zero code.'
      severity: 1
      enabled: true
      scopes: [sharedLogs.id]
      evaluationFrequency: 'PT15M'
      windowSize: 'PT30M'
      criteria: {
        allOf: [
          {
            // Container Apps logs each exit twice: "exit code: 0," and "exit code '0'".
            query: 'ContainerAppSystemLogs | where JobName == "caj-atlas-migrate-${environmentName}" | where Log has "exit code" and not(Log contains "exit code: 0," or Log contains "exit code \'0\'")'
            timeAggregation: 'Count'
            operator: 'GreaterThan'
            threshold: 0
            failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
          }
        ]
      }
      autoMitigate: true
      actions: { actionGroups: [actionGroup.id] }
    }
  }
  ```

- [x] **Step 2: Deploy it from `apps.bicep`.** Add a parameter after `apiClientId`:

  ```bicep
  @description('Where alerts are emailed: the ALERT_EMAIL secret. Empty in stages without alerts.')
  param alertEmail string = ''
  ```

  Append, before the output:

  ```bicep
  // Prod only (spec §11.2). deploy-env.yml refuses to deploy a stage that has alerts but no email.
  // The !empty check is for the PR what-if: it reuses the last deployment's parameters, which have
  // no alertEmail until the first deploy after this one.
  module alerts 'modules/alerts.bicep' = if (env.alerts && !empty(alertEmail)) {
    name: 'alerts-${environmentName}'
    params: {
      environmentName: environmentName
      alertEmail: alertEmail
      healthUrl: 'https://${web.properties.configuration.ingress.fqdn}/api/health/ready'
    }
  }
  ```

- [x] **Step 3: Pass the email in `deploy-env.yml`.** After the "Find the resource group" step:

  ```yaml
  # A stage with alerts needs somewhere to send them (bootstrap.sh sets ALERT_EMAIL). Checked
  # before anything is deployed, so a missing secret doesn't leave half a deploy behind.
  - name: Check the alert email
    env:
      ALERT_EMAIL: ${{ secrets.ALERT_EMAIL }}
    run: |
      alerts="$(jq -r --arg env "$ENVIRONMENT" '.environments[$env].alerts' infra/config/environments.json)"
      if [[ "$alerts" == "true" && -z "$ALERT_EMAIL" ]]; then
        echo "::error::$ENVIRONMENT has alerts but no ALERT_EMAIL secret. Run scripts/bootstrap.sh $ENVIRONMENT."
        exit 1
      fi
  ```

  - In the Apps step, add `ALERT_EMAIL: ${{ secrets.ALERT_EMAIL }}` to its `env`, and `alertEmail="$ALERT_EMAIL"` to its `--parameters`.
  - Fix the migration error message, since container logs were never in a stage workspace: `Its logs are in log-atlas-shared (ContainerAppConsoleLogs, where JobName is $job).`

- [x] **Step 4: Set `ALERT_EMAIL` in `bootstrap.sh`.** Add a helper before `ensure_budget`, and use it there:

  ```bash
  # The signed-in user's email: budget and alert notifications go there.
  signed_in_email() {
    local email
    email="$(az ad signed-in-user show --query mail --output tsv)"
    if [[ -z "$email" ]]; then email="$(az ad signed-in-user show --query userPrincipalName --output tsv)"; fi
    printf '%s' "$email"
  }
  ```

  - In `ensure_budget`, the two `email=` lines become `email="$(signed_in_email)"`.
  - In `bootstrap_environment`, after `set_variable DB_ADMIN_GROUP_NAME …`:

  ```bash
  # A secret, not a variable: GitHub masks it in the public logs, as it does IDs (ADR 0004).
  if [[ "$(cfg ".environments[\"$env\"].alerts")" == "true" ]]; then
    set_secret ALERT_EMAIL "$(signed_in_email)" "$env"
  fi
  ```

- [x] **Step 5: Redact email addresses in `what-if.sh`.** The action group's address would otherwise appear in the public job summary.

  ```bash
  EMAIL='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
  ```

  ```bash
  redact() { sed -E "s/$GUID/<redacted>/g; s/$EMAIL/<redacted>/g"; }
  ```

  Update the header comment: "Output is redacted (GUIDs and email addresses): this repo is public…".

  Check it: `printf 'emailAddress: "a.b@example.com" id 00000000-0000-4000-8000-000000000000\n' | sed -E "s/$GUID/<redacted>/g; s/$EMAIL/<redacted>/g"`, with both variables set as in the script. Expected: `emailAddress: "<redacted>" id <redacted>`.

- [x] **Step 6: Lint.** Run the Bicep build loop from Task 6, then `npm run lint` (actionlint and shellcheck).

- [x] **Step 7: The user commits.** `git add infra .github/workflows/deploy-env.yml scripts && git commit -m "feat(infra): prod alerts and availability test"`

### Task 8: `db-access.sh` and the runbooks

**Files:** create `scripts/db-access.sh`, `docs/runbooks/rollback.md`, `add-environment.md` and `database-access.md`.

- [x] **Step 1: Write `scripts/db-access.sh`** (`chmod +x`):

  ```bash
  #!/usr/bin/env bash
  # Opens a stage's Postgres firewall to this machine's public IP, for a member of its
  # atlas-{env}-db-admins group (spec §11.4: dev only). --revoke closes it again.
  #
  #   scripts/db-access.sh <env> [--revoke]
  set -euo pipefail

  CONFIG="$(cd "$(dirname "$0")/.." && pwd)/infra/config/environments.json"
  RULE="human-$(whoami | tr -cd 'A-Za-z0-9_-')"

  usage() { printf 'Usage: %s <env> [--revoke]\n' "$0" >&2; exit 2; }

  [[ $# -eq 1 || ($# -eq 2 && "$2" == "--revoke") ]] || usage
  env="$1"
  rg="$(jq -r --arg env "$env" '.environments[$env].resourceGroup // empty' "$CONFIG")"
  [[ -n "$rg" ]] || usage
  if [[ "$(jq -r --arg env "$env" '.environments[$env].humanDbAccess' "$CONFIG")" != "true" ]]; then
    printf '%s has no human database access. See docs/runbooks/database-access.md.\n' "$env" >&2
    exit 1
  fi
  server="$(az postgres flexible-server list --resource-group "$rg" --query '[0].name' --output tsv)"

  if [[ "${2:-}" == "--revoke" ]]; then
    az postgres flexible-server firewall-rule delete --resource-group "$rg" --name "$server" \
      --rule-name "$RULE" --yes --output none
    printf 'Closed: %s no longer allows rule %s.\n' "$server" "$RULE"
    exit 0
  fi

  ip="$(curl -sf --max-time 10 https://api.ipify.org)"
  az postgres flexible-server firewall-rule create --resource-group "$rg" --name "$server" \
    --rule-name "$RULE" --start-ip-address "$ip" --end-ip-address "$ip" --output none
  cat <<EOF
  Open: $server allows $ip (rule $RULE). Close it with: scripts/db-access.sh $env --revoke

  Connect as the admin group, with an Entra token as the password (it lasts about an hour):
    export PGPASSWORD="\$(az account get-access-token --resource-type oss-rdbms --query accessToken --output tsv)"
    psql "host=$server.postgres.database.azure.com dbname=atlas user=atlas-$env-db-admins sslmode=require"
  EOF
  ```

- [x] **Step 2: Write `docs/runbooks/rollback.md`:**

  ```markdown
  # Roll back a deploy

  When a deploy broke something, redeploy the last good image. Nothing is rebuilt: every image
  pushed since M5 is still in the registry, tagged with its commit SHA.

  1. **Find the last good SHA.** Prod releases are tagged `prod-<date>-<short sha>`:

     gh release list --limit 5
     git rev-parse <short sha> # the full SHA: images are tagged with all 40 characters

  2. **Clear stale approvals.** A run waiting for UAT or prod approval holds that environment's
     deploy lock, and the rollback would queue behind it. Open each waiting run (`gh run list
  --workflow deploy.yml`), then **Review deployments → Reject**.
  3. **Run the rollback:**

     gh workflow run deploy.yml -f sha=<full sha>

     It skips CI and the build, deploys dev, then waits for the UAT and prod approvals as usual.
     Approve both, even for a prod-only problem: the same SHA goes through every stage.

  4. **Check it.** Each stage's smoke tests check the version. By hand:

     curl -s https://<web fqdn>/api/health/live | jq .version

  ## Migrations

  A rollback never undoes a migration. The older image's migration job runs its own, older
  migrations, which are already applied, so nothing changes. That's safe because every migration
  is expand-then-contract (ADR 0006): the previous app version works with the current schema.

  If the migration itself was wrong, fix forward: a new migration in a new pull request.
  ```

  (In the file, the commands inside numbered steps are indented fenced `bash` blocks. They're shown flat here so this plan's own code block stays readable.)

- [x] **Step 3: Write `docs/runbooks/add-environment.md`:**

  ```markdown
  # Add an environment

  For example a `test` stage between dev and UAT. The subscription allows one Container Apps
  environment (ADR 0017), so the new stage's apps run in `cae-atlas` like the others. A stage
  costs about $0.60 a day for its Postgres B1ms.

  1. **`infra/config/environments.json`:** copy the `uat` entry under a new key, and change:
     - `resourceGroup`: `rg-atlas-<env>`
     - `location`: one of `allowedLocations`
     - `postgres.subnet`: for a private stage, an unused /27 inside 10.0.1.0/24
       (`shared.bicep` creates the subnet)
     - the flags: `requiresApproval`, `deleteLock`, `humanDbAccess`, `localhostRedirect`,
       `alerts`, and `logRetentionDays`
  2. **The name in code:** add it to `@allowed` for `environmentName` in `infra/platform.bicep`,
     `migrate.bicep` and `apps.bicep`. Add it to `ATLAS_ENV` (and `CLOUD_ENVS`) in
     `apps/api/src/config.ts`, and to `env` in `apps/web/src/lib/config.ts`.
  3. **`scripts/bootstrap.sh <env>`,** signed in as Owner: identities, roles, app registrations,
     groups, the GitHub environment and its secrets.
  4. **`.github/workflows/deploy.yml`:** add a job like `uat`, with `needs:` set to the stage
     before it. Point the next stage's `needs:` at the new job.
  5. **Pull request, then merge.** The `shared` job adds the Postgres subnet, then the new job
     deploys the stage.
  6. **`scripts/add-redirect-uri.sh <env>`** once, after its first deploy, then sign in.

  `what-if.sh`, `teardown.sh` and the smoke tests read `environments.json`, so they need no change.
  ```

- [x] **Step 4: Write `docs/runbooks/database-access.md`:**

  ```markdown
  # Database access

  | Environment | Who                   | How                                               |
  | ----------- | --------------------- | ------------------------------------------------- |
  | dev         | `atlas-dev-db-admins` | `scripts/db-access.sh dev`, then `psql` (below)   |
  | uat, prod   | nobody                | reviewed migrations, emergencies included (below) |

  ## Dev

  scripts/db-access.sh dev # opens the firewall to your IP and prints the psql command

  # ... psql as atlas-dev-db-admins, with an Entra token as the password ...

  scripts/db-access.sh dev --revoke

  You connect as an Entra admin of the server. Keep it to reading. Data changes ship as
  migrations, so they reach UAT and prod the same way.

  ## UAT and prod

  Their databases have no public endpoint (ADR 0008), so nothing outside the VNet can connect,
  and nobody is in `atlas-uat-db-admins` or `atlas-prod-db-admins`.

  - **A data fix:** a migration in a pull request. It's reviewed, it runs in dev first, then UAT
    and prod after approval, and the PR and the deploy run record every step.
  - **An emergency:** the same path. About 10 minutes for CI and the dev deploy, then the two
    approvals.
  - **Looking into a problem:** start with Application Insights (`appi-atlas-<env>`: requests,
    dependencies with their SQL, exceptions) and the Postgres log in `log-atlas-<env>`
    (`AzureDiagnostics`).
  ```

  (Again, the commands under "Dev" are a fenced `bash` block in the file.)

- [x] **Step 5: Lint.** `npm run lint` (shellcheck and Prettier).

- [x] **Step 6: The user commits.** `git add scripts/db-access.sh docs/runbooks && git commit -m "docs: runbooks and db-access.sh"`

### Task 9: Docs

**Files:** `docs/specs/2026-10-13-atlas-scaffold-design.md`, `docs/adr/0016-…`, `docs/adr/0017-…`, `AGENTS.md`, `README.md`

- [x] **Step 1: Spec §11.1–11.4.** Replace them with the following.

  **§11.1 Telemetry:**
  - **One workspace-based Application Insights per environment,** `appi-atlas-{env}`. It sits in `log-atlas-{env}`, a Log Analytics workspace in the stage's own resource group.
  - **API:** `@azure/monitor-opentelemetry` instruments HTTP and `pg`, and `@opentelemetry/instrumentation-express` adds route names. It's loaded with `node --import` before the app, and stays off without `APPLICATIONINSIGHTS_CONNECTION_STRING` (locally, in CI). Health-probe requests aren't recorded.
  - **Web:** `@microsoft/applicationinsights-web` records page views, errors and fetches, and adds W3C `traceparent` to same-origin calls. Cookies and its CDN config fetch are off.
  - **One trace per page view:** the page view, its API calls and their SQL share a trace ID. Each audit row stores it as `trace_id`; App Insights calls it `OperationId`.
  - **Local auth stays enabled** on App Insights, because the browser SDK can't use Entra auth. The connection string isn't a secret: anyone can read it from `/config.json`.
  - **Logs:**
    - Container Apps logs from every stage stay in `log-atlas-shared` (ADR 0017).
    - Postgres's server log (`PostgreSQLLogs`) goes to `log-atlas-{env}` through a diagnostic setting.

  **§11.2 Alerts** (stages with `alerts` in `environments.json`: prod):
  - **Action group** `ag-atlas-prod`, emailing `ALERT_EMAIL`. `bootstrap.sh prod` sets that to the signed-in account's email.
  - **One standard availability test** of `/api/health/ready` through the public web URL, so one request covers nginx, the API and Postgres:
    - From Japan East, Southeast Asia and East Asia, every 15 minutes, with retries: about $6 a month.
    - The alert fires when 2 or more locations fail.
  - **Log alerts:**
    - API server errors (5xx): more than 5 in 5 minutes
    - any migration job execution with a non-zero exit code (from `log-atlas-shared`)

  **§11.3 Runbooks** (`docs/runbooks/`): `rollback.md`, `add-environment.md` and `database-access.md`, as they were described before, with these changes:
  - dev's `psql` user is `atlas-dev-db-admins`
  - UAT and prod emergencies are reviewed migrations too, because nothing outside the VNet can reach those databases

  **§11.4** table:
  - dev: "`scripts/db-access.sh dev`, then `psql` as `atlas-dev-db-admins` with an Entra token"
  - uat, prod: "nobody: reviewed migrations, emergencies included (`database-access.md`)"

- [x] **Step 2: The rest of the spec.**
  - **§4.1 diagram, last-but-one line:** `telemetry ─► appi-atlas-{env} ─► log-atlas-{env} ◄─ Postgres logs   (container logs: log-atlas-shared)`
  - **§12 cost table:**
    - The row becomes `| Private DNS zones ×2, availability test, alert rules | ~$9 |`.
    - The total becomes `**~$76**`.
  - **§16 API table:** add `OTEL_SERVICE_NAME` (`atlas-api`, the App Insights cloud role name) and `OTEL_RESOURCE_ATTRIBUTES` (`service.version=<git SHA>`).

- [x] **Step 3: ADRs.** Amend the consequence lines; nothing new needs deciding:
  - In 0017: "Per-stage telemetry (Application Insights) comes with M7" becomes "Each stage's Application Insights and Postgres logs go to its own `log-atlas-{env}` (M7)".
  - In 0016: "Application Insights (M7) adds its ingestion origin to `connect-src`" becomes "Application Insights adds its ingestion origin to `connect-src`. nginx derives it from the connection string at start (M7)".

- [x] **Step 4: `AGENTS.md`.**
  - **API layout table:**
    - Add a row: `src/telemetry.ts` | OpenTelemetry → Application Insights. Loaded first with `node --import` (Dockerfile); off without `APPLICATIONINSIGHTS_CONNECTION_STRING`.
    - The `src/logging.ts` row gains "`traceIdOf` (the trace ID for audit rows)".
  - **Web layout table:** the `lib/` row gains `telemetry.ts` (the Application Insights browser SDK).
  - **Azure table:**
    - `platform.bicep` row: "workload identities, Postgres (private in UAT and prod), and the stage's telemetry: `log-atlas-{env}`, `appi-atlas-{env}`".
    - `apps.bicep` row: "… and prod's alerts".
    - `infra/modules/` row: add "prod's alerts".
  - **Human-run scripts:**
    - The bootstrap flags list gains `alerts` ("sets the `ALERT_EMAIL` secret").
    - Add `scripts/db-access.sh dev [--revoke]`: opens dev's Postgres firewall to your IP (`docs/runbooks/database-access.md`).
  - **New subsection, "Logs and telemetry",** under Azure:

    ```markdown
    ### Logs and telemetry

    - **Requests, SQL, page views, exceptions:** `appi-atlas-{env}`, stored in `log-atlas-{env}`
      (`AppRequests`, `AppDependencies`, `AppPageViews`, `AppExceptions`). Locally and in CI
      nothing is sent.
    - **An audit row's `trace_id` is App Insights' `OperationId`:**
      `union AppRequests, AppDependencies, AppPageViews | where OperationId == "<trace_id>"`.
    - **Container logs (pino's JSON lines) and job events:** `log-atlas-shared`
      (`ContainerAppConsoleLogs`, `ContainerAppSystemLogs`), all stages together.
    - **Postgres's server log:** `log-atlas-{env}` (`AzureDiagnostics`).
    - **Runbooks:** `docs/runbooks/`: rollback, adding an environment, database access.
    ```

- [x] **Step 5: `README.md`.** In "Docs", add `- [Runbooks](docs/runbooks/): rollback, adding an environment, database access` after the ADRs line.

- [x] **Step 6: Check.** `npm run format`, then `npm run check`. Expected: green. It needs Docker for the integration tests.

- [x] **Step 7: The user commits.** `git add docs AGENTS.md README.md && git commit -m "docs: observability as built"`

### Task 10: Before the pull request

- [ ] **Step 1: Validation deploys of `platform.bicep`.** Create `log-atlas-{env}` and `appi-atlas-{env}` now, so the PR's what-if for `apps.bicep` can find App Insights. Without this, the check would fail on the not-yet-deployed resource. The deploys only add resources; they change nothing that exists. The user runs, signed in as Owner:

  ```bash
  scratch="$(mktemp -d)"
  for env in dev uat prod; do
    rg="rg-atlas-$env"
    az deployment group show --resource-group "$rg" --name platform --query properties.parameters --output json |
      jq '{contentVersion: "1.0.0.0", parameters: with_entries(.value |= {value: .value})}' > "$scratch/$env.json"
    az deployment group create --resource-group "$rg" --name platform \
      --template-file infra/platform.bicep --parameters "@$scratch/$env.json" --output none
  done
  rm -rf "$scratch"
  ```

  Expected: three clean deploys. `az resource list -g rg-atlas-prod --query "[].type" -o tsv` now includes `microsoft.insights/components` and `Microsoft.OperationalInsights/workspaces`.

- [ ] **Step 2: `ALERT_EMAIL`.** Run `scripts/bootstrap.sh prod`. It's idempotent: everything else is already in place, so it only adds the secret. `gh secret list --env prod` lists `ALERT_EMAIL`.

### Task 11: Pull request and merge

- [ ] **Step 1:** Push, then `gh pr create`, titled `feat: observability (M7)`.
- [ ] **Step 2: Read the what-if summary.** Expected:
  - Each stage: `platform` shows nothing real, because Task 10 already deployed it (what-if may still list a property or two as noise). `apps` changes both apps' env vars.
  - Prod's alerts don't appear yet, because the last deploy's parameters have no `alertEmail`.
  - No email address or GUID appears anywhere.
- [ ] **Step 3:** All 9 required checks green, then merge (squash).
- [ ] **Step 4: Dev deploys automatically.** The smoke tests include the new `/config.json` check.

### Task 12: Verify in dev (success criterion 5)

Only dev has human database access. In UAT and prod, the check is that App Insights receives the API's requests (Task 13, Step 1).

- [ ] **Step 1: Make a trace.** Sign in to dev, add a note, delete it.
- [ ] **Step 2: Find the audit row's trace ID.**

  ```bash
  scripts/db-access.sh dev
  # with the PGPASSWORD and psql line it prints:
  psql "…" -c "SELECT action, request_id, trace_id FROM app.audit_events ORDER BY occurred_at DESC LIMIT 2"
  scripts/db-access.sh dev --revoke
  ```

  Expected: `note.deleted` and `note.created` rows, with a 32-character hex `trace_id`.

  If psql says `permission denied for schema app`, the admin group can't read Atlas's tables. Try `GRANT pg_read_all_data TO "atlas-dev-db-admins";` in the same session and select again. If that's refused too, record it in the execution notes, and add a follow-up: the migration job grants read access to the admin group in `humanDbAccess` stages.

- [ ] **Step 3: Find that trace in App Insights.**

  ```bash
  ws="$(az monitor log-analytics workspace show -g rg-atlas-dev -n log-atlas-dev --query customerId -o tsv)"
  az monitor log-analytics query -w "$ws" -o table --analytics-query \
    "union AppPageViews, AppRequests, AppDependencies | where OperationId == '<trace_id>' | project TimeGenerated, Type, AppRoleName, Name, ResultCode | order by TimeGenerated asc"
  ```

  Expected, all under that one trace ID:
  - the page view (`atlas-web`)
  - the browser's `POST /api/notes` dependency (`atlas-web`)
  - the API request `POST /api/notes` (`atlas-api`)
  - the API's `pg` dependencies (`atlas-api`)

  Then `AppRequests | where Name has "health" | count` should be 0, because probes are filtered. The portal's application map should show `atlas-web → atlas-api → postgres`.

- [ ] **Step 4: Check the migration alert's query** against a real failure, in dev. The alert itself is prod-only.

  ```bash
  image="$(az containerapp job show -g rg-atlas-dev -n caj-atlas-migrate-dev --query 'properties.template.containers[0].image' -o tsv)"
  # An invalid ATLAS_ENV fails config validation: the job exits non-zero, and no migration runs.
  az containerapp job start -g rg-atlas-dev -n caj-atlas-migrate-dev \
    --image "$image" --container-name migrate --env-vars ATLAS_ENV=broken
  ```

  About 5 minutes later, run the alert's query in `log-atlas-shared` with `caj-atlas-migrate-dev`. Expected: at least one row. If the failed execution's events are worded differently, change the query to match them, and note it.

### Task 13: UAT, prod, and the prod alert (success criterion 7)

- [ ] **Step 1: Promote.** Reject any older run still waiting for UAT approval, then approve this run's UAT and prod. Expected:
  - UAT and prod smoke tests are green.
  - The release `prod-<date>-<sha>` exists.
  - `az resource list -g rg-atlas-prod -o table` shows `ag-atlas-prod`, `avail-atlas-prod-health` and the three `alert-atlas-prod-*` rules.
  - In `log-atlas-uat` and `log-atlas-prod`, `AppRequests | where AppRoleName == "atlas-api" | summarize count() by Name, ResultCode` shows the smoke test's `GET /api/notes` 401. The health checks aren't there, because they're filtered.
- [ ] **Step 2: Wait for the test.** About 30 minutes after the deploy, the availability test's results in the portal show green from all three locations.
- [ ] **Step 3: Cause a real outage.** Refuse every caller of prod's web app except one unused address (TEST-NET), so the health check gets 403:

  ```bash
  az containerapp ingress access-restriction set -g rg-atlas-prod -n ca-atlas-web-prod \
    --rule-name alert-drill --ip-address 192.0.2.1/32 --action Allow
  curl -s -o /dev/null -w '%{http_code}\n' https://<prod web fqdn>/   # expect 403
  ```

  Ingress settings belong to the app, not a revision, so no new revision is made. The next deploy would remove the rule anyway, because `apps.bicep` declares none.

- [ ] **Step 4: The alert email arrives,** "Fired: Sev1 … alert-atlas-prod-availability". Expect it about 15–35 minutes after Step 3: one test run per location, three attempts each, then the next 5-minute evaluation.
- [ ] **Step 5: End the outage.**

  ```bash
  az containerapp ingress access-restriction remove -g rg-atlas-prod -n ca-atlas-web-prod --rule-name alert-drill
  curl -s -o /dev/null -w '%{http_code}\n' https://<prod web fqdn>/api/health/ready   # expect 200
  ```

  A "Resolved" email follows once the test passes again.

### Task 14: Record it

- [ ] **Step 1:** Tick the boxes. Add execution notes (timings, surprises, the alert's real detection time, the outcome of the psql permission check) and the deploy run IDs, as in M6. Open a `docs(plan): record how M7 went` PR.
- [ ] **Step 2:** Update memory: M7 done, the new monthly cost, and that `teardown.sh all` is due before mid-November.

## Execution notes

1. **#22's per-environment locks weren't tested by the plan's merge (#23).** #22's own run never waited at UAT, because its dev deploy had failed. `platform.bicep` got `ServerIsBusy`: the dev Postgres server was busy with an operation that isn't in the activity log. It was `Ready` again an hour later, and #23's run deployed dev without trouble. The lock test moves to this PR's merge, with #23's run waiting at UAT.
2. **The plan's integration test command was wrong.** It needs `--config vitest.integration.config.ts`. Fixed in Task 1.
3. **One `@opentelemetry/instrumentation` for everything that matters.** Express, HTTP, pg and Azure Monitor all share 0.221.0. Two nested copies are outside our control:
   - Azure's own `@azure/opentelemetry-instrumentation-azure-sdk` (1.1.0-beta.1) nests 0.211. At worst, that means fewer spans for Azure SDK calls, such as the identity token fetches.
   - `instrumentation-http` pins its own `@opentelemetry/core` 2.10. That's harmless.
4. **Azure Monitor 1.20 samples by rate by default:** up to 5 traces a second, with a budget that starts empty. The first span after startup isn't recorded, so the first check with a fake connection string said `recording: false`; a span 1.5 seconds later was recorded. At Atlas's traffic every trace is kept. Above 5 a second, some audit rows' trace IDs wouldn't be in App Insights. This is now noted in the spec and AGENTS.md.
5. **The API image with telemetry on** served `200` on `/api/health/ready` and `401` on `/api/notes`, sending to a closed port, with no exporter errors in its log.
6. **The E2E telemetry test takes 0.6 seconds, not 15.** The SDK also sends its batch when the page unloads, which it does as sign-in redirects to the mock issuer. All 5 E2E tests passed, with no CSP violations.
7. **The browser SDK is 77 KB gzipped** (the `telemetry` chunk), about the same as Fluent's. Accepted for an internal app; lazy loading would only help locally, where telemetry is off.
8. **The Bicep linter suggested newer GA API versions:** `metricAlerts@2026-01-01` and `scheduledQueryRules@2026-03-01`. Both are used, and every template builds without warnings.
