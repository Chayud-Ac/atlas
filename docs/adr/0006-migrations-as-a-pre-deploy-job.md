# 0006. Migrations run as a pre-deploy job, and must be expand-then-contract

- **Status:** Accepted
- **Date:** 2026-10-13

## Context

Running migrations when the API starts is simple, but it gives the runtime identity schema-changing rights. It also races when several replicas start together, and it turns a bad migration into a crash loop of the whole API.

## Decision

- Migrations run in a separate entrypoint, `apps/api/src/migrate.ts`. It's built into the same image as the API, so the code and the migrations always match, and in Azure it runs as a Container Apps Job (`caj-atlas-migrate-{env}`) _before_ the new API revision deploys (M5).
- The job takes a Postgres advisory lock, so two concurrent runs serialise. An integration test proves this.
- Because the old API version keeps running while the job migrates, every migration must be **backward compatible: expand, then contract.** Add the new column or table → ship → switch reads and writes → ship → drop the old one in a later release.

## Consequences

- A failed migration stops the deploy before any new code runs, and the previous revision keeps serving.
- Renames and drops take two releases. That's the price of zero-downtime deploys, and it's what large companies do.
- Locally, `npm run db:migrate -w @atlas/api` runs the same code path.
