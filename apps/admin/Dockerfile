# syntax=docker/dockerfile:1
# Novan admin: the Angular build served by Caddy (package 20). Build from the repository root:
#   docker build -f apps/admin/Dockerfile -t novan-admin .
#   docker run -p 8080:8080 -e SUPABASE_URL=... -e SUPABASE_ANON_KEY=... -e PUBLIC_API_URL=... novan-admin
# One image for every environment: the container writes its settings to config.js at start (docker/entrypoint.sh).

ARG NODE_VERSION=24
ARG CADDY_VERSION=2

# --- Build ------------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /workspace

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
# No Nx daemon or cloud in a one-off build.
ENV NX_DAEMON=false NX_NO_CLOUD=true
RUN npx nx build admin --configuration=production

# --- Run --------------------------------------------------------------------------------------------------
FROM caddy:${CADDY_VERSION}-alpine AS run

# An unprivileged user that owns only what it writes: config.js and Caddy's state.
RUN addgroup -S admin && adduser -S -G admin admin \
  && mkdir -p /data /config && chown admin:admin /data /config
ENV XDG_DATA_HOME=/data XDG_CONFIG_HOME=/config

COPY apps/admin/docker/Caddyfile /etc/caddy/Caddyfile
COPY --chmod=755 apps/admin/docker/entrypoint.sh /usr/local/bin/admin-entrypoint
COPY --from=build --chown=admin:admin /workspace/dist/apps/admin/browser /srv

USER admin
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1

ENTRYPOINT ["admin-entrypoint"]
