# syntax=docker/dockerfile:1
# Starter site (Angular SSR). Build from the repository root:
#   docker build -f apps/starter-site/Dockerfile -t novan-starter-site .
#   docker run -p 4000:4000 -e NOVAN_API_URL=... -e NOVAN_DELIVERY_TOKEN=... -e SITE_URL=... novan-starter-site
# Tokens are runtime environment variables only: never build arguments, so no image layer holds them.
#
# For a space that may have opted out of the Novan design system and Bootstrap (docs/clients/new-site.md), let the build
# ask, with the token as a BuildKit secret, which is mounted for that one step and stored in no layer:
#   docker build -f apps/starter-site/Dockerfile --build-arg NOVAN_API_URL=https://api... \
#     --secret id=novan_delivery_token,env=NOVAN_DELIVERY_TOKEN -t acme-site .
# Or decide outright with --build-arg NOVAN_STYLES=omit. With neither, the design system stays in.

ARG NODE_VERSION=24

# --- Build ------------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /workspace

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
# No Nx daemon or cloud in a one-off build.
ENV NX_DAEMON=false NX_NO_CLOUD=true
ARG NOVAN_API_URL
ARG NOVAN_STYLES
RUN --mount=type=secret,id=novan_delivery_token,required=false node apps/starter-site/tools/build-site.mjs

# --- Run --------------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS run
ENV NODE_ENV=production PORT=4000
WORKDIR /app

# The server bundle includes its dependencies, so the image needs only the build output.
COPY --from=build --chown=node:node /workspace/dist/apps/starter-site ./

# The official image's unprivileged user.
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["node", "server/server.mjs"]
