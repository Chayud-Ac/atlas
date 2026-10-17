#!/usr/bin/env bash
# One-time, idempotent setup, run by a human with admin rights (GitHub repo admin, Azure
# subscription Owner). Every step is safe to re-run.
#
#   scripts/bootstrap.sh repo     GitHub merge settings, security features, main ruleset
#   scripts/bootstrap.sh shared   Azure: resource providers, rg-atlas-cicd and rg-atlas-shared,
#                                 custom roles, the plan and shared pipeline identities, policies,
#                                 budget. GitHub: repository secrets, the `shared` environment
#   scripts/bootstrap.sh dev      Azure: rg-atlas-dev, its pipeline identity and roles, the app
#                                 registrations, the db-admins group, policies. GitHub: the `dev`
#                                 environment and its secrets
#
# Run `shared` before any environment. IDs are never printed: they go straight into GitHub
# secrets, because they must not appear in this public repo or its logs (spec §6.2, ADR 0004).
set -euo pipefail

REPO="${ATLAS_REPO:-Chayud-Ac/atlas}"
CONFIG="$(cd "$(dirname "$0")/.." && pwd)/infra/config/environments.json"

# Status checks that must pass before a PR can merge into main.
# Names must match the job `name:` exactly. Add to this list as milestones add jobs.
REQUIRED_CHECKS=(
  "check"
  "build-images"
  "e2e"
  "bicep"
  "what-if"
  "dependency-review"
  "pr-title"
  "Analyze (javascript-typescript)"
  "Analyze (actions)"
)

log() { printf '==> %s\n' "$*" >&2; }

usage() {
  printf 'Usage: %s repo|shared|<environment>\n' "$0" >&2
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

# ---- Azure, Entra ID and GitHub environments (spec §6) ----------------------------------------

GITHUB_OIDC_ISSUER="https://token.actions.githubusercontent.com"
ACR_PULL_ROLE_ID="7f951dda-4ed3-4680-a7ca-43fe172d538d"
# Lets an environment's pipeline identity assign and remove AcrPull on rg-atlas-shared, and no
# other role (spec §6.1). Without the condition, the role could grant itself anything there.
ACR_PULL_ONLY="((!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'})) OR (@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$ACR_PULL_ROLE_ID})) AND ((!(ActionMatches{'Microsoft.Authorization/roleAssignments/delete'})) OR (@Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$ACR_PULL_ROLE_ID}))"
PROVIDERS=(Microsoft.App Microsoft.ContainerRegistry Microsoft.DBforPostgreSQL
  Microsoft.OperationalInsights Microsoft.Insights Microsoft.ManagedIdentity Microsoft.Network
  Microsoft.PolicyInsights)

cfg() { jq -r "$1" "$CONFIG"; }

require_azure() {
  local name
  name="$(az account show --query name --output tsv)" || {
    printf 'Sign in first: az login\n' >&2
    exit 1
  }
  log "Azure subscription: $name"
  SUBSCRIPTION_ID="$(az account show --query id --output tsv)"
  TENANT_ID="$(az account show --query tenantId --output tsv)"
  CICD_RG="$(cfg .cicd.resourceGroup)"
  SHARED_RG="$(cfg .shared.resourceGroup)"
}

# Re-runs a command while Entra replicates something just created (identities, roles).
retry() {
  local attempt
  for attempt in 1 2 3 4 5 6; do
    if "$@"; then return 0; fi
    log "  not ready yet, retrying in 10s ($attempt/6)"
    sleep 10
  done
  return 1
}

rg_scope() { printf '/subscriptions/%s/resourceGroups/%s' "$SUBSCRIPTION_ID" "$1"; }

# Usage: ensure_resource_group <name> <location> <env tag>
ensure_resource_group() {
  local tags
  read -r -a tags <<<"$(cfg '.tags | to_entries | map("\(.key)=\(.value)") | join(" ")') env=$3"
  az group create --name "$1" --location "$2" --tags "${tags[@]}" --output none
}

# Usage: ensure_identity <name>. Pipeline identities live in rg-atlas-cicd (spec §4.3).
ensure_identity() {
  local tags
  read -r -a tags <<<"$(cfg '.tags | to_entries | map("\(.key)=\(.value)") | join(" ")') env=cicd"
  az identity create --resource-group "$CICD_RG" --name "$1" --location "$(cfg .cicd.location)" \
    --tags "${tags[@]}" --output none
}

identity_field() {
  az identity show --resource-group "$CICD_RG" --name "$1" --query "$2" --output tsv
}

# The start of the `sub` claim in this repo's GitHub OIDC tokens. Repos created recently use
# immutable subjects, `repo:<owner>@<owner id>/<repo>@<repo id>`, so a renamed or re-created repo
# can't inherit the trust; older ones use `repo:<owner>/<repo>`. GitHub reports which.
subject_prefix() {
  gh api "repos/$REPO/actions/oidc/customization/sub" --jq ".sub_claim_prefix // \"repo:$REPO\""
}

# Usage: ensure_federated_credential <identity> <credential name> <subject>
ensure_federated_credential() {
  az identity federated-credential create --resource-group "$CICD_RG" --identity-name "$1" \
    --name "$2" --issuer "$GITHUB_OIDC_ISSUER" --subject "$3" \
    --audiences api://AzureADTokenExchange --output none
}

# Usage: ensure_role <principal id> <role> <scope> [condition]
ensure_role() {
  local count args
  # A role created moments ago may not be visible yet; treat that as "not assigned".
  count="$(az role assignment list --scope "$3" --role "$2" \
    --query "length([?principalId=='$1'])" --output tsv 2>/dev/null || echo 0)"
  [[ "$count" -gt 0 ]] && return 0
  args=(--assignee-object-id "$1" --assignee-principal-type ServicePrincipal
    --role "$2" --scope "$3" --output none)
  if [[ -n "${4:-}" ]]; then args+=(--condition "$4" --condition-version 2.0); fi
  retry az role assignment create "${args[@]}"
}

# Usage: ensure_custom_role <name> <description> <actions as a JSON array>
ensure_custom_role() {
  local definition id
  definition="$(jq -n --arg name "$1" --arg description "$2" --argjson actions "$3" \
    --arg scope "/subscriptions/$SUBSCRIPTION_ID" \
    '{Name: $name, IsCustom: true, Description: $description, Actions: $actions,
      NotActions: [], AssignableScopes: [$scope]}')"
  id="$(az role definition list --custom-role-only true --name "$1" --query '[0].name' --output tsv)"
  if [[ -n "$id" ]]; then
    az role definition update --role-definition "$(jq --arg id "$id" '. + {Id: $id}' <<<"$definition")" \
      --output none
  else
    az role definition create --role-definition "$definition" --output none
  fi
}

