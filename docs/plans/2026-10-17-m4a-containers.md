# M4a: Containers Implementation Plan

> **How this plan is executed:** the user types every file and runs every command. Claude hands out one task at a time, explains each new part, answers questions, and reviews what was typed (`git diff`) before each commit. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the API and the web app as production container images, run the whole app from those images with `docker compose --profile full`, and have CI build and scan both images on every pull request.

**Architecture:**

- **One API image, two commands.** By default it runs the API (`node apps/api/dist/server.js`). The migration job runs the same image with `node apps/api/dist/migrate.js` (ADR 0006).
- **The web image is nginx** (`nginxinc/nginx-unprivileged`: non-root, port 8080) serving Vite's build. nginx also:
  - proxies `/api/` to the API, so the browser stays on one origin and the API needs no CORS
  - sets the security headers and the CSP
  - serves `/config.json` from environment variables, so one image runs in every environment (ADR 0002, ADR 0007)
- **The compose `full` profile** adds `migrate`, `api` and `web`, built from the same Dockerfiles, next to the existing Postgres and mock OIDC issuer. It uses `ATLAS_ENV=ci`, so the API trusts the mock.
- **CI's `build-images` job** builds both images and fails on CRITICAL or HIGH vulnerabilities that have a fix (Trivy).

**Tech stack:**

| Area             | Choice                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| Base images      | `node:24.21.0-alpine3.24` (build + API runtime), `nginxinc/nginx-unprivileged:1.30.6-alpine3.24` |
| Dockerfile       | BuildKit syntax 1 (`COPY --parents`, `COPY --exclude`, `COPY --chmod`)                           |
| CI build         | `docker/setup-buildx-action` v4.4.1, `docker/build-push-action` v7.4.0, GitHub Actions cache     |
| CI scan          | `aquasecurity/trivy-action` v0.36.0 (installs Trivy v0.70.0)                                     |
| Dependency bumps | Dependabot `docker` ecosystem for both Dockerfiles                                               |

**Spec:** `docs/specs/2026-10-13-atlas-scaffold-design.md`, milestone M4 (§20), first half: §5 (layout), §10 (web container), §14.3 (the compose stack E2E will use), §15 (`build-images`). M4b adds Playwright E2E and the `e2e` CI job.

**Deviations from the spec (all deliberate):**

1. **nginx renders `/config.json`, rather than a script writing a file.** The non-root nginx user can't write to the web root, but it can write to `/etc/nginx/conf.d`, which is where the image renders `/etc/nginx/templates` from environment variables at startup. So the server template serves `/config.json` with `return 200`. A small sourced script (`19-atlas-env.envsh`) still runs first: it stops the container when a setting is missing, and derives the sign-in origin for the CSP.
2. **The CSP allows inline styles** (`style-src 'self' 'unsafe-inline'`). Fluent UI creates `<style>` tags at runtime. Tested in Chrome: under `style-src 'self'` every one is blocked, even empty ones, and the app renders unstyled. Recorded in ADR 0016, together with the nonce upgrade path. The CSP also has `frame-src` for MSAL's hidden-iframe renewal.
3. **The API trusts the mock issuer's `localhost` address in compose, but fetches keys by service name** (`OIDC_JWKS_URI=http://mock-oidc:8080/atlas/jwks`). The browser reaches the mock as `localhost:8090`, so that's the `iss` in every token. Inside Docker, `localhost` is the API's own container. `OIDC_JWKS_URI` already exists (spec §16), so this needs no code change.
4. **The API runtime image removes npm, npx, corepack and yarn.** Trivy found 7 HIGH vulnerabilities, all in packages bundled inside npm, none in the API's own dependencies. The API never runs a package manager.
5. **`build-images` is one job that builds both images,** not a matrix, so it's one required check with a fixed name.
6. **zod's `eval` probe is left for M4b.** At startup zod tries `Function('')`; the CSP blocks it and zod falls back, but Chrome logs a violation. M4b's E2E tests will fail on any CSP violation, and that's where we switch it off (`z.config({ jitless: true })`), with a test proving it.
7. **Images are pinned by version tag.** Digest pinning comes with the rest of the supply-chain work in M8.

