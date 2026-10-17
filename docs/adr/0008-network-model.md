# 0008. Network model, and dev's public Postgres endpoint

- **Status:** Accepted
- **Date:** 2026-10-17

## Context

- **The subscription allows one Container Apps environment** (ADR 0017), so one VNet, `vnet-atlas-shared` (`10.0.0.0/16`) in `rg-atlas-shared`, serves every stage. Its subnets:
  - `snet-cae` (`10.0.0.0/24`), delegated to Container Apps: the shared environment
  - `snet-psql-uat` (`10.0.1.0/27`) and `snet-psql-prod` (`10.0.1.32/27`), delegated to Postgres. They're generated from `environments.json`: one for each stage whose Postgres isn't public.
- **The environment is VNet-integrated and external.** Web apps get public HTTPS ingress, and APIs get internal ingress only.
- **Postgres Flexible Server picks public or private networking when it's created,** and can't switch afterwards. A private server must be in the same region as its VNet.
- **People need to debug dev's data. Nobody should reach prod's data by default** (spec §11.4).

## Decision

- **Dev: a public Postgres endpoint,** with Entra-only authentication and TLS.
  - The firewall allows Azure services, which covers the environment's outbound traffic.
  - A developer's IP is added only while it's needed, then removed.
  - The `atlas-dev-db-admins` group includes the developer.
- **UAT and prod: Postgres is VNet-integrated into its stage's subnet of the shared VNet, with public access disabled.**
  - A private DNS zone per stage, `atlas-{env}.private.postgres.database.azure.com`, lives in the stage's resource group and is linked to the shared VNet, so apps resolve the server to its private address.
  - The NSG on the Postgres subnets allows port 5432 from `snet-cae` only.
  - The db-admins group exists but is empty.
- **The API's ingress allows plain HTTP inside the environment** (`allowInsecure`), because nginx proxies `/api/` to `http://ca-atlas-api-{env}`. The ingress itself stays internal.

## Consequences

- **"Allow Azure services" in dev means any Azure resource can reach the endpoint at the network level.** Entra-only authentication with TLS is the control there. That's accepted for dev only.
- **Every stage's apps share `snet-cae`,** so the NSG can't tell a UAT app from a prod app. Stages are kept apart by identity: each API's identity has a Postgres role only in its own stage's server (ADR 0017).
- **Migrations in UAT and prod run inside the VNet,** as Container Apps jobs, so they need no network exception.
- **Moving dev to private networking means recreating its server,** in a new `snet-psql-dev`.
- **Excluded on cost (ADR 0012):** a hub VNet with firewall egress, private endpoints for the registry (needs ACR Premium), and Front Door with a WAF at the edge.
