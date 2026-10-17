# 0017. One region and one shared Container Apps environment: the student subscription's limits

- **Status:** Accepted
- **Date:** 2026-10-17

## Context

These were checked before the first deployment (M5) and during M6:

- **Regions.** The Azure for Students offer assigns an "Allowed resource deployment regions" policy: `malaysiawest`, `japaneast`, `japanwest`, `indonesiacentral` and `indiasouthcentral`. The spec's `southeastasia`, and its fallback `eastasia`, would be denied.
  - `indiasouthcentral` has no Container Apps. The other four offer everything Atlas uses.
  - `malaysiawest`, the nearest to Thailand, is under a year old and already lacks one Azure API (Postgres usages).
- **One Container Apps environment per subscription.**
  - The per-region usage API reports a limit of 1 per region.
  - The real limit is stricter. In M6, creating a second environment in another region failed with `MaxNumberOfGlobalEnvironmentsInSubExceeded`: "The subscription cannot have more than 1 Container App Environments".
  - Student subscriptions can't request quota increases.

## Decision

- **Everything runs in `japaneast`,** a mature region with every API, about 70–90 ms from Thailand. `malaysiawest` stays in Atlas's allowed-locations policy as a fallback.
- **The one Container Apps environment, `cae-atlas`, is shared by every stage and lives in `rg-atlas-shared`,** with its VNet and log workspace.
  - Each stage runs its own apps and migration job in it: `ca-atlas-{web,api}-{env}`, `caj-atlas-migrate-{env}`.
  - It isn't in a stage's resource group, so tearing down dev can't take UAT and prod with it.
- **Stages stay separate in everything except compute and network.** Each has its own:
  - resource group
  - workload identities
  - Postgres server (UAT and prod in private subnets of the shared VNet, ADR 0008)
  - app registrations
  - GitHub environment, with an approval gate for UAT and prod
  - smoke tests
- **The stage pipelines get one extra custom role on `rg-atlas-shared`, "Atlas Environment Joiner".** It allows exactly three actions:
  - `Microsoft.App/managedEnvironments/join/action`
  - `Microsoft.Network/virtualNetworks/subnets/join/action`
  - `Microsoft.Network/virtualNetworks/join/action`

  So a stage can place its apps, its private Postgres and its DNS zone link in the shared environment and network, but can't change them.

## Consequences

- **Isolation between stages is by identity, not by network.** A UAT app could reach prod's Postgres over the network, but its identity has no role there, so it can't sign in. A company would give prod its own environment, and usually its own subscription (ADR 0012).
- **A change to the shared environment affects every stage at once.** It's deployed by `shared.bicep`, before any stage.
- **App logs from all stages land in one workspace,** `log-atlas-shared`, with one retention period. Per-stage telemetry (Application Insights) comes with M7.
- **Moving to the shared environment meant recreating dev's environment.** Dev was down for about 30 minutes in M6.
- **Latency doesn't matter for this demo.** A Thai company would pick a Southeast Asia region, and a company subscription wouldn't have either limit.