**Verified before writing this plan** (in a scratch copy of the repo, as compose project `atlasproto` on ports 18080/18090):

- Both images build on arm64 (Mac). The lockfile has the musl builds of Vite's native bundler for arm64 and x64.
- Trivy v0.70.0 (`--severity HIGH,CRITICAL --ignore-unfixed`): 0 findings in both images.
- The web container exits with code 2 and names the missing setting when one is unset.
- nginx responses:
  - `/config.json`: rendered from the variables, served `no-store`
  - CSP: `connect-src` derived from the authority
  - hashed assets: `immutable`, gzipped
  - SPA fallback: unknown paths return `index.html`
  - missing asset: 404
  - `Server` header: no nginx version
- Compose full stack: `up --build --wait` exits 0.
  - The migration ran.
  - A mock token for `localhost` was accepted by the API through nginx: `/api/users/me` returned "Local Developer", notes were created and listed, and a call without a token got 401.
- Chrome (playwright-core, headless) signed in and added a note.
  - The app was fully styled.
  - The only CSP report was zod's `eval` probe.

**Conventions for every task:**

- Branch `feat/m4a-containers`. Run every command from the repo root, `/Users/chayud/atlas`.
- Docker Desktop must be running.
- Your dev setup can keep running: the containers use port 8080, and the dev servers use 3000 and 5173. The `full` profile reuses the Postgres and mock OIDC containers you already have.
- Commit after each task with the message given. The PR squashes them into one commit on `main`.

---

## File map

| Path                                            | Status | Responsibility                                                    |
| ----------------------------------------------- | ------ | ----------------------------------------------------------------- |
| `.dockerignore`                                 | Create | Keep the build context small; keep local settings out of images   |
| `apps/api/Dockerfile`                           | Create | Build stage (compile TS) → runtime stage (prod deps, non-root)    |
| `apps/web/nginx/19-atlas-env.envsh`             | Create | At start: require every setting, derive `AUTH_ORIGIN` for the CSP |
| `apps/web/nginx/security-headers.conf.template` | Create | CSP and security headers, included by each nginx location         |
| `apps/web/nginx/default.conf.template`          | Create | The server: `/api/` proxy, `/config.json`, caching, SPA fallback  |
| `apps/web/Dockerfile`                           | Create | Build stage (Vite) → nginx-unprivileged                           |
| `compose.yaml`                                  | Modify | Add the `full` profile: `migrate`, `api`, `web`                   |
| `package.json`                                  | Modify | shellcheck the `.envsh` script (`lint:sh`, lint-staged)           |
| `.github/workflows/ci.yml`                      | Modify | `build-images` job: build both images, Trivy scan                 |
| `.github/dependabot.yml`                        | Modify | Weekly base-image updates for both Dockerfiles                    |
| `scripts/bootstrap.sh`                          | Modify | Add `build-images` to `REQUIRED_CHECKS`                           |
| `docs/adr/0016-web-container-config-and-csp.md` | Create | Why nginx serves `/config.json` and why styles may be inline      |
| `AGENTS.md`, `README.md`, spec §10              | Modify | Container commands and layout                                     |

---

### Task 0: Branch and commit this plan

**Files:** `docs/plans/2026-10-17-m4a-containers.md` (this file, already written)

- [ ] **Step 1: Create the branch.** The untracked plan file comes along.

```bash
git switch main
git pull
git switch -c feat/m4a-containers
git status
```

Expected: `On branch feat/m4a-containers`, with `docs/plans/2026-10-17-m4a-containers.md` untracked.

- [ ] **Step 2: Commit it**

