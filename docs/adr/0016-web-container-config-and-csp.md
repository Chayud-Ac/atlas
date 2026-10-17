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
