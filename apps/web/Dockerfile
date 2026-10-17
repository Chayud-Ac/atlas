# syntax=docker/dockerfile:1

# The web image: Vite's static build, served by nginx as a non-root user on port 8080. nginx
# also proxies /api/ to the API and serves /config.json from environment variables (ADR 0016).
# Build from the repo root: docker build -f apps/web/Dockerfile .

# ---- Build: install dependencies and bundle the app ----
FROM node:24.21.0-alpine3.24 AS build
WORKDIR /app

COPY --parents package.json package-lock.json apps/*/package.json packages/*/package.json tests/*/package.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @atlas/web

# ---- Runtime: nginx and the built files ----
FROM nginxinc/nginx-unprivileged:1.31.6-alpine3.24
# Only these environment variables are substituted into the templates.
ENV NGINX_ENVSUBST_FILTER="^(ATLAS_ENV|AUTH_[A-Z_]+|API_UPSTREAM)$"
COPY --chmod=755 apps/web/nginx/19-atlas-env.envsh /docker-entrypoint.d/
COPY apps/web/nginx/default.conf.template /etc/nginx/templates/
COPY apps/web/nginx/security-headers.conf.template /etc/nginx/templates/atlas/
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