# Usage: ensure_policies <resource group>. Allowed locations and a required env tag (spec §12).
ensure_policies() {
  local scope
  scope="$(rg_scope "$1")"
  az policy assignment create --name atlas-allowed-locations --display-name "Atlas: allowed locations" \
    --policy e56962a6-4747-49cd-b67b-bf8b01975c4c --scope "$scope" \
    --params "$(jq -c '{listOfAllowedLocations: {value: .allowedLocations}}' "$CONFIG")" --output none
  az policy assignment create --name atlas-require-env-tag --display-name "Atlas: require the env tag" \
    --policy 871b6d14-10aa-478d-b590-94f262ecfa99 --scope "$scope" \
    --params '{"tagName": {"value": "env"}}' --output none
}

# $100 a month, emailing the signed-in user at 50/80/100% actual and 100% forecast (spec §12).
ensure_budget() {
  local url email body
  url="https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/providers/Microsoft.Consumption/budgets/budget-atlas?api-version=2023-05-01"
  if az rest --method get --url "$url" --output none 2>/dev/null; then return 0; fi
  email="$(az ad signed-in-user show --query mail --output tsv)"
  if [[ -z "$email" ]]; then email="$(az ad signed-in-user show --query userPrincipalName --output tsv)"; fi
  body="$(jq -n --arg email "$email" --arg start "$(date -u +%Y-%m-01)T00:00:00Z" '
    def alert($threshold; $type): {enabled: true, operator: "GreaterThanOrEqualTo",
      threshold: $threshold, thresholdType: $type, contactEmails: [$email]};
    {properties: {category: "Cost", amount: 100, timeGrain: "Monthly",
      timePeriod: {startDate: $start},
      notifications: {actual50: alert(50; "Actual"), actual80: alert(80; "Actual"),
        actual100: alert(100; "Actual"), forecast100: alert(100; "Forecasted")}}}')"
  if ! az rest --method put --url "$url" --body "$body" --output none; then
    log "WARNING: couldn't create budget-atlas (the offer may not support budgets). Continuing."
  fi
}

# Usage: ensure_app <display name>. Prints the app (client) id. Single-tenant, with a service principal.
ensure_app() {
  local app_id
  app_id="$(az ad app list --filter "displayName eq '$1'" --query '[0].appId' --output tsv)"
  if [[ -z "$app_id" ]]; then
    app_id="$(az ad app create --display-name "$1" --sign-in-audience AzureADMyOrg \
      --query appId --output tsv)"
  fi
  if [[ -z "$(az ad sp list --filter "appId eq '$app_id'" --query '[0].id' --output tsv)" ]]; then
    retry az ad sp create --id "$app_id" --output none
  fi
  printf '%s' "$app_id"
}

