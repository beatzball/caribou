# Caribou Plan 1 — Monorepo Skeleton + First Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Caribou monorepo with full workspace tooling (pnpm + Changesets + shared tsconfig/eslint), a CI/CD pipeline that enforces affected-graph testing and requires a changeset per PR, a scaffolded `apps/caribou-elena` that renders a placeholder landing page, a working Dockerfile, and a first successful deploy to `caribou.quest` via Coolify. No auth, no Mastodon integration — that is Plan 2.

**Architecture:** pnpm workspace root with two shared tooling packages (`@beatzball/caribou-tsconfig`, `@beatzball/caribou-eslint-config`). One app (`apps/caribou-elena`) scaffolded from the Litro `fullstack` recipe with the Elena adapter in SSR mode. Changesets handles versioning for all packages (even private ones) and drives the in-app changelog later. CI runs typecheck + lint + unit on the pnpm affected graph for PRs and the full workspace on push-to-main; E2E runs Playwright across Chromium/Firefox/WebKit with an axe-core a11y gate. Deploy is a Coolify webhook triggered from CI on green main pushes.

**Tech Stack:** Node 22, pnpm 10.28, TypeScript 5.7, Litro + Elena + Nitro, Vitest + happy-dom, Playwright + `@axe-core/playwright`, Changesets, Dockerfile on `node:22-alpine`, Coolify for deployment.

---

## Exit Criteria

All of the following must be true before this plan is considered done:

1. `pnpm install` at the repo root succeeds from a clean clone.
2. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all pass locally.
3. `pnpm dev` starts the app at `http://localhost:3000` and `/` renders "Caribou".
4. `pnpm dev:portless` starts the app behind a Portless HTTPS tunnel.
5. CI is green on `main`: `checks`, `e2e`, `changeset-check`, `deploy` jobs all succeed.
6. Branch protection on `main` requires all of the above.
7. `GET https://caribou.quest/` returns 200 with "Caribou" in the body.
8. `GET https://caribou.quest/api/health` returns `{ "status": "ok", "version": "<sha>" }`.
9. Coolify health check is green.
10. `pnpm changeset status --since=main` on a PR correctly identifies missing changesets and blocks merge.

---

## File Structure

### Created by this plan

```
caribou/
├── .changeset/
│   ├── config.json
│   └── README.md
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── release.yml
├── .gitignore
├── .npmrc
├── .prettierrc.json
├── apps/
│   └── caribou-elena/            # scaffolded by `pnpm create @beatzball/litro`
│       ├── Dockerfile
│       ├── package.json          # rewritten post-scaffold
│       ├── playwright.config.ts  # may be scaffolded; tune
│       ├── pages/
│       │   └── index.ts          # placeholder <caribou-landing>
│       ├── server/
│       │   └── routes/
│       │       └── api/
│       │           └── health.ts
│       ├── tests/
│       │   └── smoke.spec.ts     # Playwright smoke
│       ├── tsconfig.json
│       └── vitest.config.ts      # placeholder unit config (scaffolded)
├── packages/
│   ├── eslint-config/
│   │   ├── index.js
│   │   └── package.json
│   └── tsconfig/
│       ├── app.json
│       ├── base.json
│       ├── library.json
│       └── package.json
├── pnpm-workspace.yaml
├── package.json                  # replaces existing stub
├── README.md
└── tsconfig.json
```

### Modified by this plan

- `package.json` (existing stub expanded into real root manifest).

### NOT created by this plan

- `packages/auth`, `packages/state`, `packages/mastodon-client`, `packages/design-tokens`, `packages/ui-headless` — created in Plan 2+.
- OAuth routes, `/signin/*`, user stores — Plan 2.

---

## Pre-flight

### Task 0: Worktree setup

**Files:** none (git plumbing)

- [ ] **Step 1: Confirm you are on `main` with a clean tree**

```bash
git status
```

Expected output includes `On branch main` and `nothing to commit, working tree clean` (the only commit is the spec). If the tree is not clean, stash or commit before continuing.

- [ ] **Step 2: Create the implementation worktree**

```bash
git worktree add ../caribou-worktrees/01-monorepo-skeleton -b 01-monorepo-skeleton
cd ../caribou-worktrees/01-monorepo-skeleton
```

Expected: `Preparing worktree (new branch '01-monorepo-skeleton')` and `HEAD is now at <sha> docs: add Caribou v1 design spec`.

- [ ] **Step 3: Verify local git identity is inherited from the main checkout**

```bash
git config --get user.name
git config --get user.email
```

Expected:
```
beatzball
github@beatzball.com
```

If they are wrong, set them with `git config --local user.name beatzball` and `git config --local user.email github@beatzball.com`.

All subsequent tasks in this plan run inside `../caribou-worktrees/01-monorepo-skeleton`.

