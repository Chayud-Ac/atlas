# Atlas

A scaffold for internal company apps on Azure: React + Express in TypeScript, PostgreSQL, Azure Container Apps, Bicep and GitHub Actions, with **no stored secrets anywhere**.

> **Status:** under construction. Milestone M2 (API + data) of M9. See the [design spec](docs/specs/2026-10-13-atlas-scaffold-design.md).

## What it demonstrates

- npm-workspaces monorepo, type-aware linting, tests as the definition of done
- Express 5 API with Entra-style token validation, RFC 9457 errors and audit events
- PostgreSQL with Entra-only auth in Azure, a least-privilege runtime role and migrations as a separate job, tested against real Postgres with Testcontainers
- Every change goes through a pull request, gated by lint, type, test, dependency and CodeQL checks
- (coming) Entra ID sign-in, GitHub Actions → Azure with OIDC, dev → uat → prod promotion of one immutable image

## Quickstart

Prerequisites: [fnm](https://github.com/Schniz/fnm) (or nvm) with Node 24, Docker Desktop, `shellcheck` and `actionlint`.

```bash
git clone https://github.com/Chayud-Ac/atlas.git
cd atlas
fnm use                       # reads .nvmrc → Node 24
npm ci
npm run check                 # lint + typecheck + unit + integration tests (needs Docker)

# Run the API locally
docker compose up -d --wait   # Postgres + mock OIDC issuer
cp apps/api/.env.example apps/api/.env
cp apps/api/.env.migrate.example apps/api/.env.migrate
npm run db:migrate -w @atlas/api
npm run dev -w @atlas/api     # http://localhost:3000/api/health/live
```

Get a local token from the mock issuer and call the API:

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
