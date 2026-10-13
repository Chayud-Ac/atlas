# 0015. Web app layout follows Bulletproof React

- **Status:** Accepted
- **Date:** 2026-10-13

## Context

The first version of `apps/web` reused the API's file rules (ADR 0014): `<feature>.<role>.tsx` names (`notes.page.tsx`, `users.header.tsx`), feature folders at the top of `src/`, and as few files as possible. It worked, but React developers didn't recognise it. There was no `components/` folder for shared UI, no `styles/` and no global CSS reset (the page kept the browser's default 8px body margin), and the names looked like Angular. A scaffold is read by many developers, and a familiar layout is worth more than a clever one.

[Bulletproof React](https://github.com/alan2207/bulletproof-react) is the most widely cited reference for React project structure. It groups code by feature inside a small set of conventional top-level folders.

## Decision

`apps/web/src/` uses Bulletproof React's structure, trimmed to what the app needs today:

- `app/`: the layout (`app.tsx`) and the providers (`providers.tsx`).
- `components/`: shared UI used by two or more features.
- `features/<feature>/api/` (TanStack Query hooks) and `features/<feature>/components/` (UI).
- `lib/`: infrastructure without UI (`config.ts`, `api-client.ts`, `auth/`).
- `styles/global.css`: the only CSS file, a small reset.
- `testing/`: test setup, the MSW fake API and render helpers.

Other choices:

- Files are kebab-case, and imports use the `@/` alias for `src/`, without extensions (Vite's `bundler` resolution).
- Imports flow one way: `app` → `features` → `components` / `lib`.
- Styling stays with Fluent UI v9 (`makeStyles` and design tokens), so there is no Tailwind. That fits internal apps in a Microsoft environment: the components match Microsoft 365 and are accessible out of the box.
- Server data lives in TanStack Query instead of hand-written React contexts. The one context is sign-in (`lib/auth/auth-context.ts`).

## Consequences

- The web app and the API follow different, well-known conventions for their ecosystems: Bulletproof React here, and ADR 0014 (Node best-practice components) for the API. AGENTS.md states both.
- Bulletproof React's other folders (`hooks/`, `stores/`, `types/`, `utils/`, `assets/`) are added when the first file needs them, not before.
- The one-way import rule is a convention for now. ESLint `import/no-restricted-paths` can enforce it once there are more features.
