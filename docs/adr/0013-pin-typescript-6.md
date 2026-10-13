# 0013. Pin TypeScript to 6.0.x

- **Status:** Accepted
- **Date:** 2026-10-13

## Context

TypeScript 7 (the native Go rewrite) is the latest release, at 7.0.2. Our type-aware lint rules come from typescript-eslint, which uses the TypeScript compiler API. typescript-eslint 8.71.2 declares support for `typescript >=4.8.4 <6.1.0`, so TypeScript 7 would break type-aware linting, one of our quality gates.

## Decision

Use TypeScript `~6.0.3`, which allows patch updates only. Dependabot ignores TypeScript major updates. `tsconfig.base.json` sets every compiler option explicitly, so the eventual upgrade doesn't change behaviour silently.

## Consequences

- We miss TypeScript 7's faster compiles. At this size, the difference is seconds.
- Revisit when typescript-eslint publishes a release that supports TypeScript 7. The upgrade is then one dependency bump plus `npm run check`.