---

## Phase A — Workspace foundation

### Task 1: Root workspace config

**Files:**
- Create: `.gitignore`
- Create: `.npmrc`
- Create: `.prettierrc.json`
- Create: `pnpm-workspace.yaml`
- Modify: `package.json` (currently a stub — expand it)
- Create: `tsconfig.json`
- Create: `README.md`

- [ ] **Step 1: Write `.gitignore`**

```
node_modules/
dist/
.output/
.nitro/
.nuxt/
.cache/
coverage/
.playwright/
playwright-report/
test-results/
.DS_Store
*.log
.vscode/
.idea/
.env
.env.local
.turbo/
```

- [ ] **Step 2: Write `.npmrc`**

```
strict-peer-dependencies=true
auto-install-peers=false
shamefully-hoist=false
```

- [ ] **Step 3: Write `.prettierrc.json`**

```json
{
  "semi": false,
  "singleQuote": true,
  "printWidth": 100,
  "trailingComma": "all",
  "arrowParens": "always"
}
```

- [ ] **Step 4: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 5: Overwrite `package.json` with the real root manifest**

```json
{
  "name": "caribou",
  "private": true,
  "version": "0.0.0",
  "description": "Caribou — a Mastodon client built on Litro + Elena.",
  "packageManager": "pnpm@10.28.0",
  "engines": {
    "node": ">=22",
    "pnpm": ">=10.28.0"
  },
  "scripts": {
    "dev": "pnpm --filter caribou-elena dev",
    "dev:portless": "pnpm --filter caribou-elena dev:portless",
    "build": "pnpm -r build",
    "preview": "pnpm --filter caribou-elena preview",
    "preview:portless": "pnpm --filter caribou-elena preview:portless",
    "test": "pnpm -r test",
    "test:coverage": "pnpm -r test:coverage",
    "test:e2e": "pnpm --filter caribou-elena test:e2e",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "devDependencies": {
    "@changesets/cli": "^2.27.0",
    "@changesets/changelog-github": "^0.5.0",
    "prettier": "^3.3.3",
    "typescript": "^5.7.3"
  }
}
```

- [ ] **Step 6: Write root `tsconfig.json` (project-references placeholder)**

```json
{
  "files": [],
  "references": [
    { "path": "./packages/tsconfig" },
    { "path": "./packages/eslint-config" },
    { "path": "./apps/caribou-elena" }
  ]
}
```

- [ ] **Step 7: Write `README.md`**

