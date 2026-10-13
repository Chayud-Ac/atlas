# 0002. Trunk-based development, build once and promote

- **Status:** Accepted
- **Date:** 2026-10-13

## Context

Companies use either branch-per-environment (`develop` → dev, `release` → uat, `main` → prod) or trunk-based development with artifact promotion. Branch-per-environment rebuilds the code for each environment, so prod runs a binary that was never tested, and the branches drift apart.

## Decision

- Trunk-based. `main` is the only long-lived branch, and every change arrives by squash-merged pull request.
- Each merge builds **one** image per app, tagged with the git commit SHA.
- That same image is deployed to dev automatically, then promoted to UAT and prod behind GitHub environment approvals.
- Environments are deployment targets, not branches.

## Consequences

- What runs in prod is byte-for-byte what was tested in dev and UAT.
- Rollback means redeploying an older SHA. Nothing is rebuilt.
- Frontend configuration must be read at runtime (`/config.json`), not baked in at build time (ADR 0007).
- Database migrations must be backward compatible (expand, then contract), because two app versions overlap during a rollout.
- The `main` ruleset enforces squash merges, linear history and green checks.
