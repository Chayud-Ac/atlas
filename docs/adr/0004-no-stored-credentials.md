# 0004. No stored credentials: OIDC for the pipeline, managed identities for the apps

- **Status:** Accepted
- **Date:** 2026-10-17

## Context

- **Long-lived credentials leak and need rotating.** That means client secrets, registry passwords and database passwords. The repo is public, and its Actions logs are world-readable.
- **Azure can avoid them entirely.**
  - GitHub Actions can exchange its OIDC token for an Entra token (workload identity federation).
  - Container Apps can use managed identities for the registry and for Postgres.
  - Postgres Flexible Server can accept Entra tokens and turn password authentication off.
- **The pipeline still needs IDs:** tenant, subscription, client and object IDs. They aren't credentials, but the project rule is that they never appear in the repo or its logs.

## Decision

- **GitHub Actions → Azure:** user-assigned managed identities with federated credentials (issuer `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`). There are no client secrets.

  | Identity                 | Federated subject    | Roles                                                                                                                                                        |
  | ------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `id-atlas-github-plan`   | `pull_request`       | `Atlas What-If Reader` (read, validate, what-if) on each Atlas resource group                                                                                |
  | `id-atlas-github-shared` | `environment:shared` | Contributor and AcrPush on `rg-atlas-shared`                                                                                                                 |
  | `id-atlas-github-{env}`  | `environment:{env}`  | Contributor on `rg-atlas-{env}`. On `rg-atlas-shared`: Reader, `Atlas Deployment Runner`, and RBAC Administrator limited by a condition to assigning AcrPull |

- **The pipeline identities live in `rg-atlas-cicd`.** An environment's Contributor role then can't edit its own federated credentials, or delete itself.
- **Apps → Azure:** one user-assigned identity per app (`id-atlas-{web,api,migrator}-{env}`).
  - All three get AcrPull.
  - The migrator is a Postgres Entra admin and owns the schema.
  - The API gets a non-admin Postgres role, created by the migration job, with DML-only grants.
  - Postgres password authentication is **disabled**.
- **Users → app:** Entra ID, with single-tenant app registrations (`atlas-{env}-web`, `atlas-{env}-api`).
- **Only a human, running `scripts/bootstrap.sh`, creates:** app registrations, Entra groups, policies, the budget, and anything in `rg-atlas-cicd`.
- **The IDs are GitHub Actions secrets, not variables.** They aren't credentials. But:
  - GitHub masks secrets everywhere in its logs (as `***`), step headers included.
  - Variable values are printed in plain text.
  - `::add-mask::` applied to a `${{ }}` expression still leaks the value (actions/runner#643).

  This replaces the spec's "variables plus `::add-mask::`". The one value that isn't an ID, `DB_ADMIN_GROUP_NAME`, stays a variable.

## Consequences

- **Nothing to rotate, and nothing to leak.** Deleting an identity revokes its access.
- **Access is tied to this repo and to a GitHub environment,** so environment protection rules (deploy from `main` only, required reviewers) apply to Azure access too.
- **Pull requests from forks and Dependabot get no OIDC token,** so their `what-if` job is skipped.
- **The spec's success criterion "no GitHub secrets, only variables"** becomes: no credentials anywhere, and IDs stored as masked secrets.
- **A company would apply the same model,** usually with one subscription per environment instead of one resource group per environment (ADR 0012).
