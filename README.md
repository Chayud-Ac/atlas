# Atlas

A scaffold for internal company apps on Azure: React + Express in TypeScript, PostgreSQL, Azure Container Apps, Bicep and GitHub Actions, with **no stored secrets anywhere**.

> **Status:** under construction. Milestone M1 (repo foundation) of M9. See the [design spec](docs/specs/2026-10-13-atlas-scaffold-design.md).

## What it demonstrates

- npm-workspaces monorepo, type-aware linting, tests as the definition of done
- Every change goes through a pull request, gated by lint, type, test, dependency and CodeQL checks
- (coming) Entra ID sign-in, GitHub Actions → Azure with OIDC, dev → uat → prod promotion of one immutable image

## Quickstart

Prerequisites: [fnm](https://github.com/Schniz/fnm) (or nvm) with Node 24, `shellcheck` and `actionlint`. Docker Desktop is needed from M2 onwards.

```bash
git clone https://github.com/Chayud-Ac/atlas.git
cd atlas
fnm use        # reads .nvmrc → Node 24
npm ci
npm run check  # lint + typecheck + tests
```

## Docs

- [AGENTS.md](AGENTS.md): how to work in this repo (for people and AI agents)
- [Design spec](docs/specs/2026-10-13-atlas-scaffold-design.md)
- [Architecture decision records](docs/adr/)
- [Security policy](SECURITY.md)

## License

[MIT](LICENSE)