```bash
git add docs/plans/2026-10-17-m4a-containers.md
git commit -m "docs(plan): add the M4a containers plan"
```

---

### Task 1: `.dockerignore` and the API image

**Files:**

- Create: `.dockerignore`
- Create: `apps/api/Dockerfile`

- [ ] **Step 1: Create `.dockerignore`**

```gitignore
# The build context for both Dockerfiles is the repo root. The Dockerfiles copy only what they
# name, but a small context builds faster, and what's excluded here can't be copied by mistake.
**/node_modules
**/dist
**/coverage
**/*.tsbuildinfo
**/.env
**/.env.*
apps/web/public/config.json
.git
```

- [ ] **Step 2: Create `apps/api/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

# The API image. By default it runs the API; the migration job runs the same image with
# `node apps/api/dist/migrate.js` (ADR 0006), so code and migrations always ship together.
# Build from the repo root: docker build -f apps/api/Dockerfile .

# ---- Build: install every dependency and compile the TypeScript ----
FROM node:24.21.0-alpine3.24 AS build
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
FROM node:24.21.0-alpine3.24
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
CMD ["node", "apps/api/dist/server.js"]
```

- [ ] **Step 3: Build it**

```bash
docker build -f apps/api/Dockerfile -t atlas-api:local .
```

Expected: ends with `naming to docker.io/library/atlas-api:local`. The first build takes about a minute; later builds reuse cached layers.

- [ ] **Step 4: Check what's inside**

```bash
docker run --rm atlas-api:local sh -c 'id -un; command -v npm || echo "npm: removed"; find apps/api/dist -name "*.test.*" | wc -l; ls node_modules/@atlas'
```

Expected, line by line:

- `node`: it runs as a non-root user.
- `npm: removed`
- `0`: no test files in the image.
- `api  shared`: the workspace links. `@atlas/shared` resolves to `packages/shared/dist`.

- [ ] **Step 5: Commit**

```bash
git add .dockerignore apps/api/Dockerfile
git commit -m "build(api): add the API container image"
```

---

### Task 2: nginx configuration for the web image

**Files:**

- Create: `apps/web/nginx/19-atlas-env.envsh`
- Create: `apps/web/nginx/security-headers.conf.template`
- Create: `apps/web/nginx/default.conf.template`
- Modify: `package.json` (`lint:sh`, `lint-staged`)

- [ ] **Step 1: Create `apps/web/nginx/19-atlas-env.envsh`**

```sh
# shellcheck shell=sh
# Runs at container start. The nginx image *sources* files ending in .envsh (it runs .sh
# files), so AUTH_ORIGIN exported here reaches 20-envsubst-on-templates.sh, which renders
# /etc/nginx/templates. The 19- prefix makes this run just before it.

# Stop the container from starting, instead of serving a broken /config.json.
: "${ATLAS_ENV:?must be set}"
: "${AUTH_KIND:?must be set}"
: "${AUTH_AUTHORITY:?must be set}"
: "${AUTH_CLIENT_ID:?must be set}"
: "${AUTH_API_SCOPE:?must be set}"
: "${API_UPSTREAM:?must be set}"

# The browser fetches tokens from the sign-in server, so the CSP must allow its origin:
# https://login.microsoftonline.com/<tenant> gives https://login.microsoftonline.com
AUTH_ORIGIN=$(printf '%s' "$AUTH_AUTHORITY" | sed -E 's#^(https?://[^/]+).*#\1#')
export AUTH_ORIGIN
```

- [ ] **Step 2: Create `apps/web/nginx/security-headers.conf.template`**

