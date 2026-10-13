# M1: Repo Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the empty `atlas` repo into a public GitHub monorepo where every change goes through a pull request, and lint, type, test, PR-title, dependency and CodeQL gates are enforced by a branch ruleset.

**Architecture:** An npm-workspaces monorepo (`apps/*`, `packages/*`, `tests/*`). Each workspace owns its `test` scripts, and the root scripts fan out with `--workspaces --if-present`. `npm run check` is the single definition of done, run locally, by pre-commit hooks (staged files only) and by GitHub Actions. Repo settings and the ruleset are applied by an idempotent `scripts/bootstrap.sh repo`.

**Tech stack:** Node 24.21 LTS, npm 11, TypeScript 6.0.3 (pinned, ADR 0013), ESLint 10 + typescript-eslint 8.71 (type-aware), Prettier 3.9, Vitest 5 + `@vitest/coverage-v8`, Zod 4, husky 9 + lint-staged 17, shellcheck, actionlint 1.7.12, GitHub Actions (`actions/checkout@v7`, `actions/setup-node@v7`, `github/codeql-action@v4`, `actions/dependency-review-action@v5`, `amannn/action-semantic-pull-request@v6`).

**Spec:** `docs/specs/2026-10-13-atlas-scaffold-design.md`, milestone M1 (§20).

**Deviations from the spec (all deliberate):**

1. **TypeScript is pinned to 6.0.x, not 7.x.** typescript-eslint 8.71 declares `typescript: >=4.8.4 <6.1.0`, so TS 7 would break type-aware linting. Recorded in ADR 0013.
2. **`pr-title` is its own workflow** (`pr-title.yml`), not a job in `ci.yml`. It has to re-run when a PR title is _edited_, and re-running the full CI on a title edit would be waste.
3. **`packages/shared` (the notes schemas) moves forward from M2 into M1,** so the pipeline has real code and real tests to gate.
4. **`npm run lint` also runs shellcheck and actionlint,** so shell scripts and workflows are gated too.
5. **New ADRs are numbered after the 12 planned in spec §17.** M1 writes 0001, 0002 and 0011 (planned) and 0013 (new).

**Conventions for every task:**

- Work on branch `m1/foundation`. Never commit to `main` directly.
- Run every command from the repo root, `/Users/chayud/atlas`.
- End every commit message with:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

- If the agent shell still reports Node 22 after Task 1, prefix commands with `eval "$(fnm env --shell zsh)" &&`.

---

## File map (what M1 creates)

| Path                                                                | Responsibility                                                                         |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `.gitignore`, `.gitattributes`, `.editorconfig`, `.nvmrc`, `.npmrc` | Repo hygiene: ignored files, LF line endings, editor defaults, Node 24, strict engines |
| `LICENSE`                                                           | MIT                                                                                    |
| `package.json`, `package-lock.json`                                 | Workspaces, root scripts, dev tooling, lint-staged config                              |
| `tsconfig.base.json`                                                | Strict compiler options shared by every workspace                                      |
| `tsconfig.json`                                                     | Solution file: project references to every TS workspace                                |
| `.prettierrc.json`, `.prettierignore`                               | Formatting rules                                                                       |
| `eslint.config.js`                                                  | Flat ESLint config, type-aware                                                         |
| `.husky/pre-commit`                                                 | Runs lint-staged                                                                       |
| `packages/shared/{package.json,tsconfig.json,vitest.config.ts}`     | `@atlas/shared` workspace                                                              |
| `packages/shared/src/notes.ts`                                      | Zod schemas: `CreateNoteInput`, `Note`, limits                                         |
| `packages/shared/src/notes.test.ts`                                 | Schema tests                                                                           |
| `packages/shared/src/index.ts`                                      | Public exports                                                                         |
| `AGENTS.md`, `CLAUDE.md`                                            | Agent + human working guide                                                            |
| `README.md`, `SECURITY.md`                                          | Project front page, vulnerability reporting                                            |
| `.github/CODEOWNERS`, `.github/pull_request_template.md`            | Ownership, PR checklist                                                                |
| `docs/adr/0000-template.md`, `0001-…`, `0002-…`, `0011-…`, `0013-…` | Architecture decision records                                                          |
| `scripts/coverage-summary.mjs`                                      | Writes Vitest coverage as a Markdown table for the CI job summary                      |
| `.github/workflows/ci.yml`                                          | `check` + `dependency-review` jobs, reusable by deploy later                           |
| `.github/workflows/pr-title.yml`                                    | Conventional Commits check on PR titles                                                |
| `.github/workflows/codeql.yml`                                      | CodeQL for `javascript-typescript` and `actions`                                       |
| `.github/dependabot.yml`                                            | Weekly npm + GitHub Actions updates                                                    |
| `scripts/bootstrap.sh`                                              | `repo` target: merge settings, security features, `main` ruleset                       |

---

### Task 0: Commit this plan

**Files:**

- Create: `docs/plans/2026-10-13-m1-repo-foundation.md` (this file)

- [ ] **Step 1: Commit**

```bash
git add docs/plans/2026-10-13-m1-repo-foundation.md
git commit -m "docs: add M1 repo foundation plan" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: `1 file changed`.

---

### Task 1: Install the toolchain

This task changes the developer's machine (Homebrew packages and one line in `~/.zshrc`). **Get the user's OK before running it.** Nothing is committed.

- [ ] **Step 1: Install fnm, shellcheck and actionlint**

```bash
brew install fnm shellcheck actionlint
```

Expected: all three formulae report installed. `jq` is already present at `/usr/bin/jq`.

- [ ] **Step 2: Hook fnm into zsh**

This lets new shells pick up `.nvmrc` automatically.

```bash
grep -q 'fnm env' ~/.zshrc || printf '\n# fnm: Node version manager (reads .nvmrc)\neval "$(fnm env --use-on-cd --version-file-strategy=recursive --shell zsh)"\n' >> ~/.zshrc
```

Expected: no output. Run it a second time to confirm it doesn't add the line twice: `grep -c 'fnm env' ~/.zshrc` should print `1`.

- [ ] **Step 3: Install Node 24 and make it the default**

```bash
fnm install 24 && fnm default 24
```

Expected: `Installing Node v24.21.0` (or a newer 24.x).

- [ ] **Step 4: Verify in a fresh shell**

```bash
zsh -ic 'node -v; npm -v; shellcheck --version | head -2 | tail -1; actionlint -version | head -1'
```

Expected:

```
v24.21.0
11.x.x
version: 0.x.x
1.7.12
```

---

### Task 2: Repo hygiene files

**Files:**

- Create: `.gitignore`, `.gitattributes`, `.editorconfig`, `.nvmrc`, `.npmrc`, `LICENSE`

- [ ] **Step 1: Create `.gitignore`**

```gitignore
# Dependencies and build output
node_modules/
dist/
*.tsbuildinfo