graph_patch_app() {
  az rest --method patch --url "https://graph.microsoft.com/v1.0/applications/$1" \
    --headers Content-Type=application/json --body "$2" --output none
}

# A SPA (PKCE, no secret). Keeps redirect URIs added by add-redirect-uri.sh; adds the Vite dev server.
configure_web_app() {
  local object_id uris
  object_id="$(az ad app show --id "$1" --query id --output tsv)"
  uris="$(az ad app show --id "$1" --query spa.redirectUris --output json |
    jq -c '(. // []) + ["http://localhost:5173"] | unique')"
  graph_patch_app "$object_id" "$(jq -n --argjson uris "$uris" '{spa: {redirectUris: $uris}}')"
}

# Usage: configure_api_app <api app id> <web app id>. The access_as_user scope, v2 tokens, and the
# web app pre-authorized, so no consent prompt can be blocked by tenant policy (spec §6.3).
configure_api_app() {
  local object_id scope_id
  object_id="$(az ad app show --id "$1" --query id --output tsv)"
  scope_id="$(az ad app show --id "$1" \
    --query "api.oauth2PermissionScopes[?value=='access_as_user'].id | [0]" --output tsv)"
  if [[ -z "$scope_id" ]]; then scope_id="$(uuidgen | tr '[:upper:]' '[:lower:]')"; fi
  graph_patch_app "$object_id" "$(jq -n --arg app "$1" --arg scope "$scope_id" '{
    identifierUris: ["api://\($app)"],
    api: {requestedAccessTokenVersion: 2, oauth2PermissionScopes: [{
      id: $scope, value: "access_as_user", type: "User", isEnabled: true,
      adminConsentDisplayName: "Access Atlas as the signed-in user",
      adminConsentDescription: "Lets the Atlas web app call the Atlas API for the signed-in user.",
      userConsentDisplayName: "Access Atlas as you",
      userConsentDescription: "Lets the Atlas web app call the Atlas API for you."}]}}')"
  # A separate call: the scope must exist before an app can be pre-authorized for it.
  graph_patch_app "$object_id" "$(jq -n --arg web "$2" --arg scope "$scope_id" \
    '{api: {preAuthorizedApplications: [{appId: $web, delegatedPermissionIds: [$scope]}]}}')"
}

# Usage: ensure_db_admin_group <name>. Prints its object id; the signed-in user is a member (dev).
ensure_db_admin_group() {
  local id me
  id="$(az ad group list --filter "displayName eq '$1'" --query '[0].id' --output tsv)"
  if [[ -z "$id" ]]; then
    id="$(az ad group create --display-name "$1" --mail-nickname "$1" \
      --description "Postgres Entra admins for Atlas ($1)" --query id --output tsv)"
  fi
  me="$(az ad signed-in-user show --query id --output tsv)"
  if [[ "$(az ad group member check --group "$id" --member-id "$me" --query value --output tsv)" != "true" ]]; then
    retry az ad group member add --group "$id" --member-id "$me" --output none
  fi
  printf '%s' "$id"
}

