# 0017. Region `japaneast`, and the student subscription's limits

- **Status:** Accepted
- **Date:** 2026-10-17

## Context

Checked before the first deployment (M5):

- **The Azure for Students offer assigns an "Allowed resource deployment regions" policy:** `malaysiawest`, `japaneast`, `japanwest`, `indonesiacentral` and `indiasouthcentral`. The spec's `southeastasia`, and its fallback `eastasia`, would be denied.
- **Service availability:**
  - `indiasouthcentral` has no Container Apps.
  - The other four offer everything Atlas uses: Container Apps, Postgres Flexible Server, ACR and Log Analytics.
  - Postgres 17 on B1ms is unrestricted for this subscription in `japaneast` and `malaysiawest`.
- **`malaysiawest`,** the nearest region to Thailand (about 30 ms), is under a year old. It already lacks one Azure API (Postgres usages).
- **Quota: one Container Apps environment per region** (`ManagedEnvironmentCount` = 1).

## Decision

- **`shared` and `dev` run in `japaneast`:** a mature region with every API, about 70–90 ms from Thailand.
- **The location is set per environment in `infra/config/environments.json`.**
- **Atlas's own policy allows `japaneast` and `malaysiawest`,** the second as a fallback (`allowedLocations`).

## Consequences

- **Latency doesn't matter for this demo.** A Thai company would pick a Southeast Asia region.
- **UAT and prod (M6) can't share `japaneast` with dev,** because only one Container Apps environment fits per region. They would need other allowed regions (`japanwest`, `malaysiawest`), or one shared environment with per-stage apps. That's a cost-driven deviation a company subscription wouldn't have.
- **A company would also not have an offer-level region policy,** and would choose regions for data residency and latency.
