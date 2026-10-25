#!/usr/bin/env bash
# Checks a deployed environment from the outside (spec §14.4). Retries for up to 5 minutes, because
# apps that scaled to zero take a while to start.
#
#   scripts/smoke-test.sh <base url> <environment> <expected version>
set -euo pipefail

[[ $# -eq 3 ]] || { printf 'Usage: %s <base url> <environment> <expected version>\n' "$0" >&2; exit 2; }
base="$1"
env="$2"
version="$3"
deadline=$((SECONDS + 300))

# Usage: check <description> <command...>. Repeats the command until it succeeds or time runs out.
check() {
  local description="$1"
  shift
  until "$@"; do
    if ((SECONDS > deadline)); then
      printf 'FAIL: %s\n' "$description" >&2
      return 1
    fi
    sleep 10
  done
  printf 'ok: %s\n' "$description"
}

status_is() { [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$base$1")" == "$2" ]]; }
field_is() { [[ "$(curl -sf --max-time 30 "$base$1" | jq -r "$2")" == "$3" ]]; }

check "GET / returns 200" status_is / 200
check "/config.json is for $env" field_is /config.json .env "$env"
# Prints only ok/FAIL, so the connection string stays out of the public log.
check "/config.json has an Application Insights connection string" \
  field_is /config.json '.telemetry.connectionString != ""' true
check "the API runs version $version" field_is /api/health/live .version "$version"
check "the API is ready (it can reach Postgres)" status_is /api/health/ready 200
check "GET /api/notes without a token returns 401" status_is /api/notes 401
