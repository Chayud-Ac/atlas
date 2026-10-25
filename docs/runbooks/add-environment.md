# Add an environment

For example a `test` stage between dev and UAT. The subscription allows one Container Apps environment (ADR 0017), so the new stage's apps run in `cae-atlas` like the others. A stage costs about $0.60 a day for its Postgres B1ms.

1. **`infra/config/environments.json`:** copy the `uat` entry under a new key, and change:
   - `resourceGroup`: `rg-atlas-<env>`
   - `location`: one of `allowedLocations`
   - `postgres.subnet`: for a private stage, an unused /27 inside 10.0.1.0/24 (`shared.bicep` creates the subnet)
   - the flags: `requiresApproval`, `deleteLock`, `humanDbAccess`, `localhostRedirect`, `alerts`, and `logRetentionDays`
2. **The name in code:** add it to `@allowed` for `environmentName` in `infra/platform.bicep`, `migrate.bicep` and `apps.bicep`. Add it to `ATLAS_ENV` (and `CLOUD_ENVS`) in `apps/api/src/config.ts`, and to `env` in `apps/web/src/lib/config.ts`.
3. **`scripts/bootstrap.sh <env>`,** signed in as Owner: identities, roles, app registrations, groups, the GitHub environment and its secrets.
4. **`.github/workflows/deploy.yml`:** add a job like `uat`, with `needs:` set to the stage before it. Point the next stage's `needs:` at the new job.
5. **Pull request, then merge.** The `shared` job adds the Postgres subnet, then the new job deploys the stage.
6. **`scripts/add-redirect-uri.sh <env>`** once, after its first deploy, then sign in.

`what-if.sh`, `teardown.sh` and the smoke tests read `environments.json`, so they need no change.
