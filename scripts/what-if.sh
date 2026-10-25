#!/usr/bin/env bash
# Previews what merging a pull request would change in Azure (spec §15, the `what-if` job).
# Each environment's templates are compared using the parameters of its last deployment, so the
# preview shows what the template change itself does. Output is redacted (GUIDs and email
# addresses): this repo is public, and Azure's output is full of IDs.
#
#   scripts/what-if.sh   (az signed in as an identity with "Atlas What-If Reader")
set -euo pipefail

CONFIG="$(cd "$(dirname "$0")/.." && pwd)/infra/config/environments.json"
INFRA="$(dirname "$CONFIG")/.."
GUID='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
EMAIL='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
export AZURE_CORE_NO_COLOR=1
failed=0

redact() { sed -E "s/$GUID/<redacted>/g; s/$EMAIL/<redacted>/g"; }

# Usage: what_if <title> <resource group> <template> [parameters file]
what_if() {
  # ProviderNoRbac: full validation, but checks only read permission. The default also checks the
  # caller could deploy every resource, which the read-only plan identity can't.
  local args=(--resource-group "$2" --template-file "$INFRA/$3" --exclude-change-types NoChange Ignore
    --validation-level ProviderNoRbac)
  if [[ -n "${4:-}" ]]; then args+=(--parameters "@$4"); fi
  printf '### %s\n\n```text\n' "$1"
  if ! az deployment group what-if "${args[@]}" 2>&1 | redact; then failed=1; fi
  printf '```\n\n'
}

# Usage: last_parameters <resource group> <deployment name> <file>. Fails if never deployed.
last_parameters() {
  az deployment group show --resource-group "$1" --name "$2" --query properties.parameters \
    --output json 2>/dev/null |
    jq '{contentVersion: "1.0.0.0", parameters: with_entries(.value |= {value: .value})}' >"$3"
}

report() {
  local params rg
  params="$(mktemp)"
  printf '## What-if\n\n'
  what_if "shared" "$(jq -r .shared.resourceGroup "$CONFIG")" shared.bicep
  for env in $(jq -r '.environments | keys[]' "$CONFIG"); do
    rg="$(jq -r ".environments[\"$env\"].resourceGroup" "$CONFIG")"
    for template in platform migrate apps; do
      if last_parameters "$rg" "$template" "$params"; then
        what_if "$env: $template" "$rg" "$template.bicep" "$params"
      else
        printf '### %s: %s\n\nNot deployed yet, so there is nothing to compare.\n\n' "$env" "$template"
      fi
    done
  done
  rm -f "$params"
  return "$failed"
}

# Piped to tee, report runs in a subshell, so its return status carries the result out (a
# variable set there is lost). With pipefail and set -e, a failed preview fails the script.
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  report | tee -a "$GITHUB_STEP_SUMMARY"
else
  report
fi
