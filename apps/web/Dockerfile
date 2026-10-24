# syntax=docker/dockerfile:1
# Marketing site (Angular SSR). Build from the repository root:
#   docker build -f apps/web/Dockerfile -t novan-web .
#   docker run -p 4000:4000 -e MARKETING_SITE_URL=... -e CMS_LOGIN_URL=... -e NOVAN_API_URL=... novan-web
# The delivery token is a runtime environment variable only: never a build argument, so no image layer holds it.

ARG NODE_VERSION=24

# --- Build ------------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /workspace

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
# No Nx daemon or cloud in a one-off build.
ENV NX_DAEMON=false NX_NO_CLOUD=true
RUN npx nx build web --configuration=production

# --- Run --------------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS run
ENV NODE_ENV=production PORT=4000
WORKDIR /app

# The server bundle includes its dependencies, so the image needs only the build output.
COPY --from=build --chown=node:node /workspace/dist/apps/web ./

# The official image's unprivileged user.
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["node", "server/server.mjs"]
