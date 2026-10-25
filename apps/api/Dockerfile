# syntax=docker/dockerfile:1

# The API image. By default it runs the API; the migration job runs the same image with
# `node apps/api/dist/migrate.js` (ADR 0006), so code and migrations always ship together.
# Build from the repo root: docker build -f apps/api/Dockerfile .

# ---- Build: install every dependency and compile the TypeScript ----
FROM node:24.22.1-alpine3.24 AS build
WORKDIR /app

# Only the manifests first, so `npm ci` stays cached until a dependency changes. --parents
# keeps each file's folder, and the globs pick up new workspaces without editing this file.
COPY --parents package.json package-lock.json apps/*/package.json packages/*/package.json tests/*/package.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npx tsc --build apps/api

# ---- Runtime: production dependencies and compiled code, run as a non-root user ----
FROM node:24.22.1-alpine3.24
ENV NODE_ENV=production
# Stack traces show TypeScript line numbers, from the .js.map files tsc writes.
ENV NODE_OPTIONS=--enable-source-maps
WORKDIR /app

COPY --parents package.json package-lock.json apps/*/package.json packages/*/package.json tests/*/package.json ./
# The API's production dependencies only. Then remove the package managers: the API never runs
# them, and the packages bundled inside npm are what vulnerability scanners flag.
RUN npm ci --omit=dev --ignore-scripts --workspace @atlas/api \
  && rm -rf /root/.npm /usr/local/lib/node_modules /opt/yarn-* \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg

# The compiled code, without the tests and test helpers that tsc compiled too.
COPY --from=build --exclude=**/*.test.* /app/packages/shared/dist packages/shared/dist
COPY --from=build --exclude=**/*.test.* --exclude=test /app/apps/api/dist apps/api/dist
COPY apps/api/drizzle apps/api/drizzle

USER node
EXPOSE 3000
# Telemetry first (spec §11.1): the loader lets OpenTelemetry patch ES modules, and telemetry.js
# starts it before server.js imports anything. Without APPLICATIONINSIGHTS_CONNECTION_STRING it
# stays off. The migration job runs its own command, without either.
CMD ["node", "--import", "@azure/monitor-opentelemetry/loader", "--import", "./apps/api/dist/telemetry.js", "apps/api/dist/server.js"]
