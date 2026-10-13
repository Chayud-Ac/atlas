# 0011. Ruleset for a solo developer

- **Status:** Accepted
- **Date:** 2026-10-13

## Context

GitHub doesn't let authors approve their own pull requests. This repo has one developer, so any rule that requires an approval would block every merge.

## Decision

The `main` ruleset requires:

- pull requests (squash only)
- linear history
- resolved conversations
- strict, up-to-date status checks
- CodeQL results with no high-or-worse security alerts

It requires **0 approvals**, and there are **no bypass actors**, not even the admin.

## Consequences

The automated gates are fully enforced, but a second human never reviews the code. A team would change this to:

- `required_approving_review_count: 1` (or 2 for prod-critical paths)
- `require_code_owner_review: true`, with `CODEOWNERS` split by path
- `require_last_push_approval: true`
- required reviewers on the `uat` and `prod` environments drawn from the team, not the author