```nginx
# Security headers for what nginx serves itself (the API sets its own). A location that has
# any add_header loses the server's, so every location includes this file. `always` adds the
# headers to error responses too.
#
# style-src allows inline styles because Fluent UI creates <style> tags at runtime (ADR 0016).
# frame-src lets MSAL renew tokens in a hidden iframe.
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${AUTH_ORIGIN}; frame-src ${AUTH_ORIGIN}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
# Browsers ignore this over plain http (locally); in Azure the site is https only.
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

- [ ] **Step 3: Create `apps/web/nginx/default.conf.template`**

```nginx
# The web app's server. The nginx image renders this template at container start: each
# ${NAME} becomes that environment variable (only the names NGINX_ENVSUBST_FILTER allows, see
# the Dockerfile), and nginx's own variables, like $uri, are left alone.

gzip on;
gzip_types text/css application/javascript application/json image/svg+xml;

server {
    listen 8080;
    root /usr/share/nginx/html;
    server_tokens off;

    # The API, on the same origin as the app, so the browser needs no CORS (spec §10).
    location /api/ {
        proxy_pass http://${API_UPSTREAM};
    }

    # This environment's settings, which the app reads at startup: one image, configured per
    # environment by its variables (ADR 0007). Every value is a public identifier.
    location = /config.json {
        include /etc/nginx/conf.d/atlas/security-headers.conf;
        add_header Cache-Control "no-store" always;
        default_type application/json;
        return 200 '{"env":"${ATLAS_ENV}","auth":{"kind":"${AUTH_KIND}","authority":"${AUTH_AUTHORITY}","clientId":"${AUTH_CLIENT_ID}","apiScope":"${AUTH_API_SCOPE}"}}';
    }

    # Vite's hashed build output: a file's name changes whenever its content does, so browsers
    # may keep it forever. A missing file is a 404, never index.html.
    location /assets/ {
        include /etc/nginx/conf.d/atlas/security-headers.conf;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        try_files $uri =404;
    }

    # Everything else is the single-page app. index.html is never cached, so a deploy shows up
    # on the next page load.
    location / {
        include /etc/nginx/conf.d/atlas/security-headers.conf;
        add_header Cache-Control "no-store" always;
        try_files $uri /index.html;
    }
}
```

- [ ] **Step 4: shellcheck the new script.** In `package.json`, change `lint:sh`:

```json
"lint:sh": "shellcheck scripts/*.sh apps/web/nginx/*.envsh"
```

and add a line to `lint-staged`, under `"scripts/*.sh": "shellcheck"` (add a comma after that line):

```json
"apps/web/nginx/*.envsh": "shellcheck"
```

- [ ] **Step 5: Run the shell lint**

```bash
npm run lint:sh
```

Expected: no output after the command echo, which means no findings.

- [ ] **Step 6: Commit**

```bash
git add apps/web/nginx package.json
git commit -m "build(web): add the nginx configuration"
```

---

### Task 3: The web image

**Files:**

- Create: `apps/web/Dockerfile`

- [ ] **Step 1: Create `apps/web/Dockerfile`**

```dockerfile
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
FROM nginxinc/nginx-unprivileged:1.30.6-alpine3.24
# Only these environment variables are substituted into the templates.
ENV NGINX_ENVSUBST_FILTER="^(ATLAS_ENV|AUTH_[A-Z_]+|API_UPSTREAM)$"
COPY --chmod=755 apps/web/nginx/19-atlas-env.envsh /docker-entrypoint.d/
COPY apps/web/nginx/default.conf.template /etc/nginx/templates/
COPY apps/web/nginx/security-headers.conf.template /etc/nginx/templates/atlas/
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
```

- [ ] **Step 2: Build it**

```bash
docker build -f apps/web/Dockerfile -t atlas-web:local .
```

Expected: ends with `naming to docker.io/library/atlas-web:local`.

- [ ] **Step 3: A missing setting stops the container**

```bash
docker run --rm -e ATLAS_ENV=ci atlas-web:local; echo "exit code: $?"
```

Expected: `.../19-atlas-env.envsh: line 8: AUTH_KIND: must be set`, then `exit code: 2`.

- [ ] **Step 4: With every setting, nginx serves the app**

```bash
docker run -d --name web-check -p 8080:8080 \
  -e ATLAS_ENV=ci -e AUTH_KIND=mock -e AUTH_AUTHORITY=http://localhost:8090/atlas \
  -e AUTH_CLIENT_ID=atlas-web -e AUTH_API_SCOPE=atlas-api/access_as_user \
  -e API_UPSTREAM=127.0.0.1:3000 \
  atlas-web:local