```markdown
# Caribou

A Mastodon client built on Litro + Elena. Ships to caribou.quest.

## Monorepo layout

- `apps/caribou-elena` — the primary Caribou app (Elena adapter, SSR).
- `packages/*` — shared workspace packages (tsconfig, eslint config, and future framework-agnostic Mastodon/auth/state code).

## Prerequisites

- Node 22+
- pnpm 10.28+ (via corepack: `corepack enable`)

## Getting started

```
pnpm install
pnpm dev
```

Open http://localhost:3000.

For OAuth round-trips against real Mastodon instances, use the Portless HTTPS tunnel:

```
pnpm dev:portless
```

## Testing

```
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

## Contributing

Every PR must include a changeset (or an explicit `--empty` one for docs-only changes):

```
pnpm changeset
```

All work happens in disposable worktrees off `main`; PRs are squash-merged.

## Design

See `docs/superpowers/specs/2026-04-21-caribou-v1-design.md`.
```

- [ ] **Step 8: Install pnpm 10.28 via corepack and install root devDeps**

```bash
corepack enable
corepack prepare pnpm@10.28.0 --activate
pnpm install
```

Expected: `pnpm` prints "Lockfile is up to date" (or creates one), installs 4 devDependencies, 0 errors.

- [ ] **Step 9: Commit**

```bash
git add .gitignore .npmrc .prettierrc.json pnpm-workspace.yaml package.json tsconfig.json README.md pnpm-lock.yaml
git commit -m "feat: workspace root configuration"
```

### Task 2: Shared tsconfig package

**Files:**
- Create: `packages/tsconfig/package.json`
- Create: `packages/tsconfig/base.json`
- Create: `packages/tsconfig/app.json`
- Create: `packages/tsconfig/library.json`

- [ ] **Step 1: Write `packages/tsconfig/package.json`**

```json
{
  "name": "@beatzball/caribou-tsconfig",
  "version": "0.0.0",
  "private": true,
  "description": "Shared TypeScript configs for Caribou packages and apps.",
  "files": [
    "base.json",
    "app.json",
    "library.json"
  ],
  "type": "module"
}
```

- [ ] **Step 2: Write `packages/tsconfig/base.json`**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 3: Write `packages/tsconfig/app.json`**

```json
{
  "extends": "./base.json",
  "compilerOptions": {
    "types": ["node"],
    "allowJs": false,
    "noEmit": true
  }
}
```

- [ ] **Step 4: Write `packages/tsconfig/library.json`**

```json
{
  "extends": "./base.json",
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "outDir": "dist",
    "rootDir": "src",
    "noEmit": false
  },
  "include": ["src"],
  "exclude": ["dist", "node_modules", "**/*.test.ts"]
}
```

- [ ] **Step 5: Run pnpm install to register the new package**

```bash
pnpm install
```

Expected: `+ @beatzball/caribou-tsconfig 0.0.0 (workspace:...)` or similar.

- [ ] **Step 6: Commit**

```bash
git add packages/tsconfig/ pnpm-lock.yaml
git commit -m "feat(tsconfig): add shared TypeScript configs"
```

### Task 3: Shared ESLint config package

**Files:**
- Create: `packages/eslint-config/package.json`
- Create: `packages/eslint-config/index.js`

- [ ] **Step 1: Write `packages/eslint-config/package.json`**

```json
{
  "name": "@beatzball/caribou-eslint-config",
  "version": "0.0.0",
  "private": true,
  "description": "Shared ESLint flat config for Caribou.",
  "type": "module",
  "main": "./index.js",
  "exports": {
    ".": "./index.js"
  },
  "files": ["index.js"],
  "peerDependencies": {
    "eslint": "^9.0.0"
  },
  "dependencies": {
    "@typescript-eslint/eslint-plugin": "^8.18.0",
    "@typescript-eslint/parser": "^8.18.0",
    "globals": "^15.14.0"
  }
}
```

- [ ] **Step 2: Write `packages/eslint-config/index.js`**

```js
import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import globals from 'globals'

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      '**/dist/**',
      '**/.output/**',
      '**/.nitro/**',
      '**/.cache/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/node_modules/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
    },
  },
]
```

- [ ] **Step 3: Install**

```bash
pnpm install
```

- [ ] **Step 4: Commit**

```bash
git add packages/eslint-config/ pnpm-lock.yaml
git commit -m "feat(eslint-config): add shared flat config"
```

---

## Phase B — Changesets + CI skeleton

### Task 4: Changesets initialization

**Files:**
- Create: `.changeset/config.json`
- Create: `.changeset/README.md`

- [ ] **Step 1: Initialize Changesets**

```bash
pnpm changeset init
```

Expected: creates `.changeset/config.json` and `.changeset/README.md`.

- [ ] **Step 2: Overwrite `.changeset/config.json` with the Caribou config**

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": ["@changesets/changelog-github", { "repo": "beatzball/caribou" }],
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "restricted",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "privatePackages": { "version": true, "tag": true },
  "ignore": []
}
```

- [ ] **Step 3: Verify `.changeset/README.md` is the default-generated one**

Open the file and confirm it is the Changesets-generated intro. No edits needed.

- [ ] **Step 4: Create this plan's changeset**

```bash
pnpm changeset
```

Interactively select no packages (press `enter` to skip — the skeleton touches only root + tooling, which are private config, not `packages/*`). Pick `patch`. Description: `Initial monorepo skeleton: workspace tooling, Changesets, CI/CD, scaffolded caribou-elena, first Coolify deploy.`

Verify a new markdown file appears in `.changeset/` (e.g. `.changeset/slimy-bears-dance.md`).

Alternative: if Changesets refuses an empty-package selection, use `pnpm changeset --empty` instead and add the description manually.

- [ ] **Step 5: Commit**

```bash
git add .changeset/
git commit -m "feat: initialize Changesets"
```

