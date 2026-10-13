# syntax=docker/dockerfile:1
# Novan API and worker (one image, package 20). Build from the repository root:
#   docker build -f apps/api/Dockerfile -t novan-api .
#   docker run -p 3000:3000 --env-file .env novan-api              # HTTP API
#   docker run --env-file .env novan-api node main.js --worker      # background jobs only
# Secrets are runtime environment variables only: never build arguments, so no image layer holds them.

ARG NODE_VERSION=24

# --- Build ------------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /workspace

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
# No Nx daemon or cloud in a one-off build.
ENV NX_DAEMON=false NX_NO_CLOUD=true NODE_ENV=production
# The bundle (workspace libraries included) plus a package.json and lockfile of its runtime dependencies only
# (webpack.config.js: generatePackageJson).
RUN npx nx build api --configuration=production

# --- Runtime dependencies ---------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY --from=build /workspace/dist/apps/api/package.json /workspace/dist/apps/api/package-lock.json ./
# Not `npm ci`: Nx's generated lockfile misses some transitive packages. Direct dependencies are pinned exactly in the
# generated package.json, and the lockfile still fixes the rest it lists.
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# --- Run --------------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS run
ENV NODE_ENV=production PORT=3000 API_PORT=3000 LOG_FORMAT=json
WORKDIR /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/dist/apps/api ./

# The official image's unprivileged user.
USER node
EXPOSE 3000
# The worker serves no HTTP, so its Compose service turns this check off.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${API_PORT}/health" || exit 1

CMD ["node", "--enable-source-maps", "main.js"]