curl -s localhost:8080/config.json; echo
curl -sI localhost:8080/ | grep -i -E "content-security|cache-control"
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/assets/missing.js
docker rm -f web-check
```

Expected:

- `{"env":"ci","auth":{"kind":"mock","authority":"http://localhost:8090/atlas","clientId":"atlas-web","apiScope":"atlas-api/access_as_user"}}`
- A `Content-Security-Policy` line containing `connect-src 'self' http://localhost:8090`
- `Cache-Control: no-store`
- `404`

`API_UPSTREAM=127.0.0.1:3000` points at nothing in this container. It only has to be an address nginx can parse at startup; `/api/` would answer 502 here.

- [ ] **Step 5: Commit**

```bash
git add apps/web/Dockerfile
git commit -m "build(web): add the web container image"
```

---

### Task 4: The compose `full` profile

**Files:**

- Modify: `compose.yaml`

- [ ] **Step 1: Replace the comment on line 1 of `compose.yaml`** (`# Local development dependencies: docker compose up -d`) with:

```yaml
# Local development. `docker compose up -d --wait` starts Postgres and the mock OIDC issuer for
# the dev servers. `docker compose --profile full up -d --build --wait` also builds the
# production images and runs migrate, api and web on http://localhost:8080 (spec §14.3).
```

- [ ] **Step 2: Add three services** after `mock-oidc` and before the top-level `volumes:`

```yaml
# The full profile: the same Dockerfiles as Azure, with ATLAS_ENV=ci so the API trusts the mock.
migrate:
  profiles: [full]
  build:
    context: .
    dockerfile: apps/api/Dockerfile
  image: atlas-api:local
  command: [node, apps/api/dist/migrate.js]
  environment:
    ATLAS_ENV: ci
    DB_AUTH: password
    DATABASE_URL: postgres://atlas_migrator:atlas_migrator@postgres:5432/atlas
    API_ROLE_NAME: atlas_app
  depends_on:
    postgres:
      condition: service_healthy

api:
  profiles: [full]
  build:
    context: .
    dockerfile: apps/api/Dockerfile
  image: atlas-api:local
  environment:
    ATLAS_ENV: ci
    # Tokens carry the issuer address the browser used. Inside Docker, localhost is the API's
    # own container, so the API fetches the signing keys from the mock by its service name.
    OIDC_ISSUER: http://localhost:8090/atlas
    OIDC_JWKS_URI: http://mock-oidc:8080/atlas/jwks
    OIDC_AUDIENCE: atlas-api
    DB_AUTH: password
    DATABASE_URL: postgres://atlas_app:atlas_app@postgres:5432/atlas
  depends_on:
    migrate:
      condition: service_completed_successfully
  healthcheck:
    # 127.0.0.1, not localhost: in a container, localhost resolves to IPv6 (::1) first.
    test: [CMD, wget, -q, -O, /dev/null, http://127.0.0.1:3000/api/health/ready]
    interval: 2s
    timeout: 3s
    retries: 15

web:
  profiles: [full]
  build:
    context: .
    dockerfile: apps/web/Dockerfile
  image: atlas-web:local
  environment:
    ATLAS_ENV: ci
    AUTH_KIND: mock
    AUTH_AUTHORITY: http://localhost:8090/atlas
    AUTH_CLIENT_ID: atlas-web
    AUTH_API_SCOPE: atlas-api/access_as_user
    API_UPSTREAM: api:3000
  ports:
    - '8080:8080'
  depends_on:
    api:
      condition: service_healthy
      # nginx looks up the API's address once, at start, so restart it with the API.
      restart: true
  healthcheck:
    test: [CMD, wget, -q, -O, /dev/null, http://127.0.0.1:8080/]
    interval: 2s
    timeout: 3s
    retries: 15
```

