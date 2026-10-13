#!/bin/sh
# Writes the admin's runtime settings (src/environments/runtime-config.ts) from the container's environment, then
# starts Caddy. Public values only: the anon key is safe in the browser, the service-role key never comes here.
set -eu

: "${SUPABASE_URL:?SUPABASE_URL is required}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
: "${PUBLIC_API_URL:?PUBLIC_API_URL is required}"

# A JSON string, so a value cannot break out of config.js.
json() { printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"; }

cat > /srv/config.js <<EOF
// Written by the container at start (apps/admin/docker/entrypoint.sh).
globalThis.novanAdminConfig = {
  supabaseUrl: $(json "$SUPABASE_URL"),
  supabaseAnonKey: $(json "$SUPABASE_ANON_KEY"),
  apiUrl: $(json "$PUBLIC_API_URL"),
  sentryDsn: $(json "${SENTRY_DSN_ADMIN:-}"),
  environment: $(json "${SENTRY_ENVIRONMENT:-}"),
  release: $(json "${APP_VERSION:-}"),
};
EOF

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