### Task 5: CI workflow — `checks` + `changeset-check` jobs

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the initial `.github/workflows/ci.yml` (without e2e/deploy — those come in later tasks)**

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
        with: { version: 10.28.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Compute affected filter
        id: affected
        run: |
          if [[ "${{ github.event_name }}" == "pull_request" ]]; then
            echo "args=--filter ...[origin/${{ github.base_ref }}]" >> $GITHUB_OUTPUT
          else
            echo "args=-r" >> $GITHUB_OUTPUT
          fi
      - run: pnpm ${{ steps.affected.outputs.args }} typecheck
      - run: pnpm ${{ steps.affected.outputs.args }} lint
      - run: pnpm ${{ steps.affected.outputs.args }} test:coverage
      - if: always()
        uses: actions/upload-artifact@v4
        with: { name: coverage, path: '**/coverage/**' }

  changeset-check:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
        with: { version: 10.28.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm changeset status --since=origin/main
```

- [ ] **Step 2: Add placeholder `typecheck` / `lint` / `test` / `test:coverage` scripts to `packages/tsconfig/package.json`**

The `-r` filter runs a script in every package that defines it. Scripts that no-op are fine. Edit `packages/tsconfig/package.json` to add a `scripts` block:

```json
{
  "name": "@beatzball/caribou-tsconfig",
  "version": "0.0.0",
  "private": true,
  "description": "Shared TypeScript configs for Caribou packages and apps.",
  "files": [
    "base.json",
    "app.json",
    "library.json"
  ],
  "type": "module",
  "scripts": {
    "typecheck": "echo '(no ts in tsconfig package)'",
    "lint": "echo '(no js in tsconfig package)'",
    "test": "echo '(no tests in tsconfig package)'",
    "test:coverage": "echo '(no tests in tsconfig package)'"
  }
}
```

- [ ] **Step 3: Add placeholder scripts to `packages/eslint-config/package.json`**

Append a `scripts` block:

```json
  "scripts": {
    "typecheck": "echo '(config package, no ts)'",
    "lint": "echo '(config package lints itself by existing)'",
    "test": "echo '(no tests in eslint-config package)'",
    "test:coverage": "echo '(no tests in eslint-config package)'"
  }
```

The full file is now:

```json
{
  "name": "@beatzball/caribou-eslint-config",
  "version": "0.0.0",
  "private": true,
  "description": "Shared ESLint flat config for Caribou.",
  "type": "module",
  "main": "./index.js",
  "exports": {
    ".": "./index.js"
  },
  "files": ["index.js"],
  "peerDependencies": {
    "eslint": "^9.0.0"
  },
  "dependencies": {
    "@typescript-eslint/eslint-plugin": "^8.18.0",
    "@typescript-eslint/parser": "^8.18.0",
    "globals": "^15.14.0"
  },
  "scripts": {
    "typecheck": "echo '(config package, no ts)'",
    "lint": "echo '(config package lints itself by existing)'",
    "test": "echo '(no tests in eslint-config package)'",
    "test:coverage": "echo '(no tests in eslint-config package)'"
  }
}
```

- [ ] **Step 4: Verify the workspace runs its scripts locally**

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Expected: each prints the placeholder message for both packages; exit code 0.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml packages/tsconfig/package.json packages/eslint-config/package.json
git commit -m "feat(ci): add checks + changeset-check jobs"
```

### Task 6: Release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Write `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
        with: { version: 10.28.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - uses: changesets/action@v1
        with:
          version: pnpm changeset version
          commit: "chore: version packages"
          title: "chore: version packages"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "feat(ci): add Changesets release workflow"
```

### Task 7: Push the worktree branch and verify first green CI run

This task requires the GitHub repo `beatzball/caribou` to exist. If it does not, create it on GitHub (empty, no README/license/gitignore — we have our own), then:

- [ ] **Step 1: Add the remote (matching the Litro SSH host-alias pattern)**

```bash
git remote add origin git@github.com-beatzball:beatzball/caribou.git
git remote -v
```

Expected:
```
origin  git@github.com-beatzball:beatzball/caribou.git (fetch)
origin  git@github.com-beatzball:beatzball/caribou.git (push)
```

If the host alias `github.com-beatzball` is not set up, configure `~/.ssh/config` to point it at the beatzball deploy key — mirror whatever the Litro repo uses (its remote URL is `git@github.com-beatzball:beatzball/litro.git`).

- [ ] **Step 2: First push — main, so the repo has an initial commit to gate from**

Move briefly to the primary checkout:

```bash
cd ../../caribou            # adjust for your actual primary-checkout path
git push -u origin main
cd -                        # back to the worktree
```

- [ ] **Step 3: Configure branch protection on `main` (GitHub UI, one-time)**

In GitHub → repo settings → Branches → Add rule:
- Branch name pattern: `main`
- Require a pull request before merging: ON
- Require approvals: 0 (solo author; raise later if collaborators join)
- Require status checks to pass: ON — add `checks`, `changeset-check` (add `e2e` and `deploy` after they exist in later tasks)
- Require linear history: ON
- Allow squash merge only (disable merge commits and rebase-and-merge): ON

- [ ] **Step 4: Push the worktree branch**

```bash
git push -u origin 01-monorepo-skeleton
```

- [ ] **Step 5: Open a PR on GitHub**

Use `gh pr create` if the CLI is installed, otherwise open via the GitHub web UI. Title: `feat: monorepo skeleton + CI skeleton`. Body: reference the design spec section 6.

- [ ] **Step 6: Verify CI passes**

Watch the `checks` and `changeset-check` jobs. Both should succeed. Investigate any failure before continuing.

- [ ] **Step 7: DO NOT merge yet** — subsequent tasks will extend this same PR.

---

## Phase C — App scaffold

### Task 8: Scaffold `apps/caribou-elena`

**Files:** generated by `pnpm create @beatzball/litro`. Exact set varies with the create-litro version.

- [ ] **Step 1: Run the scaffolder**

```bash
mkdir -p apps
cd apps
pnpm create @beatzball/litro@latest caribou-elena \
  --recipe fullstack \
  --adapter elena \
  --mode ssr
cd ..
```

If the scaffolder prompts interactively despite the flags, answer: recipe = `fullstack`, adapter = `elena`, mode = `ssr`.

- [ ] **Step 2: Inspect what was created**

```bash
ls apps/caribou-elena
cat apps/caribou-elena/package.json
```

Note which directories and files exist. Expected roughly: `package.json`, `pages/`, `server/`, `public/`, `tsconfig.json`, `litro.config.ts` (or similar), a `Dockerfile` if the recipe includes one, and optionally `playwright.config.ts`.

- [ ] **Step 3: Remove scaffolded `.git/`, standalone lockfile, and any root-level config that duplicates ours**

```bash
rm -rf apps/caribou-elena/.git
rm -f  apps/caribou-elena/pnpm-lock.yaml
rm -f  apps/caribou-elena/.gitignore   # root covers it
rm -f  apps/caribou-elena/.prettierrc* # root covers it
```

Do NOT remove the scaffolded `Dockerfile` yet — inspect it in Task 15; we may adopt or replace.

- [ ] **Step 4: Commit the raw scaffold so later rewrites are reviewable**

```bash
git add apps/caribou-elena/
git commit -m "feat(app): scaffold caribou-elena via create-litro fullstack recipe"
```

### Task 9: Integrate scaffold into workspace

**Files:**
- Modify: `apps/caribou-elena/package.json`
- Modify: `apps/caribou-elena/tsconfig.json`
- Create: `apps/caribou-elena/eslint.config.js`

- [ ] **Step 1: Rewrite `apps/caribou-elena/package.json`**

Preserve the scaffolded `dependencies` and `devDependencies` exactly (they are picked by the recipe and you should not second-guess them). Replace only the metadata block and scripts to integrate with the workspace:

```json
{
  "name": "caribou-elena",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "imports": {
    "#litro/page-manifest": "./server/stubs/page-manifest.ts"
  },
  "scripts": {
    "dev": "litro dev",
    "dev:portless": "portless run litro dev",
    "build": "litro build",
    "preview": "litro preview",
    "preview:portless": "portless run litro preview",
    "generate": "litro generate",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@beatzball/litro": "latest",
    "@elenajs/core": "^1.0.0",
    "@elenajs/ssr": "^1.0.0-alpha.10",
    "h3": "^1.13.0"
  },
  "devDependencies": {
    "@beatzball/caribou-eslint-config": "workspace:*",
    "@beatzball/caribou-tsconfig": "workspace:*",
    "@playwright/test": "^1.48.0",
    "@vitest/coverage-v8": "^2.1.0",
    "@axe-core/playwright": "^4.10.0",
    "eslint": "^9.0.0",
    "happy-dom": "^15.0.0",
    "nitropack": "^2.13.1",
    "typescript": "^5.7.3",
    "vite": "^5.4.11",
    "vitest": "^2.1.0"
  }
}
```

If the scaffolder used different versions of the shared deps (`@beatzball/litro`, `@elenajs/core`, `h3`, `nitropack`, `vite`), keep its versions — they match what the recipe was tested against.

- [ ] **Step 2: Rewrite `apps/caribou-elena/tsconfig.json` to extend the shared app config**

```json
{
  "extends": "@beatzball/caribou-tsconfig/app.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "~/*": ["./*"]
    }
  },
  "include": ["pages", "server", "tests", "*.ts", "*.config.ts"],
  "exclude": ["node_modules", ".output", ".nitro"]
}
```

- [ ] **Step 3: Write `apps/caribou-elena/eslint.config.js`**

```js
import config from '@beatzball/caribou-eslint-config'

export default config
```

- [ ] **Step 4: Install**

```bash
pnpm install
```

Expected: no errors. The `workspace:*` references resolve to the in-repo packages.

- [ ] **Step 5: Run typecheck and lint locally**

```bash
pnpm --filter caribou-elena typecheck
pnpm --filter caribou-elena lint
```

Both should pass. If typecheck fails because the scaffolded code references files we'll add later, note the specific errors and proceed — Task 10 adds the missing files.

- [ ] **Step 6: Commit**

```bash
git add apps/caribou-elena/package.json apps/caribou-elena/tsconfig.json apps/caribou-elena/eslint.config.js pnpm-lock.yaml
git commit -m "feat(app): integrate scaffold into pnpm workspace"
```

### Task 10: Health endpoint

**Files:**
- Create: `apps/caribou-elena/server/routes/api/health.ts`

- [ ] **Step 1: Write `apps/caribou-elena/server/routes/api/health.ts`**

```ts
import { defineEventHandler } from 'h3'

const version = process.env.GIT_SHA ?? 'dev'

export default defineEventHandler(() => {
  return {
    status: 'ok' as const,
    version,
  }
})
```

- [ ] **Step 2: Start dev server and verify the endpoint**

In one terminal:

```bash
pnpm dev
```

In another:

```bash
curl -s http://localhost:3000/api/health
```

Expected output:

```
{"status":"ok","version":"dev"}
```

Kill the dev server (`Ctrl-C`).

- [ ] **Step 3: Commit**

```bash
git add apps/caribou-elena/server/routes/api/health.ts
git commit -m "feat(app): add /api/health endpoint"
```

### Task 11: Landing page stub

**Files:**
- Create (or replace scaffolded): `apps/caribou-elena/pages/index.ts`
- Create: `apps/caribou-elena/pages/components/caribou-landing.ts`

The Litro fullstack recipe generates a home page. Inspect it with `cat apps/caribou-elena/pages/index.ts` — replace its content with the following so we own the shape.

- [ ] **Step 1: Write `apps/caribou-elena/pages/components/caribou-landing.ts`**

```ts
import { html, Component } from '@elenajs/core'

export class CaribouLanding extends Component {
  static tagName = 'caribou-landing'
  static props = [] as const

  render() {
    return html`
      <main>
        <h1>Caribou</h1>
        <p>A Mastodon client, coming soon.</p>
      </main>
    `
  }
}
CaribouLanding.define()
```

Note: `Component`, `html`, and `static props` are the Elena primitives. If the scaffolded imports differ (e.g. `LitroPage` from `@beatzball/litro/adapter/elena/page`), use whatever the scaffolded `pages/index.ts` imports — Elena APIs stabilize across alpha releases but the recipe version wins.

- [ ] **Step 2: Write `apps/caribou-elena/pages/index.ts`**

```ts
import { LitroPage } from '@beatzball/litro/adapter/elena/page'
import { html } from '@elenajs/core'
import './components/caribou-landing.js'

export default class HomePage extends LitroPage {
  static tagName = 'page-home'
  static props = [] as const

  render() {
    return html`
      <caribou-landing></caribou-landing>
    `
  }
}
HomePage.define()
```

If `LitroPage` is not the correct import path in the installed version of `@beatzball/litro`, check `apps/caribou-elena/node_modules/@beatzball/litro/adapter/elena/` for the correct module and adjust the import.

- [ ] **Step 3: Run dev and verify**

```bash
pnpm dev
```

Open `http://localhost:3000` in a browser. Expected: the page shows "Caribou" and "A Mastodon client, coming soon." View source — the HTML should be server-rendered (elements are present in the initial HTML, not empty shells).

Kill the dev server.

- [ ] **Step 4: Build and verify SSR output**

```bash
pnpm build
ls apps/caribou-elena/.output
```

Expected: `.output/server/index.mjs` and `.output/public/` exist.

Run the built server:

```bash
node apps/caribou-elena/.output/server/index.mjs &
sleep 2
curl -s http://localhost:3000/ | grep -o 'Caribou'
kill %1
```

Expected: `curl` finds `Caribou` in the HTML.

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/pages/
git commit -m "feat(app): landing page renders 'Caribou'"
```

### Task 12: Unit test smoke — `apps/caribou-elena`

**Files:**
- Create: `apps/caribou-elena/vitest.config.ts`
- Create: `apps/caribou-elena/tests/unit/smoke.test.ts`

- [ ] **Step 1: Write `apps/caribou-elena/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['pages/**/*.ts', 'server/**/*.ts'],
      reporter: ['text', 'lcov'],
    },
  },
})
```

- [ ] **Step 2: Write the smoke test**

```ts
import { describe, expect, it } from 'vitest'