- [ ] **Step 3: Validate the file**

```bash
docker compose --profile full config --quiet && echo "compose.yaml is valid"
```

Expected: `compose.yaml is valid`

- [ ] **Step 4: Start the full stack**

```bash
docker compose --profile full up -d --build --wait
docker compose --profile full ps -a
```

Expected:

- `api`: healthy
- `web`: healthy
- `migrate`: Exited (0)
- `postgres`: healthy
- `mock-oidc`: Up

`postgres` and `mock-oidc` are the containers you already had.

- [ ] **Step 5: Check it from the terminal**

```bash
curl -s localhost:8080/api/health/ready; echo
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/api/notes
docker compose logs api --tail 3
```

Expected:

- `{"status":"ok"}`
- `401` (no token)
- JSON log lines from the container API, with the lean request fields

- [ ] **Step 6: Check it in the browser.** Open http://localhost:8080:
  1. Click **Sign in**. You should be "Local Developer".
  2. Add a note.
  3. In DevTools → Console, expect one CSP message about `'unsafe-eval'`. That's zod's startup check (deviation 6), and M4b removes it. Any other CSP message is a bug.

- [ ] **Step 7: Commit**

```bash
git add compose.yaml
git commit -m "build: run the full stack from the production images"
```

The stack can keep running. `docker compose --profile full down` stops all five containers, including the Postgres and mock that the dev servers use; the database volume is kept. To go back to the dev setup only, run `docker compose up -d --wait` afterwards.

---

### Task 5: CI builds and scans the images

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `.github/dependabot.yml`
- Modify: `scripts/bootstrap.sh`

- [ ] **Step 1: Add the `build-images` job** to `.github/workflows/ci.yml`, between the `check` job and `dependency-review:`

```yaml
build-images:
  name: build-images
  runs-on: ubuntu-latest
  timeout-minutes: 20
  steps:
    - uses: actions/checkout@v7

    # Third-party actions are pinned to commit SHAs, because tags can be moved (see pr-title.yml).
    - uses: docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069 # v4.4.1

    - name: Build the API image
      uses: docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0
      with:
        context: .
        file: apps/api/Dockerfile
        tags: atlas-api:ci
        load: true
        cache-from: type=gha,scope=api
        cache-to: type=gha,scope=api,mode=max

    - name: Build the web image
      uses: docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0
      with:
        context: .
        file: apps/web/Dockerfile
        tags: atlas-web:ci
        load: true
        cache-from: type=gha,scope=web
        cache-to: type=gha,scope=web,mode=max

    # Fails on CRITICAL or HIGH vulnerabilities that have a fix available (spec §15).
    # In March 2026 attackers force-pushed this action's version tags to credential-stealing
    # code (CVE-2026-33634); v0.36.0 was released after the clean-up.
    - name: Scan the API image
      uses: aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25 # v0.36.0
      with:
        image-ref: atlas-api:ci
        severity: CRITICAL,HIGH
        ignore-unfixed: true
        exit-code: '1'

    - name: Scan the web image
      uses: aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25 # v0.36.0
      with:
        image-ref: atlas-web:ci
        severity: CRITICAL,HIGH
        ignore-unfixed: true
        exit-code: '1'
```

- [ ] **Step 2: Base-image updates.** Append to `.github/dependabot.yml`:

```yaml
- package-ecosystem: docker
  directories: [/apps/api, /apps/web]
  schedule:
    interval: weekly
  commit-message:
    prefix: chore(deps)
```

