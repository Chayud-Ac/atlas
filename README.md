# Atlas

A scaffold for internal company apps on Azure: React + Express in TypeScript, PostgreSQL, Azure Container Apps, Bicep and GitHub Actions, with **no stored secrets anywhere**.

> **Status:** under construction. Milestone M4 (containers and E2E) of M9. See the [design spec](docs/specs/2026-10-13-atlas-scaffold-design.md).

## What it demonstrates

- npm-workspaces monorepo, type-aware linting, tests as the definition of done
- React 19 web app (Vite, Fluent UI v9, TanStack Query) with Entra ID sign-in through MSAL and one build for every environment (runtime `/config.json`)
- Express 5 API with Entra-style token validation, RFC 9457 errors and audit events
- PostgreSQL with Entra-only auth in Azure, a least-privilege runtime role and migrations as a separate job, tested against real Postgres with Testcontainers
- Non-root container images (nginx for the web app), scanned for vulnerabilities in CI; the whole app runs locally from the same images
- Every change goes through a pull request, gated by lint, type, test, image-scan, end-to-end, dependency and CodeQL checks
- (coming) GitHub Actions → Azure with OIDC, dev → uat → prod promotion of one immutable image

## Quickstart

Prerequisites: [fnm](https://github.com/Schniz/fnm) (or nvm) with Node 24, Docker Desktop, `shellcheck` and `actionlint`.

```bash
git clone https://github.com/Chayud-Ac/atlas.git
cd atlas
fnm use                       # reads .nvmrc → Node 24
npm ci
npm run check                 # lint + typecheck + build + all tests (needs Docker)

# Run the app locally
docker compose up -d --wait   # Postgres + mock OIDC issuer
cp apps/api/.env.example apps/api/.env
cp apps/api/.env.migrate.example apps/api/.env.migrate
cp apps/web/config.example.json apps/web/public/config.json
npm run db:migrate -w @atlas/api
npm run dev -w @atlas/api     # terminal 1: http://localhost:3000/api/health/live
npm run dev -w @atlas/web     # terminal 2: http://localhost:5173
```

Open http://localhost:5173 and click **Sign in**. Locally, sign-in uses the mock OIDC issuer, so there's no password: you're "Local Developer" (ADR 0007).

Or run the whole app from the production images, the same Dockerfiles that Azure runs:

```bash
docker compose --profile full up -d --build --wait   # http://localhost:8080
docker compose --profile full down                   # stops everything, keeps the database
```

The end-to-end tests run against that stack:

```bash
npx playwright install chromium   # once
npm run test:e2e
```

Or call the API directly with a token from the mock issuer:

```bash
TOKEN=$(curl -s -X POST localhost:8090/atlas/token -d grant_type=client_credentials \
  -d client_id=local-dev -d client_secret=unused -d scope=access_as_user | jq -r .access_token)
curl -s localhost:3000/api/users/me -H "Authorization: Bearer $TOKEN"
```

## Docs

- [AGENTS.md](AGENTS.md): how to work in this repo (for people and AI agents)
- [Design spec](docs/specs/2026-10-13-atlas-scaffold-design.md)
- [Architecture decision records](docs/adr/)
- [Security policy](SECURITY.md)

## License

[MIT](LICENSE)
