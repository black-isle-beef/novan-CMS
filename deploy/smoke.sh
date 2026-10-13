#!/usr/bin/env bash
# Post-deploy smoke tests (package 20): the release answers on every public host. Run by the deploy workflow; by hand:
#   deploy/smoke.sh <version> https://api.example.com https://admin.example.com https://www.client.com [...more sites]
# Waits up to SMOKE_TIMEOUT seconds (default 180) for the API to report <version>, then checks each host once.
set -euo pipefail

version="$1" api="$2" admin="$3"
shift 3
timeout="${SMOKE_TIMEOUT:-180}"
failed=0

check() { # <name> <url> <expected text>
  local body
  if body="$(curl -fsS --max-time 15 "$2")" && [[ "$body" == *"$3"* ]]; then
    echo "ok   $1  $2"
  else
    echo "FAIL $1  $2 (expected to contain: $3)"
    failed=1
  fi
}

echo "Waiting for $api/health to report $version..."
deadline=$((SECONDS + timeout))
until curl -fsS --max-time 5 "$api/health" 2>/dev/null | grep -q "\"version\":\"$version\""; do
  if ((SECONDS >= deadline)); then
    echo "FAIL api  $api/health did not report $version within ${timeout}s: $(curl -sS --max-time 5 "$api/health" || true)"
    exit 1
  fi
  sleep 5
done

check api "$api/health" "\"status\":\"ok\""
# Delivery answers (401 without a token is fine: the route and the database are up).
code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$api/v1/delivery/sitemap")"
if [[ "$code" == 401 || "$code" == 200 ]]; then echo "ok   api  $api/v1/delivery/sitemap ($code)"; else echo "FAIL api  $api/v1/delivery/sitemap ($code)"; failed=1; fi
check admin "$admin/" "<nv-root>"
check admin "$admin/config.js" "release: \"$version\""
for site in "$@"; do
  check site "$site/health" "\"status\":\"ok\""
  check site "$site/" "<html"
done

exit "$failed"
