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

- **One region per environment,** because only one Container Apps environment fits per region:

  | Environment         | Region         | Why                                                                      |
  | ------------------- | -------------- | ------------------------------------------------------------------------ |
  | `shared` (registry) | `japaneast`    | Next to dev, where most deploys go                                       |
  | `dev`               | `japaneast`    | A mature region with every API, about 70–90 ms from Thailand             |
  | `uat`               | `malaysiawest` | The newest region gets the less critical environment first               |
  | `prod`              | `japanwest`    | A mature region; prod doesn't run in a region that is still missing APIs |

- **The locations live in `infra/config/environments.json`.** Atlas's own policy allows exactly these three regions (`allowedLocations`).

## Consequences

- **Promotion crosses regions.** UAT and prod pull images from the registry in `japaneast`; the cross-region pull is small and infrequent.
- **Latency doesn't matter for this demo.** A Thai company would pick Southeast Asia regions.
- **This is a cost-driven deviation a company subscription wouldn't have.** A company would keep its environments in its chosen regions, often one subscription per environment (ADR 0012), with no offer-level region policy, and choose regions for data residency and latency.
