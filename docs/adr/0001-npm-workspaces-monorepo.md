# 0001. npm-workspaces monorepo

- **Status:** Accepted
- **Date:** 2026-10-13

## Context

Atlas has a React web app, an Express API, shared validation schemas and, later, a Python AI service. Changes often span the frontend and backend, for example a new field in a schema, the API and a form. AI coding agents work best when the whole system is in one place with uniform commands.

Options considered:

1. npm workspaces: built into npm, no extra tools
2. pnpm + Turborepo: faster, with build caching, but two more tools
3. One repository per app: matches some company setups, but means three pipelines and painful cross-repo changes

## Decision

One repository using npm workspaces. Deployables go in `apps/`, libraries in `packages/` and cross-app tests in `tests/`. Each workspace owns its scripts, and the root fans out with `--workspaces --if-present`.

## Consequences

- One lockfile, one CI pipeline, and atomic cross-cutting changes.
- No build cache. Acceptable at this size, and revisit if CI passes about 10 minutes.
- The Python service will live in `apps/ai` with its own toolchain. npm workspaces ignore it unless it has a `package.json`.