- [ ] **Step 3: Make it a required check.** In `scripts/bootstrap.sh`, add `"build-images"` to `REQUIRED_CHECKS`, after `"check"`:

```bash
REQUIRED_CHECKS=(
  "check"
  "build-images"
  "dependency-review"
  "pr-title"
  "Analyze (javascript-typescript)"
  "Analyze (actions)"
)
```

The ruleset only changes when `bootstrap.sh repo` runs, after this PR merges (Task 7). Requiring a check before the job exists on `main` would block every PR.

- [ ] **Step 4: Lint the workflow and the script**

```bash
npm run lint:gh && npm run lint:sh && npx prettier --check .github
```

Expected: no findings, and `All matched files use Prettier code style!`

- [ ] **Step 5: Commit**

```bash
git add .github scripts/bootstrap.sh
git commit -m "ci: build and scan both container images"
```

---

### Task 6: Docs

**Files:**

- Create: `docs/adr/0016-web-container-config-and-csp.md`
- Modify: `AGENTS.md`, `README.md`, `docs/specs/2026-10-13-atlas-scaffold-design.md`

- [ ] **Step 1: Create `docs/adr/0016-web-container-config-and-csp.md`**

```markdown
# 0016. Web container: nginx serves `/config.json`, and the CSP allows inline styles

- **Status:** Accepted
- **Date:** 2026-10-17

## Context

- **One web image runs in every environment** (ADR 0002). Its settings reach the app as `/config.json` (ADR 0007).
- **The image runs nginx as a non-root user** (`nginxinc/nginx-unprivileged`). That user can't write to the web root, but it can write to `/etc/nginx/conf.d`, where the image renders `/etc/nginx/templates` from environment variables at startup.
- **Fluent UI creates `<style>` tags at runtime** (Griffel). Tested in Chrome under `style-src 'self'`: every one is blocked, even empty ones, and the app renders unstyled.
- **zod probes `Function('')` at startup** to decide whether it can compile faster parsers. A CSP without `'unsafe-eval'` blocks it, and zod falls back to its normal path.

## Decision

- **nginx renders its server config from a template,** using the image's own startup step, and that config serves `/config.json` with `return 200`. Nothing is written to the web root.
- **A sourced script (`19-atlas-env.envsh`) runs first.** It stops the container when a setting is missing, and derives the sign-in server's origin for the CSP.
- **The CSP:**
  - `script-src 'self'`: no inline scripts, no `eval`
  - `style-src 'self' 'unsafe-inline'`
  - `img-src 'self' data:`
  - `connect-src` and `frame-src`: `'self'` plus the sign-in origin
  - `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `object-src 'none'`
- **Why inline styles are acceptable here:** injected CSS mostly steals data by loading an attacker's image or font, and `img-src`, `font-src` (from `default-src`) and `connect-src` block that. Injected script, the serious risk, stays blocked.

## Consequences

- **A stricter option exists: a per-request nonce.**
  - nginx can put `$request_id` into `index.html` (`sub_filter`) and into the CSP header.
  - Vite's `html.cspNonce` and Fluent's `createDOMRenderer(document, { styleElementAttributes: { nonce } })` both accept a nonce.
  - About 20 lines plus tests.