# Test output
coverage/
playwright-report/
test-results/

# Local configuration. Never commit real values (public repo, spec §6.2)
.env
.env.*
!.env.example
apps/web/public/config.json

# OS and editor noise
.DS_Store
*.log
```

- [ ] **Step 2: Create `.gitattributes`**

```gitattributes
* text=auto eol=lf
*.png binary
*.jpg binary
*.ico binary
```

- [ ] **Step 3: Create `.editorconfig`**

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 4: Create `.nvmrc`**

```
24
```

- [ ] **Step 5: Create `.npmrc`**

This makes `npm` refuse to install if the Node or npm version doesn't match `engines`.

```ini
engine-strict=true
```

- [ ] **Step 6: Create `LICENSE`**

```
MIT License

Copyright (c) 2026 Chayud Mahithiphark

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 7: Commit**

```bash
git add .gitignore .gitattributes .editorconfig .nvmrc .npmrc LICENSE
git commit -m "chore: add repo hygiene files and MIT license" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: `6 files changed`.

---

### Task 3: Root package and TypeScript base config

**Files:**

- Create: `package.json`, `tsconfig.base.json`
- Generated: `package-lock.json`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "atlas",
  "version": "0.0.0",
  "private": true,
  "description": "Scaffold for internal company apps on Azure",
  "license": "MIT",
  "type": "module",
  "engines": {
    "node": ">=24 <25",
    "npm": ">=11"
  },
  "workspaces": ["apps/*", "packages/*", "tests/*"]
}
```

- [ ] **Step 2: Install the dev toolchain**

TypeScript uses `~6.0.3` (patch updates only, see ADR 0013). `@types/node` stays on 24 to match the runtime.

```bash
npm install --save-dev \
  typescript@~6.0.3 @types/node@^24.19.2 \
  eslint@^10.12.0 @eslint/js@^10.0.1 typescript-eslint@^8.71.2 eslint-config-prettier@^10.1.8 globals@^17.13.0 \
  prettier@^3.9.10 \
  vitest@^5.0.4 @vitest/coverage-v8@^5.0.4 \
  husky@^9.1.7 lint-staged@^17.6.0
```

Expected: `added N packages`, with no `ERESOLVE` or `EBADENGINE` errors. If `EBADENGINE` appears, Task 1 didn't take effect. Fix that first.

- [ ] **Step 3: Verify the compiler version**

```bash
npx tsc --version
```

Expected: `Version 6.0.3`.

- [ ] **Step 4: Create `tsconfig.base.json`**

