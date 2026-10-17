#!/usr/bin/env bash
# One-time, idempotent setup, run by a human with admin rights.
#
#   scripts/bootstrap.sh repo     GitHub merge settings, security features, main ruleset
#
# Azure targets (shared|dev|uat|prod) are added in milestone M5.
set -euo pipefail

REPO="${ATLAS_REPO:-Chayud-Ac/atlas}"

# Status checks that must pass before a PR can merge into main.
# Names must match the job `name:` exactly. Add to this list as milestones add jobs.
REQUIRED_CHECKS=(
  "check"
  "build-images"
  "dependency-review"
  "pr-title"
  "Analyze (javascript-typescript)"
  "Analyze (actions)"
)

log() { printf '==> %s\n' "$*" >&2; }

usage() {
  printf 'Usage: %s repo\n' "$0" >&2
  exit 2
}

require_repo_admin() {
  local admin
  admin="$(gh api "repos/$REPO" --jq '.permissions.admin')"
  if [[ "$admin" != "true" ]]; then
    printf 'You need admin rights on %s (gh is signed in as %s).\n' "$REPO" "$(gh api user --jq .login)" >&2
    exit 1
  fi
}

# The code_scanning rule compares a PR's CodeQL results with main's. Until main
# has been analyzed once, the rule blocks every PR, including the first one that
# adds CodeQL. So it's only added once main has results: re-run this script
# after the first merge.
main_has_codeql_results() {
  local count
  count="$(gh api "repos/$REPO/code-scanning/analyses?ref=refs/heads/main&tool_name=CodeQL&per_page=1" \
    --jq 'length' 2>/dev/null || echo 0)"
  [[ "$count" -gt 0 ]]
}

# Usage: ruleset_json <include_code_scanning: true|false>
ruleset_json() {
  printf '%s\n' "${REQUIRED_CHECKS[@]}" | jq -R . | jq -s --argjson code_scanning "$1" '{
    name: "main",
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: ([
      { type: "deletion" },
      { type: "non_fast_forward" },
      { type: "required_linear_history" },
      { type: "pull_request", parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: true,
          allowed_merge_methods: ["squash"] } },
      { type: "required_status_checks", parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: map({ context: . }) } }
    ] + (if $code_scanning then [
      { type: "code_scanning", parameters: {
          code_scanning_tools: [
            { tool: "CodeQL", security_alerts_threshold: "high_or_higher", alerts_threshold: "errors" }
          ] } }
    ] else [] end))
  }'
}

bootstrap_repo() {
  require_repo_admin

  log "Merge settings: squash only, PR title as commit message, delete merged branches"
  gh api --method PATCH "repos/$REPO" --silent \
    -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
    -F delete_branch_on_merge=true -F allow_auto_merge=true \
    -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY

  log "Secret scanning + push protection"
  gh api --method PATCH "repos/$REPO" --silent --input - <<'JSON'
{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}
JSON

  log "Dependabot alerts + security updates"
  gh api --method PUT "repos/$REPO/vulnerability-alerts" --silent
  gh api --method PUT "repos/$REPO/automated-security-fixes" --silent

  log "Private vulnerability reporting"
  gh api --method PUT "repos/$REPO/private-vulnerability-reporting" --silent

  local code_scanning=false
  if main_has_codeql_results; then
    code_scanning=true
  else
    log "main has no CodeQL results yet: skipping the code_scanning rule. Re-run after the first merge."
  fi

  log "Ruleset 'main' (required checks: ${#REQUIRED_CHECKS[@]}, code scanning: $code_scanning)"
  local body id
  body="$(ruleset_json "$code_scanning")"
  id="$(gh api "repos/$REPO/rulesets" --jq '.[] | select(.name == "main") | .id')"
  if [[ -n "$id" ]]; then
    gh api --method PUT "repos/$REPO/rulesets/$id" --silent --input - <<<"$body"
  else
    gh api --method POST "repos/$REPO/rulesets" --silent --input - <<<"$body"
  fi

  log "Done: https://github.com/$REPO/settings/rules"
}

main() {
  [[ $# -eq 1 ]] || usage
  case "$1" in
    repo) bootstrap_repo ;;
    *) usage ;;
  esac
}

main "$@"