describe('smoke', () => {
  it('runs in happy-dom', () => {
    const el = document.createElement('div')
    el.textContent = 'caribou'
    expect(el.textContent).toBe('caribou')
  })
})
```

- [ ] **Step 3: Run tests**

```bash
pnpm --filter caribou-elena test
```

Expected: 1 test passes.

- [ ] **Step 4: Commit**

```bash
git add apps/caribou-elena/vitest.config.ts apps/caribou-elena/tests/
git commit -m "test(app): add Vitest config + smoke test"
```

### Task 13: Playwright smoke E2E + a11y

**Files:**
- Modify (or create): `apps/caribou-elena/playwright.config.ts`
- Create: `apps/caribou-elena/tests/e2e/landing.spec.ts`

- [ ] **Step 1: Write `apps/caribou-elena/playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test'

const isCI = !!process.env.CI

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? [['html'], ['github']] : [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm build && node .output/server/index.mjs',
        url: 'http://localhost:3000',
        reuseExistingServer: !isCI,
        timeout: 120_000,
      },
  projects: isCI
    ? [
        { name: 'chromium', use: devices['Desktop Chrome'] },
        { name: 'firefox',  use: devices['Desktop Firefox'] },
        { name: 'webkit',   use: devices['Desktop Safari'] },
      ]
    : [
        { name: 'chromium', use: devices['Desktop Chrome'] },
      ],
})
```

- [ ] **Step 2: Write the smoke + a11y test**

```ts
import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('landing page renders', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Caribou')
})

