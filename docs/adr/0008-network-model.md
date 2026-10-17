# 0008. Network model, and dev's public Postgres endpoint

- **Status:** Accepted
- **Date:** 2026-10-17

## Context

- **Each environment has its own VNet with non-overlapping address spaces** (`10.10/16`, `10.20/16`, `10.30/16`), so the VNets could be peered into a hub later without renumbering. Each VNet has two subnets:
  - `snet-cae` (/24), delegated to Container Apps
  - `snet-psql` (/27), delegated to Postgres
- **The Container Apps environment is VNet-integrated and external.** The web app gets public HTTPS ingress, and the API has internal ingress only.
- **Postgres Flexible Server picks public or private networking when it's created,** and can't switch afterwards.
- **People need to debug dev's data. Nobody should reach prod's data by default** (spec §11.4).

## Decision

- **Dev: a public Postgres endpoint,** with Entra-only authentication and TLS.
  - The firewall allows Azure services, which covers the Container Apps environment's outbound traffic.
  - A developer's IP is added only while it's needed, then removed.
  - The `atlas-dev-db-admins` group includes the developer.
- **UAT and prod: Postgres is VNet-integrated into `snet-psql`, with public access disabled.**
  - A private DNS zone, `atlas-{env}.private.postgres.database.azure.com`, is linked to the VNet, so apps resolve the server to its private address.
  - Only workloads in the VNet can connect: the API and the migration job. The NSG on `snet-psql` allows port 5432 from `snet-cae`.
  - The db-admins group exists but is empty.
- **The API's ingress allows plain HTTP inside the environment** (`allowInsecure`), because nginx proxies `/api/` to `http://ca-atlas-api-{env}`. The ingress itself stays internal.

## Consequences

- **"Allow Azure services" in dev means any Azure resource can reach the endpoint at the network level.** Entra-only authentication with TLS is the control there. That's accepted for dev only.
- **Moving dev to private networking means recreating its server.** `snet-psql` is already reserved for it.
- **Migrations in UAT and prod run inside the VNet,** as a Container Apps job, so they need no network exception.
- **Excluded on cost (ADR 0012):** a hub VNet with firewall egress, private endpoints for the registry (needs ACR Premium), and Front Door with a WAF at the edge.
