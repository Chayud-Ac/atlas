#!/usr/bin/env bash
# Adds an environment's deployed web address to atlas-<env>-web's SPA redirect URIs, so Entra ID
# sends users back to it after sign-in (spec §6.3). Run once by a human after the first deploy:
# the pipeline can't change app registrations.
#
#   scripts/add-redirect-uri.sh <environment>
set -euo pipefail

CONFIG="$(cd "$(dirname "$0")/.." && pwd)/infra/config/environments.json"

log() { printf '==> %s\n' "$*" >&2; }

[[ $# -eq 1 ]] || { printf 'Usage: %s <environment>\n' "$0" >&2; exit 2; }
env="$1"
rg="$(jq -r ".environments[\"$env\"].resourceGroup // empty" "$CONFIG")"
[[ -n "$rg" ]] || { printf 'Unknown environment: %s\n' "$env" >&2; exit 2; }

fqdn="$(az containerapp show --resource-group "$rg" --name "ca-atlas-web-$env" \
  --query properties.configuration.ingress.fqdn --output tsv)"
object_id="$(az ad app list --filter "displayName eq 'atlas-$env-web'" --query '[0].id' --output tsv)"
[[ -n "$fqdn" && -n "$object_id" ]] || { printf 'Deploy %s and run bootstrap.sh %s first.\n' "$env" "$env" >&2; exit 1; }

uris="$(az ad app show --id "$object_id" --query spa.redirectUris --output json |
  jq -c --arg uri "https://$fqdn" '(. // []) + [$uri] | unique')"
az rest --method patch --url "https://graph.microsoft.com/v1.0/applications/$object_id" \
  --headers Content-Type=application/json \
  --body "$(jq -n --argjson uris "$uris" '{spa: {redirectUris: $uris}}')" --output none

log "atlas-$env-web now redirects to https://$fqdn"
