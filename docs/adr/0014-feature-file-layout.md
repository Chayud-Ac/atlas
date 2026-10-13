# 0014. File layout: features as routes, service and repository, named `<feature>.<role>.ts`

- **Status:** Accepted
- **Date:** 2026-10-13

## Context

The first version of the API had 35 production files for about 1,200 lines: an average of 33 lines per file, with 15 files under 20 lines (one held a single 4-line class). Each repository interface and its only implementation lived in separate files, and so did an error type, the function that maps it to a response and the middleware that sends it. They always changed together, but a reader had to open three files to follow one idea. File names also mixed styles (`me-routes.ts` was named after an endpoint, `user.ts` was singular next to `pg-users-repository.ts`).

Guidance we followed:

- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices): structure by business component, each with an API layer, domain logic and data access.
- The colocation principle (Kent C. Dodds): "things that change together should be located as close to each other as reasonable".

## Decision

- **A feature is three files** in `src/<feature>/`:
  - `<feature>.routes.ts`: the Express router, including the response mapping
  - `<feature>.service.ts`: business rules, when there are any
  - `<feature>.repository.ts`: record types, the interface and the Postgres implementation. In-memory doubles live in `src/test/`.
- **Names are `<feature>.<role>.ts`** with plural feature names. Cross-cutting code (`auth/`, `db/`, `errors.ts`, `logging.ts`) uses descriptive kebab-case.
- **Split a file only when it passes ~200 lines or has two unrelated reasons to change.** A single small type, class or function doesn't get its own file.
- The current-user endpoint is `GET /api/users/me`, so `users.routes.ts` owns every `/users` endpoint.

## Consequences

- 35 → 18 production files and 19 → 12 test files, with no behaviour change: the same 117 tests pass.
- Files sort by feature in an editor, and roles are visible at a glance.
- Coverage globs target roles (`**/*.repository.ts`, `src/db/**`) instead of name prefixes.
- A repository file imports Drizzle even when only its types are needed. Type-only imports are erased at build time, so this costs nothing at runtime.
