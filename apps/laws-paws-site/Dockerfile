# syntax=docker/dockerfile:1
# Law's Paws site (Angular SSR), the pilot client (docs/build/15-pilot-launch.md). Build from the repository root:
#   docker build -f apps/laws-paws-site/Dockerfile -t novan-laws-paws-site .
#   docker run -p 4000:4000 -e NOVAN_API_URL=... -e NOVAN_DELIVERY_TOKEN=... -e SITE_URL=... novan-laws-paws-site
# Tokens are runtime environment variables only: never build arguments, so no image layer holds them.

ARG NODE_VERSION=24

# --- Build ------------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /workspace

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
# No Nx daemon or cloud in a one-off build.
ENV NX_DAEMON=false NX_NO_CLOUD=true
RUN npx nx build laws-paws-site --configuration=production

# --- Run --------------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS run
ENV NODE_ENV=production PORT=4000
WORKDIR /app

# The server bundle includes its dependencies, so the image needs only the build output.
COPY --from=build --chown=node:node /workspace/dist/apps/laws-paws-site ./

# The official image's unprivileged user.
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["node", "server/server.mjs"]
