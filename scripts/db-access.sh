#!/usr/bin/env bash
# Opens a stage's Postgres firewall to this machine's public IP, for a member of its
# atlas-{env}-db-admins group (spec §11.4: dev only). --revoke closes it again.
#
#   scripts/db-access.sh <env> [--revoke]
set -euo pipefail

CONFIG="$(cd "$(dirname "$0")/.." && pwd)/infra/config/environments.json"
RULE="human-$(whoami | tr -cd 'A-Za-z0-9_-')"

usage() {
  printf 'Usage: %s <env> [--revoke]\n' "$0" >&2
  exit 2
}

[[ $# -eq 1 || ($# -eq 2 && "$2" == "--revoke") ]] || usage
env="$1"
rg="$(jq -r --arg env "$env" '.environments[$env].resourceGroup // empty' "$CONFIG")"
[[ -n "$rg" ]] || usage
if [[ "$(jq -r --arg env "$env" '.environments[$env].humanDbAccess' "$CONFIG")" != "true" ]]; then
  printf '%s has no human database access. See docs/runbooks/database-access.md.\n' "$env" >&2
  exit 1
fi
server="$(az postgres flexible-server list --resource-group "$rg" --query '[0].name' --output tsv)"

if [[ "${2:-}" == "--revoke" ]]; then
  az postgres flexible-server firewall-rule delete --resource-group "$rg" --name "$server" \
    --rule-name "$RULE" --yes --output none
  printf 'Closed: %s no longer allows rule %s.\n' "$server" "$RULE"
  exit 0
fi

ip="$(curl -sf --max-time 10 https://api.ipify.org)"
az postgres flexible-server firewall-rule create --resource-group "$rg" --name "$server" \
  --rule-name "$RULE" --start-ip-address "$ip" --end-ip-address "$ip" --output none
cat <<EOF
Open: $server allows $ip (rule $RULE). Close it with: scripts/db-access.sh $env --revoke

Connect as the admin group, with an Entra token as the password (it lasts about an hour):
  export PGPASSWORD="\$(az account get-access-token --resource-type oss-rdbms --query accessToken --output tsv)"
  psql "host=$server.postgres.database.azure.com dbname=atlas user=atlas-$env-db-admins sslmode=require"
EOF