test('landing page has no a11y violations', async ({ page }) => {
  await page.goto('/')
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})

test('health endpoint returns ok', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.status).toBe('ok')
})
```

- [ ] **Step 3: Install Playwright browsers locally (one-time)**

```bash
pnpm --filter caribou-elena exec playwright install --with-deps chromium
```

- [ ] **Step 4: Run E2E locally**

```bash
pnpm --filter caribou-elena test:e2e
```

Expected: 3 tests pass in Chromium.

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/playwright.config.ts apps/caribou-elena/tests/e2e/
git commit -m "test(app): add Playwright smoke + axe + health E2E"
```

### Task 14: Add the `e2e` CI job

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Append the `e2e` job to `.github/workflows/ci.yml`**

Insert the following block after the `checks` job and before `changeset-check`:

```yaml
  e2e:
    runs-on: ubuntu-latest
    needs: checks
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.28.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter caribou-elena exec playwright install --with-deps chromium firefox webkit
      - run: pnpm build
      - run: pnpm test:e2e
      - if: failure()
        uses: actions/upload-artifact@v4
        with: { name: playwright-report, path: apps/caribou-elena/playwright-report }
```

The complete `ci.yml` should now have three jobs: `checks`, `e2e`, `changeset-check` (in that order).

- [ ] **Step 2: Commit + push**