Every option is set explicitly, so behaviour doesn't change with TypeScript's defaults. `types: []` means each workspace opts in to ambient types (e.g. `node`) itself.

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "es2024",
    "lib": ["es2024"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "types": [],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "erasableSyntaxOnly": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json
git commit -m "build: add npm workspaces root and strict TypeScript base config" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Prettier

**Files:**

- Create: `.prettierrc.json`, `.prettierignore`
- Modify: `package.json` (scripts)
- Reformat: all existing Markdown, JSON and YAML

- [ ] **Step 1: Create `.prettierrc.json`**

```json
{
  "singleQuote": true,
  "printWidth": 100
}
```

- [ ] **Step 2: Create `.prettierignore`**

Prettier 3 already skips everything in `.gitignore`. These are extras.

```
package-lock.json
```

- [ ] **Step 3: Add the scripts**

```bash
npm pkg set scripts.format="prettier --write ." 'scripts.lint:format=prettier --check .'
```

- [ ] **Step 4: Check that the gate fails on an unformatted file**

```bash
printf '{"a":1}\n' > format-probe.json && npm run lint:format; echo "exit=$?"
```

Expected: FAIL. Prettier prints `[warn] format-probe.json` (it may also list existing docs whose tables aren't padded yet) and `exit=1`.

- [ ] **Step 5: Remove the probe, format everything and re-check**

```bash
rm format-probe.json && npm run format && npm run lint:format
```

Expected: `All matched files use Prettier code style!`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "style: add Prettier and format existing files" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: ESLint (flat config, type-aware)

**Files:**

- Create: `eslint.config.js`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Create `eslint.config.js`**

```js
// Flat ESLint config. TypeScript files are linted with full type information.
// JS files and *.config.ts are linted without types (they belong to no tsconfig).
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/dist/', '**/coverage/', '**/playwright-report/', '**/test-results/']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Numbers in template literals are fine; the other strict defaults stay on.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // A leading underscore marks something as intentionally unused, e.g. Express's
      // 4-argument error handler or `const { dropped: _dropped, ...rest } = obj`.
      // (Added during Task 6b, when the CurrentUser tests needed it.)
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}', '**/*.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
```

- [ ] **Step 2: Add the scripts**

```bash
npm pkg set 'scripts.lint:ts=eslint --max-warnings=0 .' scripts.lint="npm run lint:ts && npm run lint:format"
```

- [ ] **Step 3: Check that the gate fails on a violation**

```bash
printf 'const unused = 1;\n' > lint-gate.mjs && npm run lint:ts; echo "exit=$?"
```

Expected: FAIL, with `'unused' is assigned a value but never used  no-unused-vars` and `exit=1`.

- [ ] **Step 4: Remove the probe and check that lint passes**

```bash
rm lint-gate.mjs && npm run lint
```

Expected: ESLint prints nothing, then `All matched files use Prettier code style!`

- [ ] **Step 5: Commit**

```bash
git add eslint.config.js package.json
git commit -m "build: add type-aware ESLint flat config" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `@atlas/shared` with note schemas (TDD)

**Files:**

- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/vitest.config.ts`
- Create: `packages/shared/src/notes.test.ts`, `packages/shared/src/notes.ts`, `packages/shared/src/index.ts`
- Create: `tsconfig.json` (root solution file)

- [ ] **Step 1: Create `packages/shared/package.json`**

```json
{
  "name": "@atlas/shared",
  "version": "0.0.0",
  "private": true,
  "description": "Schemas and types shared by the Atlas web app and API",
  "license": "MIT",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "test": "vitest run --coverage"
  }
}
```

- [ ] **Step 2: Install zod into the workspace**

```bash
npm install zod@^4.6.7 -w @atlas/shared
```

Expected: `packages/shared/package.json` now has `"dependencies": { "zod": "^4.6.7" }`.

- [ ] **Step 3: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create the root `tsconfig.json`**

```json
{
  "files": [],
  "references": [{ "path": "packages/shared" }]
}
```

- [ ] **Step 5: Create `packages/shared/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 80 },
    },
  },
});
```

- [ ] **Step 6: Write the failing tests: `packages/shared/src/notes.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { CreateNoteInput, Note, NOTE_BODY_MAX, NOTE_TITLE_MAX } from './notes.js';

describe('CreateNoteInput', () => {
  it('accepts a title and a body', () => {
    expect(CreateNoteInput.parse({ title: 'Groceries', body: 'Milk' })).toEqual({
      title: 'Groceries',
      body: 'Milk',
    });
  });

  it('defaults the body to an empty string', () => {
    expect(CreateNoteInput.parse({ title: 'Groceries' })).toEqual({ title: 'Groceries', body: '' });
  });

  it('trims surrounding whitespace from the title', () => {
    expect(CreateNoteInput.parse({ title: '  Groceries  ' }).title).toBe('Groceries');
  });

  it('rejects a missing title', () => {
    expect(CreateNoteInput.safeParse({ body: 'Milk' }).success).toBe(false);
  });

  it('rejects a title that is only whitespace', () => {
    expect(CreateNoteInput.safeParse({ title: '   ' }).success).toBe(false);
  });

  it(`accepts a title of exactly ${NOTE_TITLE_MAX} characters`, () => {
    expect(CreateNoteInput.safeParse({ title: 'a'.repeat(NOTE_TITLE_MAX) }).success).toBe(true);
  });

  it(`rejects a title longer than ${NOTE_TITLE_MAX} characters`, () => {
    expect(CreateNoteInput.safeParse({ title: 'a'.repeat(NOTE_TITLE_MAX + 1) }).success).toBe(
      false,
    );
  });

  it(`rejects a body longer than ${NOTE_BODY_MAX} characters`, () => {
    const input = { title: 'Groceries', body: 'a'.repeat(NOTE_BODY_MAX + 1) };
    expect(CreateNoteInput.safeParse(input).success).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(CreateNoteInput.safeParse({ title: 'Groceries', ownerId: 'someone-else' }).success).toBe(
      false,
    );
  });
});

describe('Note', () => {
  const note = {
    id: '0199c3a0-0000-7000-8000-000000000000',
    title: 'Groceries',
    body: '',
    createdAt: '2026-10-13T08:00:00.000Z',
    updatedAt: '2026-10-13T08:00:00.000Z',
  };

  it('accepts a note as the API returns it', () => {
    expect(Note.parse(note)).toEqual(note);
  });

  it('rejects an id that is not a UUID', () => {
    expect(Note.safeParse({ ...note, id: '42' }).success).toBe(false);
  });

  it('rejects a timestamp that is not ISO 8601 UTC', () => {
    expect(Note.safeParse({ ...note, createdAt: '13/10/2026' }).success).toBe(false);
  });
});
```

- [ ] **Step 7: Run the tests and watch them fail**

```bash
npm test -w @atlas/shared
```

Expected: FAIL. `Failed to resolve import "./notes.js"` (or `Cannot find module`).

- [ ] **Step 8: Implement `packages/shared/src/notes.ts`**

```ts
import { z } from 'zod';

export const NOTE_TITLE_MAX = 200;
export const NOTE_BODY_MAX = 10_000;

export const NoteTitle = z
  .string()
  .trim()
  .min(1, 'Title is required')
  .max(NOTE_TITLE_MAX, `Title must be at most ${NOTE_TITLE_MAX} characters`);

export const NoteBody = z
  .string()
  .max(NOTE_BODY_MAX, `Body must be at most ${NOTE_BODY_MAX} characters`);

/** Request body for POST /api/notes. Unknown fields are rejected. */
export const CreateNoteInput = z.strictObject({
  title: NoteTitle,
  body: NoteBody.default(''),
});
export type CreateNoteInput = z.infer<typeof CreateNoteInput>;

/** A note as returned by the API. Timestamps are ISO 8601 UTC strings. */
export const Note = z.strictObject({
  id: z.uuid(),
  title: NoteTitle,
  body: NoteBody,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Note = z.infer<typeof Note>;
```

- [ ] **Step 9: Create `packages/shared/src/index.ts`**

```ts
export * from './notes.js';
```

- [ ] **Step 10: Run the tests and watch them pass**

```bash
npm test -w @atlas/shared
```

Expected: PASS. `Test Files  1 passed`, `Tests  12 passed`, and coverage for `notes.ts` at `100` lines (above the 80% threshold).

- [ ] **Step 11: Typecheck through the solution file**

```bash
npm pkg set scripts.typecheck="tsc --build" && npm run typecheck
```

Expected: no output, exit 0. `packages/shared/dist/index.js` and `index.d.ts` now exist (git-ignored).

- [ ] **Step 12: Check that type-aware linting is active**

Put a floating promise in a file inside the workspace:

```bash
printf 'export function probe(): void {\n  Promise.resolve(1);\n}\n' > packages/shared/src/lint-gate.ts && npm run lint:ts; echo "exit=$?"
```

Expected: FAIL. `Promises must be awaited ... @typescript-eslint/no-floating-promises`, `exit=1`. That rule needs type information, so this proves the project service is wired up.

- [ ] **Step 13: Remove the probe and run all gates**

```bash
rm packages/shared/src/lint-gate.ts && npm run lint && npm run typecheck && npm test -w @atlas/shared
```

Expected: all pass.

- [ ] **Step 14: Commit**

```bash
git add tsconfig.json packages/shared package.json package-lock.json
git commit -m "feat(shared): add note schemas with tests" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6b: `CurrentUser` schema for `GET /api/me` (added during execution)

This was added after review. Notes are the removable _reference feature_, and `app.users` needs a base endpoint (spec v2.1).

**Files:**

- Modify: `docs/specs/2026-10-13-atlas-scaffold-design.md` (v2.1: `GET /api/me`; scope renamed `Notes.ReadWrite` → `access_as_user`)
- Create: `packages/shared/src/users.test.ts`, `packages/shared/src/users.ts`
- Modify: `packages/shared/src/index.ts`, `eslint.config.js` (underscore rule, shown in Task 5)

- [ ] **Step 1: Write the failing tests: `packages/shared/src/users.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { CurrentUser } from './users.js';

describe('CurrentUser', () => {
  const user = {
    id: '0199c3a0-0000-7000-8000-000000000001',
    displayName: 'Chayud M.',
    email: 'someone@example.com',
    roles: ['Admin'],
  };

  it('accepts a user as GET /api/me returns it', () => {
    expect(CurrentUser.parse(user)).toEqual(user);
  });

  it('accepts a user whose name and email are unknown', () => {
    const anonymous = { ...user, displayName: null, email: null };
    expect(CurrentUser.parse(anonymous)).toEqual(anonymous);
  });

  it('accepts a user with no roles', () => {
    expect(CurrentUser.parse({ ...user, roles: [] }).roles).toEqual([]);
  });

  it('rejects a response without roles, so "no roles" is never ambiguous', () => {
    const { roles: _roles, ...withoutRoles } = user;
    expect(CurrentUser.safeParse(withoutRoles).success).toBe(false);
  });

  it('rejects an empty role name', () => {
    expect(CurrentUser.safeParse({ ...user, roles: [''] }).success).toBe(false);
  });

  it('rejects an id that is not a UUID', () => {
    expect(CurrentUser.safeParse({ ...user, id: 'abc' }).success).toBe(false);
  });

  it('rejects unknown fields, so internal identifiers cannot leak to the browser', () => {
    const leaky = { ...user, entraObjectId: '0199c3a0-0000-7000-8000-000000000002' };
    expect(CurrentUser.safeParse(leaky).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and watch them fail.** `npm test -w @atlas/shared` → `Cannot find module './users.js'`.

- [ ] **Step 3: Implement `packages/shared/src/users.ts`**

```ts
import { z } from 'zod';

/**
 * The signed-in user, as returned by GET /api/me.
 * `id` is the app's own users.id, never an Entra identifier. `roles` comes from the
 * token's `roles` claim (Entra App Roles) and is always present, even when empty.
 */
export const CurrentUser = z.strictObject({
  id: z.uuid(),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  roles: z.array(z.string().min(1)),
});
export type CurrentUser = z.infer<typeof CurrentUser>;
```

- [ ] **Step 4: Export it from `packages/shared/src/index.ts`**

```ts
export * from './notes.js';
export * from './users.js';
```

- [ ] **Step 5: Run the tests and watch them pass.** `Tests  19 passed (19)`, 100% lines.

- [ ] **Step 6: Run lint.** ESLint fails with `'_roles' is assigned a value but never used`. Add the underscore rule shown in Task 5, then confirm that a probe `const x = 1;` inside a function **still fails** and that `npm run lint` passes.

- [ ] **Step 7: Commit the spec and the code separately**

```bash
git add docs/specs && git commit -m "docs(spec): add GET /api/me and rename API scope to access_as_user" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git add packages/shared eslint.config.js && git commit -m "feat(shared): add CurrentUser schema for GET /api/me" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Root test scripts and `npm run check`

**Files:**

- Modify: `package.json` (scripts)

- [ ] **Step 1: Add the fan-out scripts and the definition of done**

```bash
npm pkg set \
  scripts.test="npm run test --workspaces --if-present" \
  'scripts.test:integration=npm run test:integration --workspaces --if-present' \
  scripts.check="npm run lint && npm run typecheck && npm test && npm run test:integration"
```

- [ ] **Step 2: Run the definition of done**

```bash
npm run check
```

Expected: lint passes, typecheck passes, `@atlas/shared` tests pass (19), and `test:integration` exits 0 without doing anything (no workspace defines it yet). Exit code 0.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "build: add root test scripts and npm run check" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Pre-commit hook (husky + lint-staged)

**Files:**

- Create: `.husky/pre-commit`
- Modify: `package.json` (`prepare` script, `lint-staged` config)

- [ ] **Step 1: Initialise husky**

```bash
npx husky init
```

Expected: creates `.husky/pre-commit` and sets `"prepare": "husky"` in `package.json`.

- [ ] **Step 2: Replace `.husky/pre-commit`**

```sh
npx lint-staged
```

- [ ] **Step 3: Add the lint-staged config**

Shell scripts are added to this config in Task 13, once they exist.

```bash
npm pkg set --json 'lint-staged={"*.{ts,tsx,js,mjs,cjs}":["eslint --max-warnings=0 --fix","prettier --write"],"*.{json,md,yml,yaml,css,html}":"prettier --write"}'
```

- [ ] **Step 4: Commit, which exercises the hook**

```bash
git add .husky/pre-commit package.json
git commit -m "build: run lint-staged in a pre-commit hook" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: lint-staged output (`✔ Running tasks for staged files...`) appears before the commit summary.

---

### Task 9: Working docs (AGENTS.md, README, SECURITY, CODEOWNERS, PR template)

**Files:**

- Create: `AGENTS.md`, `CLAUDE.md`, `README.md`, `SECURITY.md`, `.github/CODEOWNERS`, `.github/pull_request_template.md`

- [ ] **Step 1: Create `AGENTS.md`**

```markdown
# AGENTS.md

How to work in this repo. It's written for AI coding agents and humans alike. If a change makes this file wrong, update it in the same pull request.

## What this is

Atlas is a scaffold for internal company apps on Azure: React + Express in TypeScript, PostgreSQL, Azure Container Apps, Bicep and GitHub Actions, with no stored secrets anywhere.

- Design: `docs/specs/2026-10-13-atlas-scaffold-design.md`
- Decisions: `docs/adr/`
- Milestone plans: `docs/plans/`

## Layout

| Path        | Contains                                                              |
| ----------- | --------------------------------------------------------------------- |
| `apps/`     | Deployable apps (`web`, `api`; later `ai`)                            |
| `packages/` | Libraries imported by apps (`@atlas/shared`: zod schemas)             |
| `tests/`    | Cross-app tests (`e2e`)                                               |
| `infra/`    | Bicep                                                                 |
| `scripts/`  | `bootstrap.sh` and other operational scripts (bash, shellcheck-clean) |
| `docs/`     | Specs, plans, ADRs, runbooks                                          |

Current workspaces: `packages/shared`.

## Commands

Run these from the repo root.

| Command                     | Does                                                 |
| --------------------------- | ---------------------------------------------------- |
| `npm ci`                    | Install exactly what the lockfile says               |
| `npm run check`             | **Definition of done**: lint + typecheck + all tests |
| `npm run lint`              | ESLint, Prettier check, actionlint, shellcheck       |
| `npm run format`            | Prettier write                                       |
| `npm run typecheck`         | `tsc --build` across all workspaces                  |
| `npm test`                  | Unit tests in every workspace (no Docker)            |
| `npm run test:integration`  | Integration tests (need Docker)                      |
| `npm test -w @atlas/shared` | Tests for one workspace                              |

## Definition of done

`npm run check` passes. Don't disable a lint rule, skip a test or lower a coverage threshold to get there. Fix the cause, or explain the exception in the pull request.

## Conventions

- **TypeScript:** strict, ESM, `module: nodenext`. Relative imports end in `.js` (`import { Note } from './notes.js'`). TypeScript is pinned to 6.0.x (ADR 0013), so don't upgrade it to 7.
- **Tests sit next to the code:** `*.test.ts` for unit tests, `*.int.test.ts` for integration tests. Write the failing test first for new behaviour.
- **Validation:** zod schemas in `@atlas/shared` are the single source of truth for request and response shapes. Infer types with `z.infer`. Never hand-write a duplicate type.
- **Files:** small, with one job each. Split a file when it passes ~200 lines or starts doing two things.
- **Naming:** files `kebab-case.ts`, types and schemas `PascalCase`, functions and variables `camelCase`, database tables and columns `snake_case`.
- **Intentionally unused:** prefix with `_` (`_next`, `const { secret: _secret, ...safe } = obj`). Everything else unused is a lint error.

## Base features and the reference feature

- **Base features ship in every app built on this scaffold:** sign-in, `app.users` (exposed as `GET /api/me` → `CurrentUser`), `app.audit_events`, and the health endpoints. Don't remove them.
- **Notes is the reference feature.** It shows the full pattern: shared zod schema → migration → grants → repository → service → route → tests → UI. Copy its structure for your first real feature, then delete it.
- **Authorization:** every endpoint requires the `access_as_user` scope. What a user _may do_ is decided by Entra App Roles (`req.auth.roles`), never by extra scopes or database role tables.

## Git and pull requests

- Branch from `main`. Direct pushes to `main` are blocked by a ruleset.
- The PR title is a Conventional Commit (`feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `perf:`, `test:`, `build:`, `ci:`, `chore:`, `revert:`). It becomes the squash commit on `main`.
- Every required check must be green before merging. The checks are listed in `scripts/bootstrap.sh` (`REQUIRED_CHECKS`).

## Security rules (public repo)

- There are no secrets to commit, by design: CI uses OIDC and the apps use managed identities. If you think you need a secret, stop and raise it in the pull request.
- Never commit Azure tenant, subscription, client or object IDs, UPNs or email addresses. They belong in GitHub environment variables or git-ignored `.env` files.
- Never print those values in CI logs. Public-repo logs are world-readable.

## Database rules (from M2)

- Schema changes only through committed Drizzle migrations.
- **Expand, then contract.** Every migration must work with both the current and the previous API version. To rename or drop something: add the new thing → ship → switch reads and writes → ship → remove the old thing.
- A new table must be added to the grants allowlist (`apps/api/src/db/grants.ts`), or the API can't read it.
```

- [ ] **Step 2: Create `CLAUDE.md`**

```markdown
@AGENTS.md
```

- [ ] **Step 3: Create `README.md`**

````markdown
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
````

- [ ] **Step 4: Create `SECURITY.md`**

```markdown
# Security policy

## Reporting a vulnerability

Please **don't** open a public issue. Report it privately through GitHub: go to the **Security** tab, choose **Report a vulnerability**, and you'll get a reply within 7 days.

## Supported versions

Only `main` is supported.

## Design notes

Atlas is designed to hold no secrets. GitHub Actions authenticates to Azure with OIDC federated credentials. Apps authenticate to Azure services with managed identities, and users sign in with Microsoft Entra ID. If you find a credential anywhere in this repository or its CI logs, treat it as a vulnerability and report it.
```

- [ ] **Step 5: Create `.github/CODEOWNERS`**

```
# Default owner for everything. A team would split this by path.
* @Chayud-Ac
```

- [ ] **Step 6: Create `.github/pull_request_template.md`**

```markdown
## Summary

<!-- What does this change and why? 1–3 sentences. -->

## Changes

-

## How I tested

- [ ] `npm run check` passes locally

## Checklist

- [ ] PR title follows Conventional Commits (it becomes the squash commit)
- [ ] No secrets, IDs, UPNs or email addresses added (public repo)
- [ ] Docs updated (AGENTS.md / README / ADR) if behaviour or a decision changed
- [ ] Database migrations, if any, are expand-then-contract
```

- [ ] **Step 7: Format, lint and commit**

```bash
npm run format && npm run lint
git add AGENTS.md CLAUDE.md README.md SECURITY.md .github/CODEOWNERS .github/pull_request_template.md
git commit -m "docs: add AGENTS.md, README, security policy and PR template" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: lint passes. If Prettier re-padded the tables in `AGENTS.md`, that's fine; the formatted version is what gets committed.

---

### Task 10: Architecture decision records

**Files:**

- Create: `docs/adr/0000-template.md`, `docs/adr/0001-npm-workspaces-monorepo.md`, `docs/adr/0002-trunk-based-build-once-promote.md`, `docs/adr/0011-solo-developer-ruleset.md`, `docs/adr/0013-pin-typescript-6.md`

- [ ] **Step 1: Create `docs/adr/0000-template.md`**

```markdown
# NNNN. Short title of the decision

- **Status:** Proposed | Accepted | Superseded by NNNN
- **Date:** YYYY-MM-DD

## Context

What forces are at play? What problem are we solving, and what constraints apply?

## Decision

What we decided, in one or two short paragraphs.

## Consequences

What becomes easier, what becomes harder, and what we'll have to revisit.
```

- [ ] **Step 2: Create `docs/adr/0001-npm-workspaces-monorepo.md`**

```markdown
# 0001. npm-workspaces monorepo

- **Status:** Accepted
- **Date:** 2026-10-13

## Context

Atlas has a React web app, an Express API, shared validation schemas and, later, a Python AI service. Changes often span the frontend and backend, for example a new field in a schema, the API and a form. AI coding agents work best when the whole system is in one place with uniform commands.

Options considered:

1. npm workspaces: built into npm, no extra tools
2. pnpm + Turborepo: faster, with build caching, but two more tools
3. One repository per app: matches some company setups, but means three pipelines and painful cross-repo changes

## Decision

One repository using npm workspaces. Deployables go in `apps/`, libraries in `packages/` and cross-app tests in `tests/`. Each workspace owns its scripts, and the root fans out with `--workspaces --if-present`.

## Consequences

- One lockfile, one CI pipeline, and atomic cross-cutting changes.
- No build cache. Acceptable at this size, and revisit if CI passes about 10 minutes.
- The Python service will live in `apps/ai` with its own toolchain. npm workspaces ignore it unless it has a `package.json`.
```

- [ ] **Step 3: Create `docs/adr/0002-trunk-based-build-once-promote.md`**

```markdown
# 0002. Trunk-based development, build once and promote

- **Status:** Accepted
- **Date:** 2026-10-13

## Context

Companies use either branch-per-environment (`develop` → dev, `release` → uat, `main` → prod) or trunk-based development with artifact promotion. Branch-per-environment rebuilds the code for each environment, so prod runs a binary that was never tested, and the branches drift apart.

## Decision

- Trunk-based. `main` is the only long-lived branch, and every change arrives by squash-merged pull request.
- Each merge builds **one** image per app, tagged with the git commit SHA.
- That same image is deployed to dev automatically, then promoted to UAT and prod behind GitHub environment approvals.
- Environments are deployment targets, not branches.

## Consequences

- What runs in prod is byte-for-byte what was tested in dev and UAT.
- Rollback means redeploying an older SHA. Nothing is rebuilt.
- Frontend configuration must be read at runtime (`/config.json`), not baked in at build time (ADR 0007).
- Database migrations must be backward compatible (expand, then contract), because two app versions overlap during a rollout.
- The `main` ruleset enforces squash merges, linear history and green checks.
```

- [ ] **Step 4: Create `docs/adr/0011-solo-developer-ruleset.md`**

```markdown
# 0011. Ruleset for a solo developer

- **Status:** Accepted
- **Date:** 2026-10-13

## Context

GitHub doesn't let authors approve their own pull requests. This repo has one developer, so any rule that requires an approval would block every merge.

## Decision

The `main` ruleset requires:

- pull requests (squash only)
- linear history
- resolved conversations
- strict, up-to-date status checks
- CodeQL results with no high-or-worse security alerts

It requires **0 approvals**, and there are **no bypass actors**, not even the admin.

## Consequences

The automated gates are fully enforced, but a second human never reviews the code. A team would change this to:

- `required_approving_review_count: 1` (or 2 for prod-critical paths)
- `require_code_owner_review: true`, with `CODEOWNERS` split by path
- `require_last_push_approval: true`
- required reviewers on the `uat` and `prod` environments drawn from the team, not the author
```

- [ ] **Step 5: Create `docs/adr/0013-pin-typescript-6.md`**

```markdown
# 0013. Pin TypeScript to 6.0.x

- **Status:** Accepted
- **Date:** 2026-10-13

## Context

TypeScript 7 (the native Go rewrite) is the latest release, at 7.0.2. Our type-aware lint rules come from typescript-eslint, which uses the TypeScript compiler API. typescript-eslint 8.71.2 declares support for `typescript >=4.8.4 <6.1.0`, so TypeScript 7 would break type-aware linting, one of our quality gates.

## Decision

Use TypeScript `~6.0.3`, which allows patch updates only. Dependabot ignores TypeScript major updates. `tsconfig.base.json` sets every compiler option explicitly, so the eventual upgrade doesn't change behaviour silently.

## Consequences

- We miss TypeScript 7's faster compiles. At this size, the difference is seconds.
- Revisit when typescript-eslint publishes a release that supports TypeScript 7. The upgrade is then one dependency bump plus `npm run check`.
```

- [ ] **Step 6: Format, lint and commit**

```bash
npm run format && npm run lint
git add docs/adr
git commit -m "docs: add ADRs for monorepo, trunk-based promotion, solo ruleset and TypeScript pin" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: CI workflows (`ci.yml`, `pr-title.yml`) and the coverage summary

**Files:**

- Create: `scripts/coverage-summary.mjs`, `.github/workflows/ci.yml`, `.github/workflows/pr-title.yml`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Create `scripts/coverage-summary.mjs`**

```js
// Prints Vitest json-summary coverage for every workspace as a Markdown table.
// CI appends the output to $GITHUB_STEP_SUMMARY.
import { glob, readFile } from 'node:fs/promises';

const patterns = [
  'apps/*/coverage/coverage-summary.json',
  'packages/*/coverage/coverage-summary.json',
];

const rows = [];
for await (const file of glob(patterns)) {
  const workspace = file.split('/').slice(0, 2).join('/');
  const { total } = JSON.parse(await readFile(file, 'utf8'));
  rows.push(
    `| ${workspace} | ${total.lines.pct}% | ${total.branches.pct}% | ${total.functions.pct}% |`,
  );
}

console.log('### Coverage\n');
if (rows.length === 0) {
  console.log('No coverage reports found.');
} else {
  console.log('| Workspace | Lines | Branches | Functions |');
  console.log('| --- | --- | --- | --- |');
  console.log(rows.sort().join('\n'));
}
```

- [ ] **Step 2: Run it against the coverage from Task 7**

```bash
npm test -w @atlas/shared >/dev/null && node scripts/coverage-summary.mjs
```

Expected:

```
### Coverage

| Workspace | Lines | Branches | Functions |
| --- | --- | --- | --- |
| packages/shared | 100% | 100% | 100% |
```

- [ ] **Step 3: Create `.github/workflows/ci.yml`**

```yaml
name: ci

on:
  pull_request:
    branches: [main]
  workflow_call:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.event.pull_request.number || github.sha }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

jobs:
  check:
    name: check
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: npm

      - name: Install actionlint
        run: |
          go install github.com/rhysd/actionlint/cmd/actionlint@v1.7.12
          echo "$(go env GOPATH)/bin" >> "$GITHUB_PATH"

      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run test:integration

      - name: Coverage summary
        if: always()
        run: node scripts/coverage-summary.mjs >> "$GITHUB_STEP_SUMMARY"

  dependency-review:
    name: dependency-review
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v7
      - uses: actions/dependency-review-action@v5
        with:
          fail-on-severity: high
          deny-licenses: GPL-2.0-only, GPL-2.0-or-later, GPL-3.0-only, GPL-3.0-or-later, AGPL-3.0-only, AGPL-3.0-or-later
          comment-summary-in-pr: on-failure
```

- [ ] **Step 4: Create `.github/workflows/pr-title.yml`**

```yaml
name: pr-title

on:
  pull_request:
    branches: [main]
    types: [opened, edited, reopened, synchronize]

permissions:
  pull-requests: read

jobs:
  pr-title:
    name: pr-title
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: amannn/action-semantic-pull-request@v6
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 5: Add actionlint to `lint` and run it**

```bash
npm pkg set 'scripts.lint:gh=actionlint' scripts.lint="npm run lint:ts && npm run lint:format && npm run lint:gh"
npm run format && npm run lint
```

Expected: actionlint prints nothing (exit 0), and Prettier and ESLint pass. actionlint also runs shellcheck over each `run:` block.

- [ ] **Step 6: Commit**

```bash
git add scripts/coverage-summary.mjs .github/workflows/ci.yml .github/workflows/pr-title.yml package.json
git commit -m "ci: add check, dependency review and PR title workflows" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: CodeQL and Dependabot

**Files:**

- Create: `.github/workflows/codeql.yml`, `.github/dependabot.yml`

- [ ] **Step 1: Create `.github/workflows/codeql.yml`**

```yaml
name: codeql

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '23 3 * * 1'

permissions:
  contents: read

jobs:
  analyze:
    name: Analyze (${{ matrix.language }})
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      actions: read
      contents: read
      security-events: write
    strategy:
      fail-fast: false
      matrix:
        language: [javascript-typescript, actions]
    steps:
      - uses: actions/checkout@v7
      - uses: github/codeql-action/init@v4
        with:
          languages: ${{ matrix.language }}
          build-mode: none
          queries: security-extended
      - uses: github/codeql-action/analyze@v4
        with:
          category: /language:${{ matrix.language }}
```

- [ ] **Step 2: Create `.github/dependabot.yml`**

The commit-message prefixes keep Dependabot's PR titles valid Conventional Commits, so they pass `pr-title`. A `docker` entry is added in M4, once Dockerfiles exist.

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    commit-message:
      prefix: chore(deps)
      prefix-development: chore(deps-dev)
    groups:
      minor-and-patch:
        update-types: [minor, patch]
    ignore:
      # ADR 0013: typescript-eslint doesn't support TypeScript 7 yet.
      - dependency-name: typescript
        update-types: ['version-update:semver-major']
      # The runtime is Node 24, so its types stay on 24.
      - dependency-name: '@types/node'
        update-types: ['version-update:semver-major']

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    commit-message:
      prefix: ci(deps)
    groups:
      actions:
        patterns: ['*']
```

- [ ] **Step 3: Lint and commit**

```bash
npm run format && npm run lint
git add .github/workflows/codeql.yml .github/dependabot.yml
git commit -m "ci: add CodeQL scanning and Dependabot updates" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: actionlint accepts `codeql.yml`. (Dependabot config is checked by GitHub on push, not locally.)

---

### Task 13: `scripts/bootstrap.sh repo`

**Files:**

- Create: `scripts/bootstrap.sh`
- Modify: `package.json` (`lint:sh` script, lint-staged config)

- [ ] **Step 1: Create `scripts/bootstrap.sh`**

```bash
#!/usr/bin/env bash
# One-time, idempotent setup, run by a human with admin rights.
#
#   scripts/bootstrap.sh repo     GitHub merge settings, security features, main ruleset
#
# Azure targets (shared|dev|uat|prod) are added in milestone M5.
set -euo pipefail

REPO="${ATLAS_REPO:-Chayud-Ac/atlas}"

# Status checks that must pass before a PR can merge into main.
# Names must match the job `name:` exactly. Add to this list as milestones add jobs.
REQUIRED_CHECKS=(
  "check"
  "dependency-review"
  "pr-title"
  "Analyze (javascript-typescript)"
  "Analyze (actions)"
)

log() { printf '==> %s\n' "$*" >&2; }

usage() {
  printf 'Usage: %s repo\n' "$0" >&2
  exit 2
}

require_repo_admin() {
  local admin
  admin="$(gh api "repos/$REPO" --jq '.permissions.admin')"
  if [[ "$admin" != "true" ]]; then
    printf 'You need admin rights on %s (gh is signed in as %s).\n' "$REPO" "$(gh api user --jq .login)" >&2
    exit 1
  fi
}

ruleset_json() {
  printf '%s\n' "${REQUIRED_CHECKS[@]}" | jq -R . | jq -s '{
    name: "main",
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      { type: "required_linear_history" },
      { type: "pull_request", parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: true,
          allowed_merge_methods: ["squash"] } },
      { type: "required_status_checks", parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: map({ context: . }) } },
      { type: "code_scanning", parameters: {
          code_scanning_tools: [
            { tool: "CodeQL", security_alerts_threshold: "high_or_higher", alerts_threshold: "errors" }
          ] } }
    ]
  }'
}

bootstrap_repo() {
  require_repo_admin

  log "Merge settings: squash only, PR title as commit message, delete merged branches"
  gh api --method PATCH "repos/$REPO" --silent \
    -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
    -F delete_branch_on_merge=true -F allow_auto_merge=true \
    -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY

  log "Secret scanning + push protection"
  gh api --method PATCH "repos/$REPO" --silent --input - <<'JSON'
{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}
JSON

  log "Dependabot alerts + security updates"
  gh api --method PUT "repos/$REPO/vulnerability-alerts" --silent
  gh api --method PUT "repos/$REPO/automated-security-fixes" --silent

  log "Private vulnerability reporting"
  gh api --method PUT "repos/$REPO/private-vulnerability-reporting" --silent

  log "Ruleset 'main' (required checks: ${#REQUIRED_CHECKS[@]})"
  local body id
  body="$(ruleset_json)"
  id="$(gh api "repos/$REPO/rulesets" --jq '.[] | select(.name == "main") | .id')"
  if [[ -n "$id" ]]; then
    gh api --method PUT "repos/$REPO/rulesets/$id" --silent --input - <<<"$body"
  else
    gh api --method POST "repos/$REPO/rulesets" --silent --input - <<<"$body"
  fi

  log "Done: https://github.com/$REPO/settings/rules"
}

main() {
  [[ $# -eq 1 ]] || usage
  case "$1" in
    repo) bootstrap_repo ;;
    *) usage ;;
  esac
}

main "$@"
```

- [ ] **Step 2: Make it executable and lint it**

```bash
chmod +x scripts/bootstrap.sh && shellcheck scripts/bootstrap.sh && echo "shellcheck ok"
```

Expected: `shellcheck ok`.

- [ ] **Step 3: Check the generated ruleset JSON offline**

`ruleset_json` can't be called on its own from outside, so this rebuilds the checks array with the same `jq` pipeline:

```bash
printf '%s\n' check dependency-review | jq -R . | jq -s 'map({context: .})'
```

Expected:

```json
[{ "context": "check" }, { "context": "dependency-review" }]
```

- [ ] **Step 4: Check the usage guard**

```bash
scripts/bootstrap.sh; echo "exit=$?"; scripts/bootstrap.sh nope; echo "exit=$?"
```

Expected: `Usage: scripts/bootstrap.sh repo` and `exit=2`, twice.

- [ ] **Step 5: Add shellcheck to `lint` and lint-staged**

```bash
npm pkg set 'scripts.lint:sh=shellcheck scripts/*.sh' scripts.lint="npm run lint:ts && npm run lint:format && npm run lint:gh && npm run lint:sh"
npm pkg set --json 'lint-staged={"*.{ts,tsx,js,mjs,cjs}":["eslint --max-warnings=0 --fix","prettier --write"],"*.{json,md,yml,yaml,css,html}":"prettier --write","scripts/*.sh":"shellcheck"}'
npm run check
```

Expected: `npm run check` passes end to end (ESLint, Prettier, actionlint, shellcheck, typecheck, 19 tests).

- [ ] **Step 6: Commit**

```bash
git add scripts/bootstrap.sh package.json
git commit -m "build: add bootstrap script for GitHub repo settings and ruleset" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Publish to GitHub and merge M1 through its own gates

This task **creates a public repository and pushes to it**, which is outward-facing. **Confirm with the user before Step 1.**

- [ ] **Step 1: Create the public repository (empty)**

```bash
gh repo create Chayud-Ac/atlas --public --disable-wiki \
  --description "Scaffold for internal company apps on Azure: React, Express, Postgres, Container Apps, Bicep, GitHub Actions OIDC"
```

Expected: `✓ Created repository Chayud-Ac/atlas on github.com`.

- [ ] **Step 2: Push `main` (just the spec commit)**

```bash
git remote add origin https://github.com/Chayud-Ac/atlas.git
git push -u origin main
```

Expected: `* [new branch] main -> main`.

- [ ] **Step 3: Apply repo settings and the ruleset**

```bash
scripts/bootstrap.sh repo
```

Expected: five `==>` lines, ending with `Done: https://github.com/Chayud-Ac/atlas/settings/rules`.

- [ ] **Step 4: Verify the ruleset**

```bash
gh api repos/Chayud-Ac/atlas/rulesets --jq '.[] | "\(.name) \(.enforcement)"'
gh api repos/Chayud-Ac/atlas --jq '{squash: .allow_squash_merge, merge: .allow_merge_commit, rebase: .allow_rebase_merge, push_protection: .security_and_analysis.secret_scanning_push_protection.status}'
```

Expected: `main active`, and `{"squash":true,"merge":false,"rebase":false,"push_protection":"enabled"}`.

- [ ] **Step 5: Push the branch and open the PR**

```bash
git push -u origin m1/foundation
gh pr create --base main --head m1/foundation \
  --title "build: add repo foundation and quality gates (M1)" \
  --body "$(cat <<'EOF'
## Summary

Milestone M1 from the design spec: monorepo foundation, quality gates and repo governance. Every later change goes through these gates.

## Changes

- npm workspaces, strict TypeScript 6.0 (ADR 0013), type-aware ESLint, Prettier, husky + lint-staged
- `@atlas/shared` with zod schemas (`CreateNoteInput`, `Note`, `CurrentUser`) and tests (80% coverage threshold)
- Spec v2.1: notes become the removable reference feature, `GET /api/me` is added, and the scope is renamed to `access_as_user`
- CI: `check`, `dependency-review`, `pr-title`, CodeQL (`javascript-typescript`, `actions`), Dependabot
- AGENTS.md, README, SECURITY.md, CODEOWNERS, PR template, ADRs 0001/0002/0011/0013
- `scripts/bootstrap.sh repo`: squash-only merges, secret scanning + push protection, Dependabot security updates, `main` ruleset

## How I tested

- [x] `npm run check` passes locally
- [x] Each gate was shown to fail on a deliberate violation (Prettier, ESLint, type-aware ESLint)

## Checklist

- [x] PR title follows Conventional Commits
- [x] No secrets, IDs, UPNs or email addresses added
- [x] Docs updated
- [x] No database migrations

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: a PR URL, `https://github.com/Chayud-Ac/atlas/pull/1`.

- [ ] **Step 6: Watch the checks**

```bash
gh pr checks 1 --watch --interval 15
```

Expected: `check`, `dependency-review`, `pr-title`, `Analyze (javascript-typescript)`, `Analyze (actions)` and `CodeQL` all `pass`. If a check name differs from `REQUIRED_CHECKS` (the PR then shows "Expected — Waiting for status to be reported"), fix the array in `scripts/bootstrap.sh`, commit, push and re-run `scripts/bootstrap.sh repo`.

- [ ] **Step 7: Squash-merge and sync**

```bash
gh pr merge 1 --squash --delete-branch
git switch main && git pull --ff-only
git log --oneline -3
```

Expected: `main` has two commits. On top is `build: add repo foundation and quality gates (M1) (#1)`, and below it is the spec commit.

---

### Task 15: Prove the gates block bad changes

This is the M1 success check: red checks block merging, and direct pushes to `main` are rejected.

- [ ] **Step 1: Open a PR that fails lint**

`--no-verify` deliberately skips the local hook, to show the **server-side** gate holds even when a developer bypasses theirs.

```bash
git switch -c verify/blocked-merge
printf 'export const unused = () => { const x = 1; };\n' > packages/shared/src/gate-probe.ts
git add packages/shared/src/gate-probe.ts
git commit --no-verify -m "test: probe that failing checks block merge" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin verify/blocked-merge
gh pr create --base main --title "test: probe that failing checks block merge" --body "Deliberately failing PR to verify the ruleset. Will be closed, not merged."
```

- [ ] **Step 2: Watch `check` fail**

```bash
gh pr checks verify/blocked-merge --watch --interval 15; echo "exit=$?"
```

Expected: `check` is `fail` (`'x' is assigned a value but never used`), and the exit code is non-zero.

- [ ] **Step 3: Try to merge and get refused**

```bash
gh pr merge verify/blocked-merge --squash; echo "exit=$?"
```

Expected: refused, with an error mentioning the base branch policy or a failing required status check, and a non-zero exit code.

- [ ] **Step 4: Close the probe PR**

```bash
gh pr close verify/blocked-merge --delete-branch
git switch main && git branch -D verify/blocked-merge
```

- [ ] **Step 5: Try a direct push to `main` and get rejected**

```bash
git commit --allow-empty --no-verify -m "test: direct push probe"
git push origin main; echo "exit=$?"
```

Expected: `remote: error: GH013: Repository rule violations found for refs/heads/main`, and a non-zero exit code.

- [ ] **Step 6: Drop the local probe commit**

This only removes the empty probe commit that was just created and rejected.

```bash
git reset --hard origin/main && git status --short --branch
```

Expected: `## main...origin/main` with no changes.

---

## M1 done when

- [ ] `npm run check` passes on a fresh clone with Node 24.
- [ ] `main` contains exactly the spec commit and the squash-merged M1 PR.
- [ ] The ruleset blocked a PR with a failing check and rejected a direct push (Task 15).
- [ ] Secret scanning push protection, Dependabot alerts and security updates are enabled.

**Next:** write `docs/plans/2026-10-13-m2-api-data.md` (API, Drizzle, migrations, grants, Testcontainers) against the merged M1 state.
