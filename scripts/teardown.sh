#!/usr/bin/env bash
# Deletes what bootstrap.sh and the pipeline created, so the credit stops being spent (spec §12).
# Run by a human with the same rights as bootstrap.sh. Asks before deleting anything.
#
#   scripts/teardown.sh <environment>   rg-atlas-<env>, its pipeline identity and role assignments,
#                                       app registrations, db-admins group, GitHub environment
#   scripts/teardown.sh all             every environment, then rg-atlas-shared, rg-atlas-cicd,
#                                       the custom roles, the budget and the GitHub secrets
set -euo pipefail

REPO="${ATLAS_REPO:-Chayud-Ac/atlas}"
CONFIG="$(cd "$(dirname "$0")/.." && pwd)/infra/config/environments.json"

log() { printf '==> %s\n' "$*" >&2; }
cfg() { jq -r "$1" "$CONFIG"; }

usage() {
  printf 'Usage: %s <environment>|all\n' "$0" >&2
  exit 2
}

confirm() {
  local answer
  printf '%s Type "delete" to continue: ' "$1" >&2
  read -r answer
  [[ "$answer" == "delete" ]] || { log "Cancelled."; exit 1; }
}

delete_group() {
  if [[ "$(az group exists --name "$1")" == "true" ]]; then
    log "Deleting resource group $1 (this takes a few minutes)"
    az group delete --name "$1" --yes --output none
  fi
}

delete_app() {
  local id
  id="$(az ad app list --filter "displayName eq '$1'" --query '[0].id' --output tsv)"
  if [[ -n "$id" ]]; then
    log "Deleting app registration $1"
    az ad app delete --id "$id"
  fi
}

delete_entra_group() {
  local id
  id="$(az ad group list --filter "displayName eq '$1'" --query '[0].id' --output tsv)"
  if [[ -n "$id" ]]; then
    log "Deleting group $1"
    az ad group delete --group "$id"
  fi
}

delete_github_environment() {
  if gh api "repos/$REPO/environments/$1" --silent 2>/dev/null; then
    log "Deleting GitHub environment $1"
    gh api --method DELETE "repos/$REPO/environments/$1" --silent
  fi
}

teardown_environment() {
  local env="$1" rg cicd_rg shared_scope principal
  rg="$(cfg ".environments[\"$env\"].resourceGroup // empty")"
  [[ -n "$rg" ]] || usage
  cicd_rg="$(cfg .cicd.resourceGroup)"
  shared_scope="/subscriptions/$(az account show --query id --output tsv)/resourceGroups/$(cfg .shared.resourceGroup)"

  delete_group "$rg"
  # The pipeline identity's roles on rg-atlas-shared would otherwise outlive it.
  principal="$(az identity show --resource-group "$cicd_rg" --name "id-atlas-github-$env" \
    --query principalId --output tsv 2>/dev/null || true)"
  if [[ -n "$principal" ]]; then
    log "Removing id-atlas-github-$env's role assignments, then the identity"
    az role assignment delete --assignee "$principal" --scope "$shared_scope" --output none || true
    az identity delete --resource-group "$cicd_rg" --name "id-atlas-github-$env" --output none
  fi
  delete_app "atlas-$env-web"
  delete_app "atlas-$env-api"
  delete_entra_group "atlas-$env-db-admins"
  delete_github_environment "$env"
}

teardown_all() {
  local subscription name
  subscription="$(az account show --query id --output tsv)"
  for env in $(cfg '.environments | keys[]'); do teardown_environment "$env"; done
  delete_group "$(cfg .shared.resourceGroup)"
  delete_group "$(cfg .cicd.resourceGroup)"
  for name in "Atlas What-If Reader" "Atlas Deployment Runner"; do
    if [[ -n "$(az role definition list --custom-role-only true --name "$name" --query '[0].name' --output tsv)" ]]; then
      log "Deleting custom role $name"
      az role definition delete --name "$name" --output none
    fi
  done
  log "Deleting budget-atlas"
  az rest --method delete --output none \
    --url "https://management.azure.com/subscriptions/$subscription/providers/Microsoft.Consumption/budgets/budget-atlas?api-version=2023-05-01" ||
    true
  delete_github_environment shared
  for name in AZURE_TENANT_ID AZURE_SUBSCRIPTION_ID AZURE_PLAN_CLIENT_ID; do
    gh secret delete "$name" --repo "$REPO" 2>/dev/null && log "Deleted repository secret $name" || true
  done
}

main() {
  [[ $# -eq 1 ]] || usage
  log "Azure subscription: $(az account show --query name --output tsv)"
  case "$1" in
    all)
      confirm "This deletes every Atlas resource, identity, role, app registration and the budget."
      teardown_all
      ;;
    *)
      confirm "This deletes the $1 environment, its identity, app registrations and group."
      teardown_environment "$1"
      ;;
  esac
  log "Done. Deleted app registrations stay in Entra's recycle bin for 30 days."
}

main "$@"