```bash
git add .github/workflows/ci.yml
git commit -m "feat(ci): add e2e job across Chromium/Firefox/WebKit with axe"
git push
```

- [ ] **Step 3: Verify the PR's CI passes**

Watch GitHub Actions. `checks`, `e2e`, and `changeset-check` should all succeed.

- [ ] **Step 4: Update branch protection**

In GitHub → Settings → Branches, add `e2e` to the required status checks for `main`.

---

## Phase D — Container + deploy

### Task 15: Dockerfile

**Files:**
- Create (or replace scaffolded): `apps/caribou-elena/Dockerfile`
- Create: `.dockerignore` (repo root — Docker build context is the whole workspace, not the app dir)

- [ ] **Step 1: Create repo-root `.dockerignore`**

```
**/node_modules
**/.output
**/.nitro
**/.cache
**/coverage
**/playwright-report
**/test-results
**/tests/e2e
**/*.log
.git
.github
docs
```

- [ ] **Step 2: Write `apps/caribou-elena/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7

# Stage 1: build
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
ARG GIT_SHA=dev
ENV GIT_SHA=${GIT_SHA}
RUN pnpm --filter caribou-elena build

# Stage 2: runtime
FROM node:22-alpine AS runtime
RUN apk add --no-cache tini
WORKDIR /app
RUN mkdir -p /data && chown -R node:node /data
COPY --from=builder --chown=node:node /repo/apps/caribou-elena/.output ./.output
USER node
ENV NODE_ENV=production \
    STORAGE_DIR=/data \
    PORT=3000
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", ".output/server/index.mjs"]
```

- [ ] **Step 3: Build the Docker image locally**

```bash
docker build -f apps/caribou-elena/Dockerfile -t caribou-elena:dev .
```

Expected: a successful build ending at `naming to docker.io/library/caribou-elena:dev`.

- [ ] **Step 4: Run and smoke-test**

```bash
docker run --rm -d --name caribou-smoke -p 3000:3000 -v caribou-data:/data caribou-elena:dev
sleep 3
curl -s http://localhost:3000/api/health
curl -s http://localhost:3000/ | grep -o 'Caribou'
docker stop caribou-smoke
docker volume rm caribou-data
```