# Usage: ensure_github_environment <name>. Deployable from main only.
ensure_github_environment() {
  gh api --method PUT "repos/$REPO/environments/$1" --silent --input - <<'JSON'
{"deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
JSON
  if ! gh api "repos/$REPO/environments/$1/deployment-branch-policies" \
    --jq '.branch_policies[].name' | grep -qx main; then
    gh api --method POST "repos/$REPO/environments/$1/deployment-branch-policies" \
      -f name=main -f type=branch --silent
  fi
}

# Usage: set_secret <name> <value> [environment]. For IDs: they aren't credentials, but GitHub
# masks secrets everywhere in its logs, including step headers, and variables it doesn't (ADR 0004).
set_secret() {
  if [[ -n "${3:-}" ]]; then
    printf '%s' "$2" | gh secret set "$1" --repo "$REPO" --env "$3" >/dev/null
    log "  secret $1 (environment $3)"
  else
    printf '%s' "$2" | gh secret set "$1" --repo "$REPO" >/dev/null
    log "  secret $1 (repository)"
  fi
}

# Usage: set_variable <name> <value> <environment>. For values that aren't IDs.
set_variable() {
  gh variable set "$1" --repo "$REPO" --env "$3" --body "$2" >/dev/null
  log "  variable $1 (environment $3)"
}

bootstrap_shared() {
  require_azure
  require_repo_admin
  local location plan shared
  location="$(cfg .shared.location)"

  log "Resource providers"
  for provider in "${PROVIDERS[@]}"; do az provider register --namespace "$provider" --output none; done

  log "Resource groups: $CICD_RG, $SHARED_RG"
  ensure_resource_group "$CICD_RG" "$(cfg .cicd.location)" cicd
  ensure_resource_group "$SHARED_RG" "$location" shared

  log "Custom roles"
  ensure_custom_role "Atlas What-If Reader" \
    "Read Atlas resources and run deployment what-if, for pull-request previews." \
    '["*/read", "Microsoft.Resources/deployments/validate/action", "Microsoft.Resources/deployments/whatIf/action"]'
  ensure_custom_role "Atlas Deployment Runner" \
    "Run deployments in a resource group. Grants nothing the caller can't already do." \
    '["Microsoft.Resources/deployments/*"]'

  log "Pipeline identities: id-atlas-github-plan, id-atlas-github-shared"
  ensure_identity id-atlas-github-plan
  ensure_federated_credential id-atlas-github-plan github-pull-request "$(subject_prefix):pull_request"
  ensure_identity id-atlas-github-shared
  ensure_federated_credential id-atlas-github-shared github-env-shared "$(subject_prefix):environment:shared"
  plan="$(identity_field id-atlas-github-plan principalId)"
  shared="$(identity_field id-atlas-github-shared principalId)"

  log "Role assignments"
  ensure_role "$plan" "Atlas What-If Reader" "$(rg_scope "$SHARED_RG")"
  ensure_role "$shared" Contributor "$(rg_scope "$SHARED_RG")"
  ensure_role "$shared" AcrPush "$(rg_scope "$SHARED_RG")"

  log "Policies on $CICD_RG and $SHARED_RG"
  ensure_policies "$CICD_RG"
  ensure_policies "$SHARED_RG"

  log "Budget"
  ensure_budget

  log "GitHub: repository secrets and the 'shared' environment"
  set_secret AZURE_TENANT_ID "$TENANT_ID"
  set_secret AZURE_SUBSCRIPTION_ID "$SUBSCRIPTION_ID"
  set_secret AZURE_PLAN_CLIENT_ID "$(identity_field id-atlas-github-plan clientId)"
  ensure_github_environment shared
  set_secret AZURE_CLIENT_ID "$(identity_field id-atlas-github-shared clientId)" shared

  log "Done: shared"
}

# Usage: bootstrap_environment <name>, a key of environments.json.
bootstrap_environment() {
  local env="$1" rg pipeline plan web api group_name group
  require_azure
  require_repo_admin
  rg="$(cfg ".environments[\"$env\"].resourceGroup // empty")"
  [[ -n "$rg" ]] || usage

  log "Resource group: $rg"
  ensure_resource_group "$rg" "$(cfg ".environments[\"$env\"].location")" "$env"

  log "Pipeline identity: id-atlas-github-$env"
  ensure_identity "id-atlas-github-$env"
  ensure_federated_credential "id-atlas-github-$env" "github-env-$env" "$(subject_prefix):environment:$env"
  pipeline="$(identity_field "id-atlas-github-$env" principalId)"
  plan="$(identity_field id-atlas-github-plan principalId)"

  log "Role assignments"
  ensure_role "$pipeline" Contributor "$(rg_scope "$rg")"
  ensure_role "$pipeline" Reader "$(rg_scope "$SHARED_RG")"
  ensure_role "$pipeline" "Atlas Deployment Runner" "$(rg_scope "$SHARED_RG")"
  ensure_role "$pipeline" "Role Based Access Control Administrator" "$(rg_scope "$SHARED_RG")" "$ACR_PULL_ONLY"
  ensure_role "$plan" "Atlas What-If Reader" "$(rg_scope "$rg")"

  log "Entra ID: atlas-$env-web, atlas-$env-api, atlas-$env-db-admins"
  web="$(ensure_app "atlas-$env-web")"
  api="$(ensure_app "atlas-$env-api")"
  configure_web_app "$web"
  configure_api_app "$api" "$web"
  group_name="atlas-$env-db-admins"
  group="$(ensure_db_admin_group "$group_name")"

  log "Policies on $rg"
  ensure_policies "$rg"

  log "GitHub: the '$env' environment"
  ensure_github_environment "$env"
  set_secret AZURE_CLIENT_ID "$(identity_field "id-atlas-github-$env" clientId)" "$env"
  set_secret ENTRA_TENANT_ID "$TENANT_ID" "$env"
  set_secret ENTRA_WEB_CLIENT_ID "$web" "$env"
  set_secret ENTRA_API_CLIENT_ID "$api" "$env"
  set_secret DB_ADMIN_GROUP_OBJECT_ID "$group" "$env"
  set_variable DB_ADMIN_GROUP_NAME "$group_name" "$env"

  log "Done: $env. After its first deploy, run scripts/add-redirect-uri.sh $env"
}

main() {
  [[ $# -eq 1 ]] || usage
  case "$1" in
    repo) bootstrap_repo ;;
    shared) bootstrap_shared ;;
    *) bootstrap_environment "$1" ;;
  esac
}

main "$@"