- **Until it's switched off with `z.config({ jitless: true })` (M4b), zod's probe logs one CSP violation per page load.** M4b's E2E tests fail on any violation.
- **Application Insights (M7) adds its ingestion origin to `connect-src`.**
- **A config change needs a container restart, not a rebuild.**
```

- [ ] **Step 2: `AGENTS.md`, the commands table.** Add two rows after the `npm run dev -w @atlas/web` row. Prettier re-pads the table when you commit.

```markdown
| `docker compose --profile full up -d --build --wait` | Build the production images and run migrate, api and web on :8080 |
| `docker compose --profile full down` | Stop everything; the database volume stays (`-v` deletes it) |
```

- [ ] **Step 3: `AGENTS.md`, the API layout table.** Add a row after the `src/server.ts`, `src/migrate.ts` row:

```markdown
| `Dockerfile` | Production image: runs the API; the migration job runs it with `node apps/api/dist/migrate.js` |
```

- [ ] **Step 4: `AGENTS.md`, under the web layout table.** Add this paragraph before "Imports flow one way":

```markdown
The web image is `apps/web/Dockerfile` plus `apps/web/nginx/`: nginx serves the build, proxies `/api/`, sets the security headers and CSP, and renders `/config.json` from environment variables at startup (ADR 0016).
```

- [ ] **Step 5: `README.md`.**

Line 5, the status:

```markdown
> **Status:** under construction. Milestone M4 (containers and E2E) of M9. See the [design spec](docs/specs/2026-10-13-atlas-scaffold-design.md).
```

After the paragraph that starts "Open http://localhost:5173", add:

````markdown
Or run the whole app from the production images, the same Dockerfiles that Azure runs:

```bash
docker compose --profile full up -d --build --wait   # http://localhost:8080
docker compose --profile full down                   # stops everything, keeps the database
```
````

- [ ] **Step 6: The spec, §10.** Replace these two lines:

```markdown
- In the container, a `/docker-entrypoint.d/` script renders it from
  environment variables at startup (§15).
```

with:

```markdown
- In the container, nginx renders it from environment variables at
  startup (ADR 0016).
```

- [ ] **Step 7: Format check and commit**

```bash
git add docs AGENTS.md README.md
git commit -m "docs: describe the container images"
git status
```

Expected: the hook's Prettier run re-pads the tables, and `git status` is clean.

---

### Task 7: Definition of done, PR and merge

- [ ] **Step 1: `npm run check`**

```bash
npm run check
```

Expected: everything passes. Nothing in it builds images; CI's `build-images` does that, and Tasks 1–4 checked them locally.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/m4a-containers
gh pr create --web
```

Title: `build: add container images and the compose full profile (M4a)`. Claude drafts the body from the template; it becomes the commit message on `main`.

- [ ] **Step 3: Watch the checks**

```bash
gh pr checks --watch
```

Expected: the five required checks, plus `build-images`. It isn't required yet, but it must pass: about 3–5 minutes the first time, faster once the cache is warm.

- [ ] **Step 4: Merge and update `main`**

```bash
gh pr merge --squash --delete-branch
git switch main && git pull
```

- [ ] **Step 5: Require `build-images` from now on**

```bash
scripts/bootstrap.sh repo
RULESET=$(gh api repos/Chayud-Ac/atlas/rulesets --jq '.[] | select(.name == "main") | .id')
gh api "repos/Chayud-Ac/atlas/rulesets/$RULESET" \
  --jq '.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context'
```

Expected: the second command lists `build-images` with the other five.

---

## Execution notes (2026-10-17)

What happened when the plan met reality. The prototype had already run every step, so the differences are small:

1. **From Task 1 on, Claude wrote the files and the user reviewed each one** in the approval prompt, instead of typing them. Typing the first PR (#5) by hand had been slow for long files.
2. **Dependabot's Docker entry ignores major updates of `node`.** Without that, it would propose `node:25`, which isn't an LTS release. The repo targets Node 24 (`engines`, `.nvmrc`), the same reason `@types/node` majors are already ignored. nginx needs no rule: its mainline releases are production-ready.
3. **Task 4's browser check was automated** with `playwright-core` driving the installed Chrome (headless), in a scratch folder outside the repo. It signed in, added a note through `nginx → api → postgres`, and recorded CSP reports. The only report was zod's `eval` probe (deviation 6). The note it added stays in the local database, which the dev servers share.
4. **`docker compose --profile full up` reused the running `postgres` and `mock-oidc` containers.** They kept running ("Up 3 hours"), and the dev API on :3000 kept answering, as the conventions above expected.