Expected: `/api/health` returns `{"status":"ok","version":"dev"}` and the landing page contains `Caribou`.

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/Dockerfile .dockerignore
git commit -m "feat(app): Dockerfile for node:22-alpine runtime"
```

### Task 16: Coolify deploy webhook + CI job

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the Coolify project (one-time, UI)**

In Coolify → *Create New Resource* → *Public Repository* (or *Private* + deploy key from the beatzball SSH key). Repo: `github.com/beatzball/caribou`. Branch: `main`.

- Build pack: **Dockerfile**. Dockerfile path: `apps/caribou-elena/Dockerfile`. Build context: repo root (leave as default if the field is blank).
- Port: `3000`. Health-check path: `/api/health`.
- Domain: `caribou.quest`. Toggle *Generate automatic TLS* (Traefik/Let's Encrypt).
- *Storage* → *Add Persistent Storage* → Volume, name `caribou-data`, mount `/data`.
- Environment Variables:
  - `NODE_ENV=production`
  - `STORAGE_DIR=/data`
  - `PORT=3000`
- *Deployment* → *Webhook* → copy the deploy URL.

- [ ] **Step 2: Add the webhook URL as a GitHub secret**

Repo → Settings → Secrets and variables → Actions → New repository secret.
- Name: `COOLIFY_WEBHOOK_URL`
- Value: the URL copied from Coolify.

- [ ] **Step 3: Configure DNS**

At the `caribou.quest` registrar:
- `A` record `caribou.quest` → Coolify host IPv4.
- `AAAA` record `caribou.quest` → Coolify host IPv6 (if the host has one).

Allow up to 15 min for propagation.

- [ ] **Step 4: Append the `deploy` job to `.github/workflows/ci.yml`**

```yaml
  deploy:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    needs: [checks, e2e]
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Coolify deploy
        run: curl -fSsL -X POST "${{ secrets.COOLIFY_WEBHOOK_URL }}"
```

The complete `ci.yml` should now have four jobs in this order: `checks`, `e2e`, `changeset-check`, `deploy`. (Order in the file does not affect execution order; `needs:` does.)

- [ ] **Step 5: Commit + push**

```bash
git add .github/workflows/ci.yml
git commit -m "feat(ci): Coolify deploy trigger on main"
git push
```

- [ ] **Step 6: Verify PR CI is still green**

The `deploy` job should be *skipped* on the PR (its `if:` gate requires `push` to `main`). `checks`, `e2e`, `changeset-check` must all pass.

### Task 17: Merge and verify first deploy

**Files:** none (deployment verification)

- [ ] **Step 1: Squash-merge the PR**

Via GitHub UI → *Squash and merge*. Commit message: `feat: monorepo skeleton + first deploy`. Commit body should keep the Changesets entry reference.

- [ ] **Step 2: Watch the `deploy` job**

On the main-branch `CI` run that fires post-merge, the `deploy` job should run and emit the `curl -fSsL -X POST ...` webhook. Confirm it exits 0.

- [ ] **Step 3: Watch Coolify**

In the Coolify UI, the application should show a deployment in progress. First deploy takes ~3–5 min (full `pnpm install` + Docker build + push + health check).

- [ ] **Step 4: Verify the live site**

```bash
curl -sI https://caribou.quest/ | head -5
curl -s  https://caribou.quest/api/health
```

Expected: HTTP/200, TLS via Let's Encrypt, body `{"status":"ok","version":"<git-sha>"}`.

If the `version` still reads `dev`, the `GIT_SHA` build arg is not being forwarded by Coolify. In the Coolify app settings, add a build arg `GIT_SHA=${COOLIFY_GIT_COMMIT_SHA}` (or whatever Coolify exposes for the commit SHA — consult Coolify docs for the exact variable name).

- [ ] **Step 5: Add the `deploy` job to branch protection**

Settings → Branches → edit the `main` rule → add `deploy` to required status checks. (This will only gate *future* PRs; it does not retroactively block already-merged commits.)

- [ ] **Step 6: Remove the worktree**

From the primary checkout:

```bash
cd ../caribou              # adjust for your actual primary-checkout path
git fetch origin
git pull origin main
git worktree remove ../caribou-worktrees/01-monorepo-skeleton
git branch -D 01-monorepo-skeleton   # branch is merged; safe to delete
```

- [ ] **Step 7: Verify the Changesets release PR was opened**

The `Release` workflow fires on push to main. It should open (or update) a PR titled `chore: version packages` containing generated CHANGELOG entries. Do NOT merge it yet — we will merge the first `chore: version packages` PR when Plan 2 starts, so version bumps align with meaningful feature milestones rather than infrastructure churn.

If the release PR did not open, check Actions → Release → most recent run for errors. Common failures: missing `GITHUB_TOKEN` permissions (fix in repo Settings → Actions → General → "Workflow permissions: Read and write"), no changeset in `.changeset/` (Task 4 should have added one).

---

## Post-flight

- [ ] All 10 exit criteria listed at the top of this plan are green.
- [ ] Branch protection on `main` requires `checks`, `e2e`, `changeset-check`, `deploy`.
- [ ] `https://caribou.quest` is live.
- [ ] `https://caribou.quest/api/health` reports the correct `GIT_SHA` of the deployed commit.
- [ ] The Changesets `chore: version packages` PR is open but unmerged (intentional — wait for Plan 2).

When all of the above hold, Plan 1 is complete. Plan 2 (`auth + data layer + first timeline`) starts from a fresh worktree off `main`.
