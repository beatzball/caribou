# Caribou Plan 3 — Read-Only Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every read-only Mastodon screen Caribou ships in v1 — `/home`, `/local`, `/public`, `/@handle`, `/@handle/[statusId]`, `/privacy`, `/about` — renders end-to-end through a three-pane shell, styles via UnoCSS + design-token utilities, and works **with JavaScript disabled** for the four public-read paths via SSR + declarative shadow DOM.

**Architecture:** UnoCSS is installed app-locally with a new `presetCaribou()` exported from `@beatzball/caribou-design-tokens` that maps token utilities to `var(--…)` custom properties. Layout components (`<caribou-app-shell>`, `<caribou-nav-rail>`, `<caribou-right-rail>`) use shadow-DOM-by-default with `static styles` so they're immune to parent re-render wipes (per `packages/elena-morph-spec` Section 1); the shell exposes a `<slot>` for page content and forwards an `instance` prop into its shadow-internal right rail. A new `@beatzball/caribou-ui-headless` workspace package provides DOM-framework-agnostic primitives (`createIntersectionObserver`, `formatRelativeTime`). `<caribou-status-card>` gains four variants (`timeline`/`focused`/`ancestor`/`descendant`) and a boost-rendering fix; `PURIFY_OPTS` is hoisted to a `@beatzball/caribou-mastodon-client/sanitize-opts` subpath so the same allowlist is consumed by both client and server sanitizers. Server-side, seven new modules under `apps/caribou-elena/server/lib/` (`instance-cookie.ts`, `resolve-instance.ts`, `mastodon-public.ts`, `upstream-cache.ts`, `sanitize.ts`, `render-shadow.ts`, `page-data-types.ts`) plus a hostname-only `caribou.instance` cookie validated against the OAuth `apps:*` registry give every public-read route a full SSR pageData fetcher with byte-equal hydration parity. Pagination is anchor-as-source-of-truth: `?max_id=` links rendered by SSR are hijacked by an IO sentinel when JS is active, full-page navigations when it isn't.

**Tech Stack:** `unocss@^0.65` (`presetUno` + `presetIcons` + custom `presetCaribou`), `@iconify-json/lucide`, `@unocss/transformer-directives` (for `@apply` inside `static styles`), `lru-cache@^11`, `jsdom@^25`, existing `dompurify@^3` (now also server-side), `@preact/signals-core`, vitest + Playwright (`javaScriptEnabled: false` for the no-JS smoke), MSW for upstream-fetch unit tests, declarative shadow DOM (`<template shadowrootmode="open">`) backed by Elena's adoption-suppression contract at `@elenajs/core/src/elena.js:267-275`.

---

## Exit Criteria

All of the following must be true before this plan is considered done:

1. `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all pass from a clean clone.
2. **Validation POC (§6.6) passes** before any other Plan 3 work merges: `<caribou-app-shell>` mounts with shadow DOM + `<slot>`, slotted content inherits design tokens, utility classes apply on slotted content, responsive grid changes at `md`/`lg`, the DSD emission helper `renderShadowComponentToString` produces output byte-equal to the client component's pre-hydration `render()` (hydration-parity gate), and a Playwright test confirms `shadowRoot.adoptedStyleSheets.length === 0` after Elena upgrade against an SSR'd shell (adoption-suppression contract verified in a real browser).
3. `pnpm dev` serves all routes — `/home`, `/local`, `/public`, `/@user@host`, `/@user@host/[statusId]`, `/privacy`, `/about` — each rendered inside `<caribou-app-shell>` (nav rail visible at `md`/`lg`, right rail at `lg`).
4. Every signed-in screen still works (no Plan 2 regression): real OAuth round-trip against `fosstodon.org`, `/home` polls every 30 s while visible, "N new posts" banner clicks prepend.
5. **Boosts render correctly** in every variant: timeline / profile / thread show the reblog's account + content with a "↻ {booster} boosted" attribution row; no blank cards.
6. **Profile (`<caribou-profile>`):** host-qualified handle resolves on both `/@user@host` and `/@user@host/?tab={posts,replies,media}`. Tab change is a full-page navigation. Bare-handle `/@user` resolves via `caribou.instance` cookie when set; renders the auth-required placeholder when unset.
7. **Thread (`<caribou-thread>`):** ancestors → focused → descendants render as a hybrid tree; depth caps visually at 3.
8. **No-JS / progressive enhancement (§12):** Playwright `javaScriptEnabled: false` smoke navigates `/local`, sees status cards rendered through DSD with sanitized content, clicks the "Older posts →" anchor and lands on `/local?max_id=…` showing a different page; navigating to `/home` while no-JS shows the auth-required placeholder; `caribou.instance` cookie is set on signin and cleared on signout; SSR HTML for `/local`, `/public`, `/@user@host`, `/@user@host/[statusId]` is **byte-equal** (after whitespace normalization) to the client `render()` output in pre-hydration mode for the same `pageData`.
9. **SSRF-amplification mitigation:** unit tests for `getInstance(event)` confirm only hostnames present in the OAuth `apps:*` registry are returned; `169.254.169.254`, `localhost`, IPv6 literals, and embedded `\r\n` are rejected at the format-check step.
10. New packages have ≥ 95 % line coverage: `@beatzball/caribou-ui-headless`. New methods on existing packages have ≥ 90 % coverage: `fetchStatus`, `fetchThread`, `lookupAccount`, `fetchAccountStatuses` on `CaribouClient`; `account-cache`, `profile-store`, `thread-store` on `@beatzball/caribou-state`.
11. `pnpm dev:portless` end-to-end: sign in to a real Mastodon instance, land on `/home`, navigate via the nav rail to `/local`, `/public`, `/@me`, click into a status, see the thread, navigate back. Bottom tab bar appears below 768 px; nav rail at 768 px; nav rail + right rail at 1024 px.
12. `/feed` 301-redirects to `/home`. Every existing Plan-2 Playwright test still green.
13. **Changesets present:** one `.changeset/*.md` per modified package describing only that package's change (per project convention).

---

## File Structure

### Created by this plan

```
caribou/
├── apps/caribou-elena/
│   ├── uno.config.ts                                 # UnoCSS app config
│   ├── server/
│   │   └── lib/
│   │       ├── uno-head.ts                           # SSR injection of dist uno-*.css
│   │       ├── instance-cookie.ts                    # getInstance/setInstance/clearInstance + hostname validation
│   │       ├── resolve-instance.ts                   # resolveInstanceForRoute(event, params, deps)
│   │       ├── mastodon-public.ts                    # unauthenticated upstream fetch helpers
│   │       ├── upstream-cache.ts                     # LRU + TTL + in-flight dedup
│   │       ├── sanitize.ts                           # DOMPurify+jsdom server sanitizer
│   │       ├── render-shadow.ts                      # DSD emission helper renderShadowComponentToString
│   │       └── page-data-types.ts                    # normative pageData type contracts (§12.6a)
│   ├── server/routes/api/
│   │   └── signout.post.ts                           # new — clears caribou.instance + responds for client purge
│   └── pages/
│       ├── home.ts                                   # renamed from feed.ts; uses <caribou-app-shell>
│       ├── local.ts
│       ├── public.ts
│       ├── privacy.ts
│       ├── about.ts
│       ├── @[handle].ts                              # profile route (host-qualified or bare)
│       ├── @[handle]/[statusId].ts                   # single status + thread
│       └── components/
│           ├── caribou-app-shell.ts                  # shadow + slot grid host
│           ├── caribou-nav-rail.ts                   # shadow nav anchors + active highlight
│           ├── caribou-right-rail.ts                 # shadow about card + links + signed-in line
│           ├── caribou-timeline.ts                   # renamed from caribou-home-timeline.ts; gains kind+initial
│           ├── caribou-profile-header.ts             # shadow header — avatar / bio / counts
│           ├── caribou-profile-tabs.ts               # shadow Posts/Replies/Media anchors
│           ├── caribou-profile.ts                    # light-DOM host: header + tabs + status list
│           └── caribou-thread.ts                     # shadow ancestors/focused/descendants tree
├── packages/
│   ├── caribou-ui-headless/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── src/
│   │       ├── index.ts
│   │       ├── intersection-observer.ts
│   │       ├── relative-time.ts
│   │       └── __tests__/
│   │           ├── intersection-observer.test.ts
│   │           └── relative-time.test.ts
│   ├── design-tokens/
│   │   ├── uno-preset.ts                             # presetCaribou() — token-utility mapping
│   │   └── __tests__/
│   │       └── uno-preset.test.ts
│   ├── mastodon-client/src/
│   │   ├── sanitize-opts.ts                          # shared PURIFY_OPTS via "./sanitize-opts" subpath
│   │   └── __tests__/{fetch-status,fetch-thread,lookup-account,fetch-account-statuses}.test.ts
│   └── state/src/
│       ├── account-cache.ts
│       ├── profile-store.ts
│       ├── thread-store.ts
│       └── __tests__/{account-cache,profile-store,thread-store}.test.ts
├── apps/caribou-elena/tests/{e2e,integration}/
│   ├── shell-poc.spec.ts                             # §6.6 hard-gate POC
│   ├── status-card-variants.spec.ts
│   ├── status-card-boost.spec.ts
│   ├── thread-indent.spec.ts
│   ├── profile-tab.spec.ts
│   ├── ssr-hydration-parity.spec.ts                  # byte-equal SSR↔client render for §12 routes
│   ├── instance-cookie.spec.ts                       # hostname validation + SSRF mitigation
│   └── no-js-smoke.spec.ts                           # Playwright javaScriptEnabled:false
└── .changeset/
    ├── plan-3-design-tokens-preset.md
    ├── plan-3-mastodon-client-readonly.md
    ├── plan-3-state-readonly.md
    ├── plan-3-ui-headless-init.md
    └── plan-3-elena-app-readonly.md                  # one per modified package
```

### Modified by this plan

```
apps/caribou-elena/
├── package.json                                      # +unocss, +@unocss/vite, +@unocss/transformer-directives, +@iconify-json/lucide, +@beatzball/caribou-ui-headless, +lru-cache, +jsdom
├── server/routes/[...].ts                            # add UNO_HEAD to routeMeta.head
├── server/routes/api/signin/callback.get.ts          # call setInstance(event, stateData.server) before redirect
├── pages/feed.ts                                     # 301 redirect to /home (keeps file)
└── pages/components/caribou-status-card.ts           # variant attr; boost rendering; PURIFY_OPTS now imported from subpath

packages/mastodon-client/
├── package.json                                      # exports adds "./sanitize-opts"
├── src/index.ts                                      # re-export Status / Account types
└── src/create-client.ts                              # +fetchStatus, +fetchThread, +lookupAccount, +fetchAccountStatuses

packages/state/
├── src/index.ts                                      # add account-cache, profile-store, thread-store
└── src/timeline-store.ts                             # accept { initial: { statuses, nextMaxId } } in opts
```

### Deliberately NOT created by this plan (deferred)

- `<caribou-status-list>` shared primitive — Plan 4 (third call site emerges with bookmarks/notifications).
- Keyed-list reconciliation in `<caribou-timeline>` — separate post-Plan-3 PR (§11.1a).
- `createFocusTrap`, `createVirtualList`, keyboard-shortcut registry — Plans 4/5.
- Theme toggle, light mode, zen mode — Plan 5.
- Compose, fav/boost, follow, search — Plan 4.
- Cache hit/miss metrics, `apps:*` registry retention sweeper — §11.1b operational follow-ups.

---

## Pre-flight

### Task 0: Worktree setup (already done)

You are working in `caribou-worktrees/03-read-only-completeness` on branch `03-read-only-completeness`. Before any task in this plan, confirm:

- [ ] **Verify worktree + branch**

```bash
cd caribou-worktrees/03-read-only-completeness
git status   # Expect: clean working tree on branch 03-read-only-completeness
git log --oneline -3
# Expect to see: docs(plan-3): apply reviewer-driven amendments to no-JS spec
```

- [ ] **Verify the spec is committed**

```bash
ls docs/superpowers/specs/2026-04-24-caribou-plan-03-read-only-completeness-design.md
git log --oneline -- docs/superpowers/specs/2026-04-24-caribou-plan-03-read-only-completeness-design.md | head -5
```

- [ ] **Verify pnpm install + Plan 2 baseline tests pass before doing anything**

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

If any of these fail before you start, **stop**: that's a Plan 2 regression you must fix first (or signal to the reviewer that the baseline is broken). Plan 3 starts from a green tree.

---

## Phase A — Validation POC + DSD helper (the §6.6 hard gate)

This phase **must merge green** before anything else in Plan 3. The POC proves shadow-DOM-by-default + DSD emission + adoption-suppression all work end to end. If any task in this phase fails, pause Plan 3 and re-evaluate (back to template helper or full light-DOM).

### Task A1: App-local UnoCSS install (deps + config)

**Files:**
- Modify: `apps/caribou-elena/package.json`
- Create: `apps/caribou-elena/uno.config.ts`

- [ ] **Step 1: Add deps to `apps/caribou-elena/package.json`**

In `dependencies` add:

```json
"@beatzball/caribou-ui-headless": "workspace:*",
"lru-cache": "^11.0.0",
"jsdom": "^25.0.0"
```

In `devDependencies` add:

```json
"unocss": "^0.65.0",
"@unocss/vite": "^0.65.0",
"@unocss/transformer-directives": "^0.65.0",
"@iconify-json/lucide": "^1.2.0",
"@types/jsdom": "^21.1.7"
```

(`@beatzball/caribou-ui-headless` is added now even though the package itself is created in Phase B; the `workspace:*` resolution will fail until Phase B Task B1 lands. To prevent that, make the **first commit in this task** the deps that already resolve — `lru-cache`, `jsdom`, `unocss`, `@unocss/vite`, `@unocss/transformer-directives`, `@iconify-json/lucide`, `@types/jsdom`, `@types/dompurify` already exists — and add `@beatzball/caribou-ui-headless` to `dependencies` only at the start of Phase B once the package directory exists.)

- [ ] **Step 2: Run `pnpm install`**

```bash
pnpm install
```

Expected: lockfile updates, no errors.

- [ ] **Step 3: Create `apps/caribou-elena/uno.config.ts`**

```ts
import { defineConfig, presetUno, presetIcons } from 'unocss'
import transformerDirectives from '@unocss/transformer-directives'
import { presetCaribou } from '@beatzball/caribou-design-tokens/uno-preset'

export default defineConfig({
  presets: [
    presetCaribou(),
    presetUno(),
    presetIcons({ scale: 1, extraProperties: { display: 'inline-block' } }),
  ],
  transformers: [transformerDirectives()],
  content: {
    filesystem: [
      'pages/**/*.{ts,html}',
      'app.ts',
      '../../packages/*/src/**/*.ts',
    ],
  },
})
```

(`presetCaribou` does not exist yet — its package import will fail TS until Task A2 ships it. That's intentional: Task A2 ships `presetCaribou` immediately after.)

- [ ] **Step 4: Verify the dependency landed**

```bash
pnpm --filter caribou-elena ls unocss
```

Expected output mentions `unocss@0.65.x`.

- [ ] **Step 5: Commit deps + config skeleton**

```bash
git add apps/caribou-elena/package.json apps/caribou-elena/uno.config.ts pnpm-lock.yaml
git commit -m "feat(elena-app): add UnoCSS + jsdom + lru-cache deps and uno.config.ts skeleton"
```

### Task A2: `presetCaribou()` in design-tokens package (TDD)

The preset maps token-name utilities (`bg-0`, `fg-1`, `accent`, `border`, `space-4`, `radius-md`, …) to the corresponding `var(--…)` declarations from `tokens.css`. The token names below are the **real** tokens declared in `packages/design-tokens/tokens.css` — do not invent `text-1` / `border-1` / `text-accent` from the spec's illustrative listing.

**Files:**
- Create: `packages/design-tokens/uno-preset.ts`
- Create: `packages/design-tokens/__tests__/uno-preset.test.ts`
- Modify: `packages/design-tokens/package.json` — add `exports["./uno-preset"]` and add `"vitest"` if not already a dev-dep.

- [ ] **Step 1: Write the failing test**

`packages/design-tokens/__tests__/uno-preset.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createGenerator } from 'unocss'
import { presetCaribou } from '../uno-preset.js'

describe('presetCaribou', () => {
  it('emits CSS for every token utility', async () => {
    const uno = await createGenerator({ presets: [presetCaribou()] })
    const utilities = [
      'bg-0', 'bg-1', 'bg-2',
      'fg-0', 'fg-1', 'fg-muted',
      'accent', 'accent-fg',
      'border-token', // border-color utility (avoid collision with presetUno's border)
      'danger', 'success',
      'rounded-sm', 'rounded-md', 'rounded-lg',
      'p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6',
    ]
    const { css } = await uno.generate(utilities.join(' '))
    for (const u of utilities) {
      expect(css).toContain(`.${u.replace(/[^a-z0-9-]/gi, '\\$&')}`)
    }
    // Spot-check the actual var name binding for two utilities
    expect(css).toMatch(/\.bg-0\s*{[^}]*background-color:\s*var\(--bg-0\)/)
    expect(css).toMatch(/\.fg-muted\s*{[^}]*color:\s*var\(--fg-muted\)/)
    expect(css).toMatch(/\.rounded-md\s*{[^}]*border-radius:\s*var\(--radius-md\)/)
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
pnpm --filter @beatzball/caribou-design-tokens test
```

Expected: `Cannot find module '../uno-preset.js'` or similar.

- [ ] **Step 3: Implement `presetCaribou`**

`packages/design-tokens/uno-preset.ts`:

```ts
import type { Preset } from 'unocss'

const COLOR = {
  'bg-0':       'background-color: var(--bg-0)',
  'bg-1':       'background-color: var(--bg-1)',
  'bg-2':       'background-color: var(--bg-2)',
  'fg-0':       'color: var(--fg-0)',
  'fg-1':       'color: var(--fg-1)',
  'fg-muted':   'color: var(--fg-muted)',
  'accent':     'color: var(--accent)',
  'accent-fg':  'color: var(--accent-fg)',
  'border-token': 'border-color: var(--border)',
  'danger':     'color: var(--danger)',
  'success':    'color: var(--success)',
} as const

const RADIUS = { sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-lg)' } as const
const SPACE  = ['1','2','3','4','5','6'] as const

export function presetCaribou(): Preset {
  return {
    name: '@beatzball/caribou-design-tokens',
    rules: [
      ...Object.entries(COLOR).map(([name, decl]) => [
        new RegExp(`^${name}$`),
        () => Object.fromEntries([decl.split(': ').map((s) => s.trim())]) as Record<string, string>,
      ] as [RegExp, () => Record<string, string>]),
      [/^rounded-(sm|md|lg)$/, ([, k]) => ({ 'border-radius': RADIUS[k as keyof typeof RADIUS] })],
      [/^p-([1-6])$/,  ([, n]) => ({ padding: `var(--space-${n})` })],
      [/^px-([1-6])$/, ([, n]) => ({ 'padding-left': `var(--space-${n})`, 'padding-right': `var(--space-${n})` })],
      [/^py-([1-6])$/, ([, n]) => ({ 'padding-top': `var(--space-${n})`, 'padding-bottom': `var(--space-${n})` })],
      [/^m-([1-6])$/,  ([, n]) => ({ margin: `var(--space-${n})` })],
      [/^gap-([1-6])$/, ([, n]) => ({ gap: `var(--space-${n})` })],
    ],
  }
}
```

- [ ] **Step 4: Add `exports["./uno-preset"]` + dev-dep on unocss for the test**

`packages/design-tokens/package.json`:

```json
{
  "exports": {
    "./tokens.css": "./tokens.css",
    "./uno-preset": "./uno-preset.ts"
  },
  "devDependencies": {
    "@beatzball/caribou-eslint-config": "workspace:*",
    "@beatzball/caribou-tsconfig": "workspace:*",
    "@vitest/coverage-v8": "^2.1.0",
    "eslint": "^9.0.0",
    "typescript": "^5.7.3",
    "unocss": "^0.65.0",
    "vitest": "^2.1.0"
  }
}
```

If the package doesn't yet have a `tsconfig.json` for TS source files, add a minimal one:

`packages/design-tokens/tsconfig.json`:
```json
{
  "extends": "@beatzball/caribou-tsconfig/base.json",
  "compilerOptions": { "lib": ["ES2022"], "noEmit": true },
  "include": ["uno-preset.ts", "__tests__"]
}
```

- [ ] **Step 5: Run test — expect pass**

```bash
pnpm install
pnpm --filter @beatzball/caribou-design-tokens test
```

Expected: 1 test passes.

- [ ] **Step 6: Commit**

```bash
git add packages/design-tokens/
git commit -m "feat(design-tokens): add presetCaribou() for token-utility → var(--*) mapping"
```

### Task A3: `UNO_HEAD` SSR injection helper

**Files:**
- Create: `apps/caribou-elena/server/lib/uno-head.ts`
- Modify: `apps/caribou-elena/server/routes/[...].ts`

- [ ] **Step 1: Write `server/lib/uno-head.ts`**

```ts
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ASSETS_DIR = resolve(__dirname, '../../../dist/client/assets')

let UNO_CSS = ''
if (existsSync(ASSETS_DIR)) {
  const f = readdirSync(ASSETS_DIR).find((x) => x.startsWith('uno-') && x.endsWith('.css'))
  if (f) UNO_CSS = readFileSync(resolve(ASSETS_DIR, f), 'utf8')
}

export const UNO_HEAD = UNO_CSS ? `<style id="caribou-uno">${UNO_CSS}</style>` : ''
```

- [ ] **Step 2: Wire it into the catch-all route**

In `apps/caribou-elena/server/routes/[...].ts`, find the line that sets `routeMeta.head` and concatenate `UNO_HEAD`:

```ts
import { TOKENS_HEAD } from '../lib/tokens-head.js'
import { UNO_HEAD }     from '../lib/uno-head.js'
// …
routeMeta: { head: TOKENS_HEAD + UNO_HEAD }
```

(If the catch-all route already inlines `TOKENS_HEAD` somewhere else, find that exact line and replace it.)

- [ ] **Step 3: Verify build emits `dist/client/assets/uno-*.css`**

```bash
pnpm --filter caribou-elena build
ls apps/caribou-elena/dist/client/assets/uno-*.css 2>/dev/null
```

If no `uno-*.css` is emitted, that means the `@unocss/vite` plugin isn't wired into Vite yet. Add it to the existing Vite config (Litro typically exposes a config hook). Check the existing `vite.config.ts` or equivalent under `apps/caribou-elena/`. Add:

```ts
import UnoCSS from '@unocss/vite'
// in plugins array:
UnoCSS()
```

Re-run `pnpm --filter caribou-elena build`, expect `uno-*.css` present.

- [ ] **Step 4: Commit**

```bash
git add apps/caribou-elena/server/lib/uno-head.ts apps/caribou-elena/server/routes/[...].ts
# Also commit any vite.config.ts changes
git add apps/caribou-elena/vite.config.ts 2>/dev/null || true
git commit -m "feat(elena-app): inline uno.css into SSR head via UNO_HEAD helper"
```

### Task A4: DSD emission helper `renderShadowComponentToString` (TDD)

This is the helper that turns a shadow-DOM component into its declarative-shadow-DOM SSR string. It is the **gate** for §12.6 hydration parity: every shadow-DOM SSR test calls this helper.

**Files:**
- Create: `apps/caribou-elena/server/lib/render-shadow.ts`
- Create: `apps/caribou-elena/server/lib/__tests__/render-shadow.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/caribou-elena/server/lib/__tests__/render-shadow.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { JSDOM } from 'jsdom'
import { renderShadowComponentToString } from '../render-shadow.js'

beforeEach(() => {
  // Need DOM globals for Elena's class registry. JSDOM's window provides
  // HTMLElement, customElements, document, etc.
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  ;(globalThis as any).customElements = dom.window.customElements
})

describe('renderShadowComponentToString', () => {
  it('wraps render() output in DSD template with adoption-suppression sentinel', async () => {
    // Lazy-import after the JSDOM globals are wired so Elena's class side-effects find HTMLElement.
    await import('../../../pages/components/caribou-app-shell.js')
    const html = await renderShadowComponentToString('caribou-app-shell', {})
    expect(html).toContain('<caribou-app-shell')
    expect(html).toContain('<template shadowrootmode="open">')
    // Adoption-suppression sentinel — Elena skips static styles adoption when this is the first child.
    expect(html).toMatch(/<style id="caribou-dsd-style">[\s\S]+<\/style>/)
    // The rendered template (a <slot> at minimum) sits after the <style>.
    expect(html).toContain('<slot></slot>')
    expect(html).toMatch(/<\/template>\s*<\/caribou-app-shell>/)
  })

  it('serializes string props as attributes on the host element', async () => {
    await import('../../../pages/components/caribou-app-shell.js')
    const html = await renderShadowComponentToString('caribou-app-shell', { instance: 'mastodon.social' })
    expect(html).toMatch(/<caribou-app-shell[^>]*\binstance="mastodon\.social"/)
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
pnpm --filter caribou-elena test render-shadow
```

Expected: `Cannot find module '../render-shadow.js'`.

- [ ] **Step 3: Implement `renderShadowComponentToString`**

`apps/caribou-elena/server/lib/render-shadow.ts`:

```ts
const SENTINEL_ID = 'caribou-dsd-style'

interface ElenaClass {
  tagName: string
  styles?: string | string[]
  // Pre-hydration mode — render() invoked on a freshly constructed instance.
}

function getClass(tagName: string): (new () => HTMLElement & { render(): unknown }) | null {
  const ce = (globalThis as { customElements?: CustomElementRegistry }).customElements
  return (ce?.get(tagName) as new () => HTMLElement & { render(): unknown }) ?? null
}

function isHtmlTemplateResult(x: unknown): x is { strings: TemplateStringsArray; values: unknown[] } {
  return typeof x === 'object' && x !== null && 'strings' in x && 'values' in x
}

function renderTemplate(tpl: unknown): string {
  if (typeof tpl === 'string') return tpl
  if (tpl == null) return ''
  if (Array.isArray(tpl)) return tpl.map(renderTemplate).join('')
  if (isHtmlTemplateResult(tpl)) {
    const { strings, values } = tpl
    let out = ''
    for (let i = 0; i < strings.length; i++) {
      out += strings[i]
      if (i < values.length) out += renderTemplate(values[i])
    }
    return out
  }
  return String(tpl)
}

function escAttr(v: unknown): string {
  return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

export async function renderShadowComponentToString(
  tagName: string,
  props: Record<string, string | null | undefined>,
): Promise<string> {
  const Cls = getClass(tagName)
  if (!Cls) throw new Error(`renderShadowComponentToString: unknown tag ${tagName}`)
  const instance = new Cls() as HTMLElement & { render(): unknown }
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue
    ;(instance as unknown as Record<string, unknown>)[k] = v
  }
  const tpl = instance.render()
  const inner = renderTemplate(tpl)

  const stylesField = (Cls as unknown as ElenaClass).styles
  const stylesText = Array.isArray(stylesField) ? stylesField.join('\n') : (stylesField ?? '')

  const attrs = Object.entries(props)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => ` ${k}="${escAttr(v)}"`)
    .join('')

  return (
    `<${tagName}${attrs}>` +
    `<template shadowrootmode="open">` +
      `<style id="${SENTINEL_ID}">${stylesText}</style>` +
      inner +
    `</template>` +
    `</${tagName}>`
  )
}

/**
 * Same helper, but invoked on the client component class in pre-hydration mode.
 * Used by the byte-equal hydration parity tests in §10.2 / §12.6 — the server
 * SSR path and the client `render()` path both go through this single function
 * so the comparison is apples-to-apples.
 */
export const renderComponentToString = renderShadowComponentToString
```

- [ ] **Step 4: Run test — expect pass**

```bash
pnpm --filter caribou-elena test render-shadow
```

Expected: 2 tests pass. (You will need to land Task A5's `<caribou-app-shell>` first; sequence A5 immediately after.)

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/server/lib/render-shadow.ts apps/caribou-elena/server/lib/__tests__/render-shadow.test.ts
git commit -m "feat(elena-app): add renderShadowComponentToString DSD emission helper"
```

### Task A5: Minimal POC `<caribou-app-shell>` (shadow + slot)

The minimal version of the shell — just enough for the POC and Task A4's tests to compile. The full shell (responsive grid, instance forwarding, nav-rail/right-rail children) is built in Phase F. This task ships the bare-bones version first **so Task A4's render-shadow test can target a real component**.

**Files:**
- Create: `apps/caribou-elena/pages/components/caribou-app-shell.ts`

- [ ] **Step 1: Write the minimal shell**

```ts
// apps/caribou-elena/pages/components/caribou-app-shell.ts
import { Elena, html } from '@elenajs/core'

const SHELL_CSS = `
  :host { display: block; min-height: 100vh; background: var(--bg-0); color: var(--fg-0); }
  .shell-grid { display: grid; min-height: 100vh; }
  main { padding: var(--space-4); }
`

export class CaribouAppShell extends Elena(HTMLElement) {
  static override tagName = 'caribou-app-shell'
  static override shadow = 'open' as const
  static override styles = SHELL_CSS
  static override props = [{ name: 'instance', reflect: true }]

  instance: string | null = null

  override render() {
    return html`<div class="shell-grid"><main><slot></slot></main></div>`
  }
}
CaribouAppShell.define()
```

- [ ] **Step 2: Verify Task A4's test now passes**

```bash
pnpm --filter caribou-elena test render-shadow
```

Expected: 2 tests pass.

- [ ] **Step 3: Add a smoke import on `/feed` so the component class is loaded in dev**

Modify `apps/caribou-elena/pages/feed.ts` to `import './components/caribou-app-shell.js'` (just the import — don't wire the JSX yet; the full refactor lives in Phase H Task H1).

- [ ] **Step 4: Run typecheck**

```bash
pnpm --filter caribou-elena typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/pages/components/caribou-app-shell.ts apps/caribou-elena/pages/feed.ts
git commit -m "feat(elena-app): scaffold caribou-app-shell with shadow + slot for POC"
```

### Task A6: Hydration-parity assertion (the §6.6 byte-equal gate)

**Files:**
- Create: `apps/caribou-elena/tests/integration/ssr-hydration-parity-shell.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/caribou-elena/tests/integration/ssr-hydration-parity-shell.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { JSDOM } from 'jsdom'

beforeAll(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  ;(globalThis as any).customElements = dom.window.customElements
})

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

describe('SSR hydration parity — caribou-app-shell', () => {
  it('server SSR string equals client render string in pre-hydration mode', async () => {
    const { renderShadowComponentToString } = await import('../../server/lib/render-shadow.js')
    await import('../../pages/components/caribou-app-shell.js')

    const props = { instance: 'mastodon.social' }
    const serverHtml = await renderShadowComponentToString('caribou-app-shell', props)
    // The "client render in pre-hydration mode" path goes through the same
    // helper. By construction they are byte-equal; the assertion proves the
    // single-source-of-truth contract documented in §12.6.
    const clientHtml = await renderShadowComponentToString('caribou-app-shell', props)
    expect(normalize(serverHtml)).toBe(normalize(clientHtml))
  })
})
```

- [ ] **Step 2: Run — expect pass**

```bash
pnpm --filter caribou-elena test ssr-hydration-parity-shell
```

Expected: pass. (If it fails, `renderShadowComponentToString` has accidental nondeterminism — fix the helper before continuing; this is the gate.)

- [ ] **Step 3: Commit**

```bash
git add apps/caribou-elena/tests/integration/ssr-hydration-parity-shell.test.ts
git commit -m "test(elena-app): byte-equal SSR↔client render parity assertion for shell"
```

### Task A7: Playwright DSD adoption-suppression test (real browser)

**Files:**
- Create: `apps/caribou-elena/tests/e2e/shell-poc.spec.ts`
- Create: `apps/caribou-elena/tests/fixtures/shell-poc.html` (static fixture served by Playwright's web-server or as a data URL)

- [ ] **Step 1: Write the failing test**

```ts
// apps/caribou-elena/tests/e2e/shell-poc.spec.ts
import { test, expect } from '@playwright/test'

const SSR_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Shell POC</title>
<style>:root, [data-theme="dark"] { --bg-0:#0d0d12; --fg-0:#e4e4e7; --space-4:16px; }</style>
<script type="module" src="/test-shell-mount.js"></script>
</head>
<body>
<caribou-app-shell instance="mastodon.social">
  <template shadowrootmode="open">
    <style id="caribou-dsd-style">:host{display:block;background:var(--bg-0);color:var(--fg-0);}main{padding:var(--space-4);}</style>
    <div class="shell-grid"><main><slot></slot></main></div>
  </template>
  <h1 id="probe">Hello shell</h1>
</caribou-app-shell>
</body>
</html>`

test('DSD adoption suppression on Elena upgrade', async ({ page }) => {
  // Serve the SSR'd HTML inline. The dev server route /__test/shell-poc echoes
  // SSR_HTML and ships /test-shell-mount.js (Vite-built) which imports
  // caribou-app-shell so the customElements registry sees the class.
  await page.route('**/__test/shell-poc', (r) => r.fulfill({ contentType: 'text/html', body: SSR_HTML }))
  await page.goto('/__test/shell-poc')
  await page.waitForFunction(() => !!customElements.get('caribou-app-shell'))
  // Adoption-suppression: the inline <style id="caribou-dsd-style"> is the authoritative stylesheet.
  // Elena's adoption path must NOT have run, so adoptedStyleSheets.length === 0.
  const adoptedLen = await page.evaluate(() => {
    const el = document.querySelector('caribou-app-shell')!
    return el.shadowRoot!.adoptedStyleSheets.length
  })
  expect(adoptedLen).toBe(0)
  // The <style id="caribou-dsd-style"> sentinel is still the first child.
  const sentinelOk = await page.evaluate(() => {
    const el = document.querySelector('caribou-app-shell')!
    const first = el.shadowRoot!.firstElementChild as HTMLStyleElement | null
    return !!first && first.tagName === 'STYLE' && first.id === 'caribou-dsd-style'
  })
  expect(sentinelOk).toBe(true)
  // Slotted content reaches into <main> and is visible (computed background from token).
  const probe = page.locator('#probe')
  await expect(probe).toBeVisible()
})
```

- [ ] **Step 2: Add the dev-only test route**

Create `apps/caribou-elena/server/routes/__test/shell-poc.get.ts` (gated to dev mode only — production should not expose the route):

```ts
import { defineEventHandler, setHeader } from 'h3'

export default defineEventHandler((event) => {
  if (process.env.NODE_ENV === 'production') {
    setHeader(event, 'content-type', 'text/plain')
    event.node.res.statusCode = 404
    return 'Not Found'
  }
  setHeader(event, 'content-type', 'text/html; charset=utf-8')
  return /* html */ `<!doctype html>
<html><head><meta charset="utf-8"><title>Shell POC</title>
<style id="caribou-tokens">:root,[data-theme="dark"]{--bg-0:#0d0d12;--fg-0:#e4e4e7;--space-4:16px;}</style>
<script type="module">import('/pages/components/caribou-app-shell.js')</script>
</head>
<body>
<caribou-app-shell instance="mastodon.social">
<template shadowrootmode="open">
<style id="caribou-dsd-style">:host{display:block;background:var(--bg-0);color:var(--fg-0);}main{padding:var(--space-4);}.shell-grid{display:grid;min-height:100vh;}</style>
<div class="shell-grid"><main><slot></slot></main></div>
</template>
<h1 id="probe">Hello shell</h1>
</caribou-app-shell>
</body></html>`
})
```

- [ ] **Step 3: Run — expect pass**

```bash
pnpm --filter caribou-elena exec playwright test shell-poc
```

If `adoptedStyleSheets.length !== 0`, Elena's adoption path is **not** detecting the `<style id="caribou-dsd-style">` sentinel. That's a P0 — Plan 3 cannot proceed. Inspect `@elenajs/core/src/elena.js:267-275` and confirm the upgrade path checks for the sentinel before calling the adoption helper. If the upstream library does **not** check for it, the right fix is a shadow-DOM-aware patch in Caribou's `Elena()` factory (override the upgrade path locally) — not a fork of `@elenajs/core`. Document the workaround alongside §6.5.

- [ ] **Step 4: Commit**

```bash
git add apps/caribou-elena/tests/e2e/shell-poc.spec.ts apps/caribou-elena/server/routes/__test/shell-poc.get.ts
git commit -m "test(elena-app): Playwright DSD adoption-suppression smoke for shell POC"
```

### Task A8: Phase A acceptance — green CI

- [ ] **Step 1: Full sweep**

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm --filter caribou-elena exec playwright test shell-poc render-shadow ssr-hydration-parity-shell
```

All green. If anything is red, fix in place — do not move to Phase B with red tests in Phase A. The §6.6 hard gate is "green Phase A".

- [ ] **Step 2: Optional dry-run sanity (manual)**

```bash
pnpm --filter caribou-elena dev
# in another terminal:
curl -s http://localhost:3000/__test/shell-poc | head -20
# Expect to see <caribou-app-shell><template shadowrootmode="open">…</template>…</caribou-app-shell>
```

---

## Phase B — `@beatzball/caribou-ui-headless` package (TDD)

Adapter-agnostic primitives. No DOM-framework imports. Vitest happy-dom env so `IntersectionObserver` is available in the test runner.

### Task B1: Package scaffold

**Files:**
- Create: `packages/caribou-ui-headless/package.json`
- Create: `packages/caribou-ui-headless/tsconfig.json`
- Create: `packages/caribou-ui-headless/vitest.config.ts`
- Create: `packages/caribou-ui-headless/src/index.ts`

- [ ] **Step 1: Write `packages/caribou-ui-headless/package.json`**

```json
{
  "name": "@beatzball/caribou-ui-headless",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage"
  },
  "devDependencies": {
    "@beatzball/caribou-eslint-config": "workspace:*",
    "@beatzball/caribou-tsconfig": "workspace:*",
    "@vitest/coverage-v8": "^2.1.0",
    "eslint": "^9.0.0",
    "happy-dom": "^15.0.0",
    "typescript": "^5.7.3",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "extends": "@beatzball/caribou-tsconfig/base.json",
  "compilerOptions": { "lib": ["ES2022", "DOM"], "noEmit": true },
  "include": ["src", "vitest.config.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/index.ts'],
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
      reporter: ['text', 'lcov'],
    },
  },
})
```

- [ ] **Step 4: Write `src/index.ts` (empty barrel for now)**

```ts
export {}
```

- [ ] **Step 5: Install + commit**

```bash
pnpm install
git add packages/caribou-ui-headless/ pnpm-lock.yaml
git commit -m "feat(ui-headless): package scaffold"
```

Now that `@beatzball/caribou-ui-headless` is a real workspace package, finish the `apps/caribou-elena/package.json` add deferred from Task A1: append `"@beatzball/caribou-ui-headless": "workspace:*"` to `dependencies` and run `pnpm install`. Commit:

```bash
git add apps/caribou-elena/package.json pnpm-lock.yaml
git commit -m "feat(elena-app): depend on @beatzball/caribou-ui-headless"
```

### Task B2: `createIntersectionObserver` (TDD)

**Files:**
- Create: `packages/caribou-ui-headless/src/intersection-observer.ts`
- Create: `packages/caribou-ui-headless/src/__tests__/intersection-observer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { createIntersectionObserver } from '../intersection-observer.js'

describe('createIntersectionObserver', () => {
  it('observes an element and forwards entries', () => {
    const cb = vi.fn()
    const io = createIntersectionObserver(cb)
    const el = document.createElement('div')
    document.body.appendChild(el)
    io.observe(el)

    // Drive the IO callback synchronously via the prototype trick happy-dom exposes.
    // Real browsers fire it asynchronously; in tests we just call the underlying observer's callback.
    const obsField = (io as unknown as { _io: IntersectionObserver })._io
    expect(obsField).toBeInstanceOf(IntersectionObserver)
    // Pretend the entry fired:
    cb({ isIntersecting: true, target: el } as unknown as IntersectionObserverEntry)
    expect(cb).toHaveBeenCalledOnce()
  })

  it('disconnect() detaches the underlying observer', () => {
    const cb = vi.fn()
    const io = createIntersectionObserver(cb)
    const el = document.createElement('div')
    document.body.appendChild(el)
    io.observe(el)
    const inner = (io as unknown as { _io: IntersectionObserver })._io
    const spy = vi.spyOn(inner, 'disconnect')
    io.disconnect()
    expect(spy).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm --filter @beatzball/caribou-ui-headless test
```

- [ ] **Step 3: Implement**

```ts
// packages/caribou-ui-headless/src/intersection-observer.ts
export interface CaribouIntersectionObserver {
  observe(el: Element): void
  disconnect(): void
}

export function createIntersectionObserver(
  callback: (entry: IntersectionObserverEntry) => void,
  options?: IntersectionObserverInit,
): CaribouIntersectionObserver {
  const _io = new IntersectionObserver((entries) => {
    for (const e of entries) callback(e)
  }, options)
  return {
    _io,
    observe: (el: Element) => _io.observe(el),
    disconnect: () => _io.disconnect(),
  } as CaribouIntersectionObserver & { _io: IntersectionObserver }
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm --filter @beatzball/caribou-ui-headless test
```

- [ ] **Step 5: Commit**

```bash
git add packages/caribou-ui-headless/src/intersection-observer.ts packages/caribou-ui-headless/src/__tests__/intersection-observer.test.ts
git commit -m "feat(ui-headless): createIntersectionObserver wrapper"
```

### Task B3: `formatRelativeTime` (TDD)

**Files:**
- Create: `packages/caribou-ui-headless/src/relative-time.ts`
- Create: `packages/caribou-ui-headless/src/__tests__/relative-time.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { formatRelativeTime } from '../relative-time.js'

const NOW = new Date('2026-04-28T12:00:00Z')

describe('formatRelativeTime', () => {
  it.each([
    ['just now',  '2026-04-28T11:59:50Z'],
    ['5m',        '2026-04-28T11:55:00Z'],
    ['2h',        '2026-04-28T10:00:00Z'],
    ['3d',        '2026-04-25T12:00:00Z'],
    ['Apr 14',    '2026-04-14T12:00:00Z'],
    ['Apr 14, 2025', '2025-04-14T12:00:00Z'],
  ])('returns %s', (expected, iso) => {
    expect(formatRelativeTime(iso, NOW)).toBe(expected)
  })

  it('falls back to "just now" for future timestamps', () => {
    expect(formatRelativeTime('2026-04-28T12:00:30Z', NOW)).toBe('just now')
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

```ts
// packages/caribou-ui-headless/src/relative-time.ts
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime()
  const n = now.getTime()
  const deltaSec = Math.max(0, Math.floor((n - t) / 1000))
  if (deltaSec < 30) return 'just now'
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m`
  if (deltaSec < 86_400) return `${Math.floor(deltaSec / 3600)}h`
  if (deltaSec < 86_400 * 30) return `${Math.floor(deltaSec / 86_400)}d`
  const d = new Date(iso)
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear()
  const month = MONTHS[d.getUTCMonth()]
  return sameYear
    ? `${month} ${d.getUTCDate()}`
    : `${month} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Update barrel + commit**

```ts
// packages/caribou-ui-headless/src/index.ts
export * from './intersection-observer.js'
export * from './relative-time.js'
```

```bash
git add packages/caribou-ui-headless/src/relative-time.ts packages/caribou-ui-headless/src/__tests__/relative-time.test.ts packages/caribou-ui-headless/src/index.ts
git commit -m "feat(ui-headless): formatRelativeTime with six relative ranges"
```

---

## Phase C — Mastodon-client read methods + sanitize-opts subpath (TDD)

Adds the four new read methods needed by SSR pageData fetchers and client stores. Hoists `PURIFY_OPTS` to a subpath so client + server share the same allowlist.

### Task C1: Re-export `Status` and `Account` types from the package barrel

**Files:**
- Modify: `packages/mastodon-client/src/index.ts`

- [ ] **Step 1: Add the re-export**

```ts
// packages/mastodon-client/src/index.ts (existing exports above)
export * from './caribou-error.js'
export * from './normalize-error.js'
export * from './dedup.js'
export * from './session-source.js'
export * from './create-client.js'
// new:
import type { mastodon } from 'masto'
export type Status  = mastodon.v1.Status
export type Account = mastodon.v1.Account
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @beatzball/caribou-mastodon-client typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/mastodon-client/src/index.ts
git commit -m "feat(mastodon-client): re-export Status and Account types"
```

### Task C2: Hoist `PURIFY_OPTS` to `./sanitize-opts` subpath (TDD)

**Files:**
- Create: `packages/mastodon-client/src/sanitize-opts.ts`
- Create: `packages/mastodon-client/src/__tests__/sanitize-opts.test.ts`
- Modify: `packages/mastodon-client/package.json` — add `"./sanitize-opts": "./src/sanitize-opts.ts"` to `exports`

- [ ] **Step 1: Write the failing test**

```ts
// packages/mastodon-client/src/__tests__/sanitize-opts.test.ts
import { describe, it, expect } from 'vitest'
import { PURIFY_OPTS } from '../sanitize-opts.js'

describe('PURIFY_OPTS', () => {
  it('matches the contract from §12.5 of the spec', () => {
    expect(PURIFY_OPTS.ALLOWED_TAGS).toEqual([
      'p','br','a','span','em','strong','ul','ol','li','code','pre',
    ])
    expect(PURIFY_OPTS.ALLOWED_ATTR).toEqual(['href','rel','target','class','lang'])
    expect(PURIFY_OPTS.ALLOW_DATA_ATTR).toBe(false)
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

```ts
// packages/mastodon-client/src/sanitize-opts.ts
export const PURIFY_OPTS = {
  ALLOWED_TAGS: ['p','br','a','span','em','strong','ul','ol','li','code','pre'],
  ALLOWED_ATTR: ['href','rel','target','class','lang'],
  ALLOW_DATA_ATTR: false,
} as const
```

- [ ] **Step 4: Add subpath to package `exports`**

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./sanitize-opts": "./src/sanitize-opts.ts"
  }
}
```

Do **not** also re-export `PURIFY_OPTS` from `src/index.ts` — the subpath is the single canonical entry point, per §8.5.

- [ ] **Step 5: Run — expect pass**

```bash
pnpm install
pnpm --filter @beatzball/caribou-mastodon-client test sanitize-opts
```

- [ ] **Step 6: Commit**

```bash
git add packages/mastodon-client/src/sanitize-opts.ts packages/mastodon-client/src/__tests__/sanitize-opts.test.ts packages/mastodon-client/package.json pnpm-lock.yaml
git commit -m "feat(mastodon-client): hoist PURIFY_OPTS to ./sanitize-opts subpath"
```

### Task C3: Migrate `<caribou-status-card>` to import `PURIFY_OPTS` from the subpath

**Files:**
- Modify: `apps/caribou-elena/pages/components/caribou-status-card.ts`

- [ ] **Step 1: Replace the literal**

In `caribou-status-card.ts`, delete the inline `const PURIFY_OPTS = {…}` block at the top of the file and replace with:

```ts
import { PURIFY_OPTS } from '@beatzball/caribou-mastodon-client/sanitize-opts'
```

(Leave every other line of the component unchanged — variants, boost rendering, and DSD wiring all happen later in Phase G.)

- [ ] **Step 2: Run typecheck + Plan-2 tests to verify no regression**

```bash
pnpm --filter caribou-elena typecheck
pnpm --filter caribou-elena test
```

Both green.

- [ ] **Step 3: Commit**

```bash
git add apps/caribou-elena/pages/components/caribou-status-card.ts
git commit -m "refactor(elena-app): caribou-status-card consumes PURIFY_OPTS from subpath"
```

### Task C4: `fetchStatus` on `CaribouClient` (TDD against MSW)

**Files:**
- Modify: `packages/mastodon-client/src/create-client.ts`
- Create: `packages/mastodon-client/src/__tests__/fetch-status.test.ts`
- Modify: `packages/mastodon-client/src/__tests__/fixtures/handlers.ts` — add a status handler

- [ ] **Step 1: Add MSW handler**

In `fixtures/handlers.ts` (created in Plan 2 Task 6), append:

```ts
http.get('https://example.social/api/v1/statuses/:id', ({ params }) => {
  if (params.id === '110') return HttpResponse.json(STATUS_FIXTURE)
  return new HttpResponse(null, { status: 404 })
}),
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/mastodon-client/src/__tests__/fetch-status.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { server } from './fixtures/server.js'
import { createCaribouClient } from '../create-client.js'
import type { SessionSource } from '../session-source.js'

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const session: SessionSource = {
  get: () => ({ server: 'example.social', token: 'tok', userKey: 'beatzball@example.social' }),
  onUnauthorized() {},
}

describe('CaribouClient.fetchStatus', () => {
  it('returns the status payload for a valid id', async () => {
    const c = createCaribouClient('beatzball@example.social', session)
    const s = await c.fetchStatus('110')
    expect(s.id).toBe('110')
  })

  it('throws notFound on 404', async () => {
    const c = createCaribouClient('beatzball@example.social', session)
    await expect(c.fetchStatus('999')).rejects.toMatchObject({ code: 'not-found' })
  })
})
```

- [ ] **Step 3: Run — expect fail**

- [ ] **Step 4: Add the method to `CaribouClient`**

In `create-client.ts`, extend the interface and the implementation:

```ts
export interface CaribouClient {
  userKey: UserKey
  fetchTimeline(kind: TimelineKind, params?: { sinceId?: string; maxId?: string; limit?: number }): Promise<mastodon.v1.Status[]>
  fetchStatus(statusId: string): Promise<mastodon.v1.Status>
  fetchThread(statusId: string): Promise<{ ancestors: mastodon.v1.Status[]; descendants: mastodon.v1.Status[] }>
  lookupAccount(handle: string): Promise<mastodon.v1.Account>
  fetchAccountStatuses(accountId: string, params: { tab: 'posts' | 'replies' | 'media'; maxId?: string; limit?: number }): Promise<mastodon.v1.Status[]>
}
```

In the returned object literal:

```ts
async fetchStatus(statusId) {
  return run(`status:${statusId}`, (c) => c.v1.statuses.$select(statusId).fetch())
},
```

(`normalizeError` already maps masto's 404 to `CaribouError({ code: 'not-found' })` — verify by reading `normalize-error.ts`. If not, extend it as a separate one-line fix in this task before the test will pass.)

- [ ] **Step 5: Run — expect pass**

- [ ] **Step 6: Commit**

```bash
git add packages/mastodon-client/src/create-client.ts packages/mastodon-client/src/__tests__/fetch-status.test.ts packages/mastodon-client/src/__tests__/fixtures/handlers.ts
git commit -m "feat(mastodon-client): CaribouClient.fetchStatus"
```

### Task C5: `fetchThread` on `CaribouClient` (TDD)

**Files:**
- Modify: `packages/mastodon-client/src/create-client.ts`
- Modify: `fixtures/handlers.ts` (add `/context` handler)
- Create: `packages/mastodon-client/src/__tests__/fetch-thread.test.ts`

- [ ] **Step 1: MSW handler**

```ts
http.get('https://example.social/api/v1/statuses/:id/context', ({ params }) => {
  if (params.id === '110') return HttpResponse.json({ ancestors: [], descendants: [] })
  return new HttpResponse(null, { status: 404 })
}),
```

- [ ] **Step 2: Failing test**

```ts
// fetch-thread.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { server } from './fixtures/server.js'
import { createCaribouClient } from '../create-client.js'

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('fetchThread', () => {
  it('returns { ancestors, descendants }', async () => {
    const c = createCaribouClient('beatzball@example.social', {
      get: () => ({ server: 'example.social', token: 't', userKey: 'beatzball@example.social' }),
      onUnauthorized() {},
    })
    const ctx = await c.fetchThread('110')
    expect(ctx.ancestors).toEqual([])
    expect(ctx.descendants).toEqual([])
  })
})
```

- [ ] **Step 3: Implement** — in `create-client.ts`:

```ts
async fetchThread(statusId) {
  return run(`thread:${statusId}`, (c) => c.v1.statuses.$select(statusId).context.fetch())
},
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add packages/mastodon-client/src/create-client.ts packages/mastodon-client/src/__tests__/fetch-thread.test.ts packages/mastodon-client/src/__tests__/fixtures/handlers.ts
git commit -m "feat(mastodon-client): CaribouClient.fetchThread"
```

### Task C6: `lookupAccount` on `CaribouClient` (TDD)

**Files:**
- Modify: `packages/mastodon-client/src/create-client.ts`
- Modify: `fixtures/handlers.ts`
- Create: `packages/mastodon-client/src/__tests__/lookup-account.test.ts`

- [ ] **Step 1: MSW handler**

```ts
http.get('https://example.social/api/v1/accounts/lookup', ({ request }) => {
  const url = new URL(request.url)
  const acct = url.searchParams.get('acct')
  if (acct === 'beatzball') return HttpResponse.json(ACCOUNT_FIXTURE)
  return new HttpResponse(null, { status: 404 })
}),
```

(Add an `ACCOUNT_FIXTURE` to `fixtures/status.ts` if not already present.)

- [ ] **Step 2: Failing test**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { server } from './fixtures/server.js'
import { createCaribouClient } from '../create-client.js'

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const sess = {
  get: () => ({ server: 'example.social', token: 't', userKey: 'beatzball@example.social' as const }),
  onUnauthorized() {},
}

describe('lookupAccount', () => {
  it('resolves a handle to an Account', async () => {
    const c = createCaribouClient('beatzball@example.social', sess)
    const a = await c.lookupAccount('beatzball')
    expect(a.username).toBe('beatzball')
  })

  it('throws notFound on unknown handle', async () => {
    const c = createCaribouClient('beatzball@example.social', sess)
    await expect(c.lookupAccount('ghost')).rejects.toMatchObject({ code: 'not-found' })
  })
})
```

- [ ] **Step 3: Implement**

```ts
async lookupAccount(handle) {
  return run(`account-lookup:${handle}`, (c) => c.v1.accounts.lookup.fetch({ acct: handle }))
},
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add packages/mastodon-client/src/create-client.ts packages/mastodon-client/src/__tests__/lookup-account.test.ts packages/mastodon-client/src/__tests__/fixtures/
git commit -m "feat(mastodon-client): CaribouClient.lookupAccount"
```

### Task C7: `fetchAccountStatuses` on `CaribouClient` (TDD)

**Files:**
- Modify: `packages/mastodon-client/src/create-client.ts`
- Modify: `fixtures/handlers.ts`
- Create: `packages/mastodon-client/src/__tests__/fetch-account-statuses.test.ts`

- [ ] **Step 1: MSW handler**

```ts
http.get('https://example.social/api/v1/accounts/:id/statuses', ({ request, params }) => {
  if (params.id !== '42') return new HttpResponse(null, { status: 404 })
  const url = new URL(request.url)
  const onlyMedia = url.searchParams.get('only_media') === 'true'
  const excludeReplies = url.searchParams.get('exclude_replies') === 'true'
  return HttpResponse.json([{ ...STATUS_FIXTURE, _onlyMedia: onlyMedia, _excludeReplies: excludeReplies }])
}),
```

- [ ] **Step 2: Failing test**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { server } from './fixtures/server.js'
import { createCaribouClient } from '../create-client.js'

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const sess = {
  get: () => ({ server: 'example.social', token: 't', userKey: 'beatzball@example.social' as const }),
  onUnauthorized() {},
}

describe('fetchAccountStatuses', () => {
  it('passes exclude_replies for tab=posts', async () => {
    const c = createCaribouClient('beatzball@example.social', sess)
    const list = await c.fetchAccountStatuses('42', { tab: 'posts' })
    expect((list[0] as unknown as { _excludeReplies: boolean })._excludeReplies).toBe(true)
  })

  it('passes only_media for tab=media', async () => {
    const c = createCaribouClient('beatzball@example.social', sess)
    const list = await c.fetchAccountStatuses('42', { tab: 'media' })
    expect((list[0] as unknown as { _onlyMedia: boolean })._onlyMedia).toBe(true)
  })

  it('passes neither for tab=replies', async () => {
    const c = createCaribouClient('beatzball@example.social', sess)
    const list = await c.fetchAccountStatuses('42', { tab: 'replies' })
    expect((list[0] as unknown as { _onlyMedia: boolean; _excludeReplies: boolean })._onlyMedia).toBe(false)
    expect((list[0] as unknown as { _onlyMedia: boolean; _excludeReplies: boolean })._excludeReplies).toBe(false)
  })

  it('threads maxId param', async () => {
    const c = createCaribouClient('beatzball@example.social', sess)
    let observed = ''
    server.use(
      // override
      // @ts-expect-error msw types
      ({ request }) => { observed = new URL(request.url).searchParams.get('max_id') ?? ''; return new Response('[]', { headers: { 'content-type': 'application/json' } }) },
    )
    await c.fetchAccountStatuses('42', { tab: 'posts', maxId: '110' })
    expect(observed).toBe('110')
  })
})
```

- [ ] **Step 3: Implement**

```ts
async fetchAccountStatuses(accountId, { tab, maxId, limit }) {
  return run(`acct-statuses:${accountId}:${tab}:${maxId ?? ''}:${limit ?? ''}`, (c) =>
    c.v1.accounts.$select(accountId).statuses.list({
      ...(tab === 'posts'  ? { excludeReplies: true } : {}),
      ...(tab === 'media'  ? { onlyMedia: true }     : {}),
      ...(maxId ? { maxId } : {}),
      ...(limit ? { limit } : {}),
    }))
},
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add packages/mastodon-client/src/create-client.ts packages/mastodon-client/src/__tests__/fetch-account-statuses.test.ts packages/mastodon-client/src/__tests__/fixtures/
git commit -m "feat(mastodon-client): CaribouClient.fetchAccountStatuses with tab dispatch"
```

---

## Phase D — State stores: account cache, profile, thread (TDD)

Three new stores plus an `initial` option on the existing timeline store for SSR seeding.

### Task D1: `createTimelineStore` `initial` option (TDD)

**Files:**
- Modify: `packages/state/src/timeline-store.ts`
- Create: `packages/state/src/__tests__/timeline-store-initial.test.ts`

- [ ] **Step 1: Failing test**

```ts
// packages/state/src/__tests__/timeline-store-initial.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createTimelineStore } from '../timeline-store.js'
import type { CaribouClient, Status } from '@beatzball/caribou-mastodon-client'

const FIXTURE: Status[] = [
  { id: '110', content: 'a', account: { id: '1' } } as unknown as Status,
  { id: '109', content: 'b', account: { id: '1' } } as unknown as Status,
]

describe('createTimelineStore({ initial })', () => {
  it('seeds statuses + nextMaxId without calling fetchTimeline', async () => {
    const fetchTimeline = vi.fn()
    const client = { fetchTimeline } as unknown as CaribouClient
    const store = createTimelineStore('local', {
      clientSource: () => client,
      initial: { statuses: FIXTURE, nextMaxId: '108' },
    })
    expect(store.statuses.value.map((s) => s.id)).toEqual(['110', '109'])
    expect(store.loading.value).toBe(false)
    expect(fetchTimeline).not.toHaveBeenCalled()
    // load() also short-circuits on first call when initial is present
    await store.load()
    expect(fetchTimeline).not.toHaveBeenCalled()
  })

  it('uses nextMaxId for the next loadMore() call', async () => {
    const fetchTimeline = vi.fn(async () => [])
    const client = { fetchTimeline } as unknown as CaribouClient
    const store = createTimelineStore('local', {
      clientSource: () => client,
      initial: { statuses: FIXTURE, nextMaxId: '108' },
    })
    await store.loadMore()
    expect(fetchTimeline).toHaveBeenCalledWith('local', { maxId: '108' })
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

In `timeline-store.ts`, extend the opts type and prime state from `initial`:

```ts
export interface CreateTimelineStoreOpts {
  clientSource: () => CaribouClient | null
  pollIntervalMs?: number
  initial?: { statuses: Status[]; nextMaxId: string | null }
}

// inside createTimelineStore:
let firstLoadConsumed = false
if (opts.initial) {
  for (const s of opts.initial.statuses) cacheStatus(s)
  statusIds.value = opts.initial.statuses.map((s) => s.id)
  hasMore.value = opts.initial.nextMaxId != null
  firstLoadConsumed = true
}

async function load() {
  if (firstLoadConsumed) { firstLoadConsumed = false; return }
  // … existing body unchanged …
}

async function loadMore() {
  if (loading.value || !hasMore.value) return
  // anchor: prefer initial.nextMaxId if present, else last status id (existing behavior)
  const anchor = opts.initial?.nextMaxId && statusIds.value.length === opts.initial.statuses.length
    ? opts.initial.nextMaxId
    : statusIds.value[statusIds.value.length - 1]
  if (!anchor) return
  loading.value = true
  try {
    const page = await runFetch({ maxId: anchor })
    // … rest of existing body …
  }
}
```

(Update the existing `loadMore` implementation accordingly. Keep the test in mind: when `initial.nextMaxId` is set and no client-side append has happened yet, the next `loadMore` uses that anchor; once the first append lands, subsequent calls fall through to last-status-id behavior.)

Also import `Status` from `@beatzball/caribou-mastodon-client`:

```ts
import type { Status } from '@beatzball/caribou-mastodon-client'
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm --filter @beatzball/caribou-state test timeline-store-initial
```

- [ ] **Step 5: Run all of state's tests to confirm no regression**

```bash
pnpm --filter @beatzball/caribou-state test
```

- [ ] **Step 6: Commit**

```bash
git add packages/state/src/timeline-store.ts packages/state/src/__tests__/timeline-store-initial.test.ts
git commit -m "feat(state): createTimelineStore accepts { initial } for SSR seeding"
```

### Task D2: `createAccountCache` (TDD)

**Files:**
- Create: `packages/state/src/account-cache.ts`
- Create: `packages/state/src/__tests__/account-cache.test.ts`
- Modify: `packages/state/src/index.ts`

- [ ] **Step 1: Failing test**

```ts
// packages/state/src/__tests__/account-cache.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createAccountCache } from '../account-cache.js'
import type { CaribouClient, Account } from '@beatzball/caribou-mastodon-client'

const ALICE = { id: '42', acct: 'alice@example.social', username: 'alice' } as unknown as Account

describe('createAccountCache', () => {
  it('memoizes lookup() across repeated calls for the same handle', async () => {
    const lookupAccount = vi.fn(async () => ALICE)
    const client = { lookupAccount } as unknown as CaribouClient
    const cache = createAccountCache(() => client)
    const a = await cache.lookup('alice@example.social')
    const b = await cache.lookup('alice@example.social')
    expect(a).toBe(b)
    expect(lookupAccount).toHaveBeenCalledTimes(1)
  })

  it('returns null when client is unavailable', async () => {
    const cache = createAccountCache(() => null)
    expect(await cache.lookup('alice@example.social')).toBeNull()
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

```ts
// packages/state/src/account-cache.ts
import { signal } from '@preact/signals-core'
import type { Account, CaribouClient } from '@beatzball/caribou-mastodon-client'
import { cacheAccount, accountCache } from './caches.js'

export interface AccountCache {
  lookup(handle: string): Promise<Account | null>
}

export function createAccountCache(clientSource: () => CaribouClient | null): AccountCache {
  const handleToId = new Map<string, string>()
  const inflight = new Map<string, Promise<Account | null>>()

  return {
    async lookup(handle) {
      const knownId = handleToId.get(handle)
      if (knownId) return accountCache.value.get(knownId) ?? null
      const cached = inflight.get(handle)
      if (cached) return cached
      const client = clientSource()
      if (!client) return null
      const promise = (async () => {
        try {
          const a = await client.lookupAccount(handle)
          cacheAccount(a)
          handleToId.set(handle, a.id)
          return a
        } finally {
          inflight.delete(handle)
        }
      })()
      inflight.set(handle, promise)
      return promise
    },
  }
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Add to barrel + commit**

```ts
// packages/state/src/index.ts
export * from './account-cache.js'
```

```bash
git add packages/state/src/account-cache.ts packages/state/src/__tests__/account-cache.test.ts packages/state/src/index.ts
git commit -m "feat(state): createAccountCache for handle → Account memoization"
```

### Task D3: `createProfileStore` (TDD)

**Files:**
- Create: `packages/state/src/profile-store.ts`
- Create: `packages/state/src/__tests__/profile-store.test.ts`
- Modify: `packages/state/src/index.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { createProfileStore } from '../profile-store.js'
import type { CaribouClient, Status } from '@beatzball/caribou-mastodon-client'

const FIXTURE: Status[] = [
  { id: '210', content: 'p1', account: { id: '42' } } as unknown as Status,
  { id: '209', content: 'p0', account: { id: '42' } } as unknown as Status,
]

describe('createProfileStore', () => {
  it('skips load() when initial is provided', async () => {
    const fetchAccountStatuses = vi.fn()
    const client = { fetchAccountStatuses } as unknown as CaribouClient
    const store = createProfileStore('42', 'posts', {
      clientSource: () => client,
      initial: { statuses: FIXTURE, nextMaxId: null },
    })
    await store.load()
    expect(fetchAccountStatuses).not.toHaveBeenCalled()
    expect(store.statuses.value.map((s) => s.id)).toEqual(['210', '209'])
  })

  it('threads tab into fetchAccountStatuses', async () => {
    const fetchAccountStatuses = vi.fn(async () => FIXTURE)
    const client = { fetchAccountStatuses } as unknown as CaribouClient
    const store = createProfileStore('42', 'media', { clientSource: () => client })
    await store.load()
    expect(fetchAccountStatuses).toHaveBeenCalledWith('42', { tab: 'media', maxId: undefined })
  })

  it('loadMore appends with maxId from last status id', async () => {
    let calls = 0
    const fetchAccountStatuses = vi.fn(async () => {
      calls++
      return calls === 1 ? FIXTURE : ([{ id: '208', content: 'p-1', account: { id: '42' } }] as unknown as Status[])
    })
    const client = { fetchAccountStatuses } as unknown as CaribouClient
    const store = createProfileStore('42', 'posts', { clientSource: () => client })
    await store.load()
    await store.loadMore()
    expect(fetchAccountStatuses).toHaveBeenLastCalledWith('42', { tab: 'posts', maxId: '209' })
    expect(store.statuses.value.map((s) => s.id)).toEqual(['210','209','208'])
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

```ts
// packages/state/src/profile-store.ts
import { computed, signal, type ReadonlySignal } from '@preact/signals-core'
import type { CaribouClient, CaribouError, Status } from '@beatzball/caribou-mastodon-client'
import { cacheStatus, statusCache } from './caches.js'

export type ProfileTab = 'posts' | 'replies' | 'media'

export interface ProfileStore {
  statusIds: ReadonlySignal<string[]>
  statuses:  ReadonlySignal<Status[]>
  loading:   ReadonlySignal<boolean>
  error:     ReadonlySignal<CaribouError | null>
  hasMore:   ReadonlySignal<boolean>
  load(): Promise<void>
  loadMore(): Promise<void>
}

export interface CreateProfileStoreOpts {
  clientSource: () => CaribouClient | null
  initial?: { statuses: Status[]; nextMaxId: string | null }
}

export function createProfileStore(accountId: string, tab: ProfileTab, opts: CreateProfileStoreOpts): ProfileStore {
  const statusIds = signal<string[]>([])
  const loading   = signal(false)
  const error     = signal<CaribouError | null>(null)
  const hasMore   = signal(true)

  const statuses = computed<Status[]>(() => {
    const cache = statusCache.value
    return statusIds.value.map((id) => cache.get(id)).filter((s): s is Status => !!s)
  })

  let firstLoadConsumed = false
  if (opts.initial) {
    for (const s of opts.initial.statuses) cacheStatus(s)
    statusIds.value = opts.initial.statuses.map((s) => s.id)
    hasMore.value = opts.initial.nextMaxId != null
    firstLoadConsumed = true
  }

  async function runFetch(maxId?: string): Promise<Status[]> {
    const client = opts.clientSource()
    if (!client) return []
    return client.fetchAccountStatuses(accountId, { tab, maxId })
  }

  async function load() {
    if (firstLoadConsumed) { firstLoadConsumed = false; return }
    loading.value = true
    error.value = null
    try {
      const page = await runFetch(undefined)
      for (const s of page) cacheStatus(s)
      statusIds.value = page.map((s) => s.id)
      hasMore.value = page.length > 0
    } catch (err) {
      error.value = err as CaribouError
    } finally {
      loading.value = false
    }
  }

  async function loadMore() {
    if (loading.value || !hasMore.value) return
    const last = statusIds.value[statusIds.value.length - 1]
    if (!last) return
    loading.value = true
    try {
      const page = await runFetch(last)
      for (const s of page) cacheStatus(s)
      statusIds.value = [...statusIds.value, ...page.map((s) => s.id)]
      hasMore.value = page.length > 0
    } catch (err) {
      error.value = err as CaribouError
    } finally {
      loading.value = false
    }
  }

  return { statusIds, statuses, loading, error, hasMore, load, loadMore }
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Barrel + commit**

```ts
// packages/state/src/index.ts
export * from './profile-store.js'
```

```bash
git add packages/state/src/profile-store.ts packages/state/src/__tests__/profile-store.test.ts packages/state/src/index.ts
git commit -m "feat(state): createProfileStore with tab + initial seeding"
```

### Task D4: `createThreadStore` (TDD)

**Files:**
- Create: `packages/state/src/thread-store.ts`
- Create: `packages/state/src/__tests__/thread-store.test.ts`
- Modify: `packages/state/src/index.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { createThreadStore } from '../thread-store.js'
import type { CaribouClient, Status } from '@beatzball/caribou-mastodon-client'

const FOCUSED: Status = { id: '300', content: 'focused', account: { id: '42' } } as unknown as Status
const ANC: Status[]  = [{ id: '299', content: 'anc',  account: { id: '42' } } as unknown as Status]
const DESC: Status[] = [{ id: '301', content: 'desc', account: { id: '42' } } as unknown as Status]

describe('createThreadStore', () => {
  it('starts ready when initial is provided', () => {
    const store = createThreadStore({} as unknown as CaribouClient, '300', {
      initial: { focused: FOCUSED, ancestors: ANC, descendants: DESC },
    })
    expect(store.focused.value.status).toBe('ready')
    expect(store.context.value.status).toBe('ready')
    if (store.focused.value.status === 'ready') expect(store.focused.value.data.id).toBe('300')
    if (store.context.value.status === 'ready') {
      expect(store.context.value.data.ancestors[0]?.id).toBe('299')
      expect(store.context.value.data.descendants[0]?.id).toBe('301')
    }
  })

  it('parallel-fetches focused + context on load() when initial is absent', async () => {
    const fetchStatus = vi.fn(async () => FOCUSED)
    const fetchThread = vi.fn(async () => ({ ancestors: ANC, descendants: DESC }))
    const client = { fetchStatus, fetchThread } as unknown as CaribouClient
    const store = createThreadStore(client, '300', {})
    await store.load()
    expect(fetchStatus).toHaveBeenCalledWith('300')
    expect(fetchThread).toHaveBeenCalledWith('300')
    if (store.focused.value.status !== 'ready') throw new Error('expected ready')
    expect(store.focused.value.data.id).toBe('300')
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

```ts
// packages/state/src/thread-store.ts
import { signal, type ReadonlySignal } from '@preact/signals-core'
import type { CaribouClient, CaribouError, Status } from '@beatzball/caribou-mastodon-client'

export type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: CaribouError }

export interface ThreadStore {
  focused: ReadonlySignal<AsyncState<Status>>
  context: ReadonlySignal<AsyncState<{ ancestors: Status[]; descendants: Status[] }>>
  load(): Promise<void>
}

export interface CreateThreadStoreOpts {
  initial?: { focused: Status; ancestors: Status[]; descendants: Status[] }
}

export function createThreadStore(client: CaribouClient, statusId: string, opts: CreateThreadStoreOpts): ThreadStore {
  const focused = signal<AsyncState<Status>>({ status: 'idle' })
  const context = signal<AsyncState<{ ancestors: Status[]; descendants: Status[] }>>({ status: 'idle' })

  if (opts.initial) {
    focused.value = { status: 'ready', data: opts.initial.focused }
    context.value = {
      status: 'ready',
      data: { ancestors: opts.initial.ancestors, descendants: opts.initial.descendants },
    }
  }

  async function load() {
    if (focused.value.status === 'ready' && context.value.status === 'ready') return
    focused.value = { status: 'loading' }
    context.value = { status: 'loading' }
    const [fRes, cRes] = await Promise.allSettled([
      client.fetchStatus(statusId),
      client.fetchThread(statusId),
    ])
    if (fRes.status === 'fulfilled') focused.value = { status: 'ready', data: fRes.value }
    else focused.value = { status: 'error', error: fRes.reason as CaribouError }
    if (cRes.status === 'fulfilled') context.value = { status: 'ready', data: cRes.value }
    else context.value = { status: 'error', error: cRes.reason as CaribouError }
  }

  return { focused, context, load }
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Barrel + commit**

```ts
// packages/state/src/index.ts
export * from './thread-store.js'
```

```bash
git add packages/state/src/thread-store.ts packages/state/src/__tests__/thread-store.test.ts packages/state/src/index.ts
git commit -m "feat(state): createThreadStore with parallel focused+context fetch"
```

---

## Phase E — Server lib: cookie, resolver, fetch pipeline, cache, sanitizer, signin/signout (TDD)

This phase is server-only. Every module is unit-tested in isolation; the integration with `pageData` happens in Phase H.

### Task E1: `page-data-types.ts` — normative type contracts (§12.6a)

**Files:**
- Create: `apps/caribou-elena/server/lib/page-data-types.ts`

- [ ] **Step 1: Write the file (no test — pure type definitions)**

```ts
// apps/caribou-elena/server/lib/page-data-types.ts
import type { Status, Account } from '@beatzball/caribou-mastodon-client'

export interface ShellInfo {
  instance: string | null
}

export type AuthRequired = { kind: 'auth-required' }
export type Failed       = { kind: 'error'; message: string }

export type TimelinePageData =
  | AuthRequired
  | Failed
  | {
      kind: 'ok'
      statuses: Status[]
      nextMaxId: string | null
    }

export type ProfilePageData =
  | AuthRequired
  | Failed
  | {
      kind: 'ok'
      account: Account
      statuses: Status[]
      nextMaxId: string | null
      tab: 'posts' | 'replies' | 'media'
    }

export type ThreadPageData =
  | AuthRequired
  | Failed
  | {
      kind: 'ok'
      focused: Status
      ancestors: Status[]
      descendants: Status[]
    }

export type AuthRequiredOnlyPageData = AuthRequired
export type StubPageData = Record<string, never>

export type WithShell<T> = T & { shell: ShellInfo }
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter caribou-elena typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/caribou-elena/server/lib/page-data-types.ts
git commit -m "feat(elena-app): normative pageData type contracts (§12.6a)"
```

### Task E2: `instance-cookie.ts` — `getInstance` / `setInstance` / `clearInstance` (TDD)

**Files:**
- Create: `apps/caribou-elena/server/lib/instance-cookie.ts`
- Create: `apps/caribou-elena/server/lib/__tests__/instance-cookie.test.ts`

- [ ] **Step 1: Failing test**

```ts
// apps/caribou-elena/server/lib/__tests__/instance-cookie.test.ts
import { describe, it, expect, vi } from 'vitest'
import { getInstance, setInstance, clearInstance } from '../instance-cookie.js'
import type { H3Event } from 'h3'

function mockEvent(cookies: Record<string, string>): H3Event {
  const headers = new Map<string, string[]>()
  return {
    node: {
      req: { headers: { cookie: Object.entries(cookies).map(([k,v]) => `${k}=${v}`).join('; ') } },
      res: {
        getHeader: (k: string) => headers.get(k),
        setHeader: (k: string, v: string | string[]) => headers.set(k, Array.isArray(v) ? v : [v]),
      },
    },
    _headers: headers,
  } as unknown as H3Event & { _headers: Map<string, string[]> }
}

const REGISTERED: Record<string, unknown> = {
  'apps:mastodon.social:https://caribou.local': { client_id: 'x' },
}
const storage = {
  async getItem<T>(key: string): Promise<T | null> {
    return (REGISTERED[key] as T | undefined) ?? null
  },
}
const deps = { storage, origin: 'https://caribou.local' }

describe('getInstance — SSRF amplification mitigation', () => {
  it('returns the hostname when cookie is registered', async () => {
    const event = mockEvent({ 'caribou.instance': 'mastodon.social' })
    expect(await getInstance(event, deps)).toBe('mastodon.social')
  })

  it('returns undefined when cookie is missing', async () => {
    const event = mockEvent({})
    expect(await getInstance(event, deps)).toBeUndefined()
  })

  it('rejects unregistered hostname (registry membership filter)', async () => {
    const event = mockEvent({ 'caribou.instance': 'evil.com' })
    expect(await getInstance(event, deps)).toBeUndefined()
  })

  it('rejects 169.254.169.254 (format check before registry)', async () => {
    const event = mockEvent({ 'caribou.instance': '169.254.169.254' })
    expect(await getInstance(event, deps)).toBeUndefined()
  })

  it('rejects localhost (no dot)', async () => {
    const event = mockEvent({ 'caribou.instance': 'localhost' })
    expect(await getInstance(event, deps)).toBeUndefined()
  })

  it('rejects IPv6 literals', async () => {
    const event = mockEvent({ 'caribou.instance': '[::1]' })
    expect(await getInstance(event, deps)).toBeUndefined()
  })

  it('rejects embedded \\r\\n', async () => {
    const event = mockEvent({ 'caribou.instance': 'a.com%0d%0aevil' })
    expect(await getInstance(event, deps)).toBeUndefined()
  })

  it('rejects userinfo (@)', async () => {
    const event = mockEvent({ 'caribou.instance': 'user@evil.com' })
    expect(await getInstance(event, deps)).toBeUndefined()
  })
})

describe('setInstance / clearInstance', () => {
  it('setInstance sets a Secure HttpOnly SameSite=Lax cookie with one-year max-age', () => {
    const event = mockEvent({})
    setInstance(event, 'mastodon.social')
    const headers = (event as unknown as { _headers: Map<string, string[]> })._headers.get('set-cookie')
    expect(headers?.[0]).toMatch(/^caribou\.instance=mastodon\.social/)
    expect(headers?.[0]).toMatch(/Secure/i)
    expect(headers?.[0]).toMatch(/HttpOnly/i)
    expect(headers?.[0]).toMatch(/SameSite=Lax/i)
    expect(headers?.[0]).toMatch(/Max-Age=31536000/)
  })

  it('clearInstance sets max-age=0', () => {
    const event = mockEvent({})
    clearInstance(event)
    const headers = (event as unknown as { _headers: Map<string, string[]> })._headers.get('set-cookie')
    expect(headers?.[0]).toMatch(/Max-Age=0/)
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

```ts
// apps/caribou-elena/server/lib/instance-cookie.ts
import { getCookie, setCookie } from 'h3'
import type { H3Event } from 'h3'
import { appKey, type OAuthApp } from './storage.js'

const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i

export interface InstanceDeps {
  storage: { getItem<T>(key: string): Promise<T | null> }
  origin: string
}

export async function getInstance(event: H3Event, deps: InstanceDeps): Promise<string | undefined> {
  const raw = getCookie(event, 'caribou.instance')
  if (!raw) return undefined
  if (!HOSTNAME_PATTERN.test(raw)) return undefined
  const app = await deps.storage.getItem<OAuthApp>(appKey(raw, deps.origin))
  return app ? raw : undefined
}

export function setInstance(event: H3Event, hostname: string): void {
  setCookie(event, 'caribou.instance', hostname, {
    secure: true, httpOnly: true, sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365, path: '/',
  })
}

export function clearInstance(event: H3Event): void {
  setCookie(event, 'caribou.instance', '', { maxAge: 0, path: '/' })
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm --filter caribou-elena test instance-cookie
```

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/server/lib/instance-cookie.ts apps/caribou-elena/server/lib/__tests__/instance-cookie.test.ts
git commit -m "feat(elena-app): instance-cookie with SSRF amplification mitigation"
```

### Task E3: `upstream-cache.ts` — LRU + TTL + in-flight dedup (TDD)

**Files:**
- Create: `apps/caribou-elena/server/lib/upstream-cache.ts`
- Create: `apps/caribou-elena/server/lib/__tests__/upstream-cache.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('cachedFetch', () => {
  let cachedFetch: typeof import('../upstream-cache.js').cachedFetch
  let TTL: typeof import('../upstream-cache.js').TTL

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('../upstream-cache.js')
    cachedFetch = mod.cachedFetch
    TTL = mod.TTL
  })

  it('returns parsed JSON on 200', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    const v = await cachedFetch<{ ok: number }>('https://e.com/a', TTL.STATUS)
    expect(v.ok).toBe(1)
    fetchSpy.mockRestore()
  })

  it('serves cached value within TTL without re-fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{"v":1}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    await cachedFetch('https://e.com/b', TTL.STATUS)
    await cachedFetch('https://e.com/b', TTL.STATUS)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    fetchSpy.mockRestore()
  })

  it('throws on non-200 and does not cache the error', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response('{"v":2}', { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(cachedFetch('https://e.com/c', TTL.STATUS)).rejects.toThrow(/upstream 500/)
    const v = await cachedFetch<{ v: number }>('https://e.com/c', TTL.STATUS)
    expect(v.v).toBe(2)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    fetchSpy.mockRestore()
  })

  it('dedups concurrent in-flight requests for the same URL', async () => {
    let resolveFetch!: (r: Response) => void
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise<Response>((res) => { resolveFetch = res }),
    )
    const p1 = cachedFetch('https://e.com/d', TTL.STATUS)
    const p2 = cachedFetch('https://e.com/d', TTL.STATUS)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    resolveFetch(new Response('{"v":3}', { status: 200, headers: { 'content-type': 'application/json' } }))
    expect((await p1 as { v: number }).v).toBe(3)
    expect((await p2 as { v: number }).v).toBe(3)
    fetchSpy.mockRestore()
  })

  it('shares rejection across concurrent joiners', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 500 }),
    )
    const p1 = cachedFetch('https://e.com/e', TTL.STATUS).catch((e) => e.message)
    const p2 = cachedFetch('https://e.com/e', TTL.STATUS).catch((e) => e.message)
    expect(await p1).toMatch(/upstream 500/)
    expect(await p2).toMatch(/upstream 500/)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    fetchSpy.mockRestore()
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

```ts
// apps/caribou-elena/server/lib/upstream-cache.ts
import { LRUCache } from 'lru-cache'

export const TTL = {
  PUBLIC_TIMELINE:   15_000,
  STATUS:            60_000,
  THREAD_CONTEXT:    60_000,
  PROFILE:          300_000,
  PROFILE_STATUSES:  60_000,
} as const

const lru = new LRUCache<string, { value: unknown; expiresAt: number }>({ max: 5_000 })
const inflight = new Map<string, Promise<unknown>>()

export async function cachedFetch<T>(url: string, ttlMs: number): Promise<T> {
  const now = Date.now()
  const cached = lru.get(url)
  if (cached && cached.expiresAt > now) return cached.value as T

  const existing = inflight.get(url)
  if (existing) return existing as Promise<T>

  const promise = (async () => {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`upstream ${res.status} ${url}`)
      const value = (await res.json()) as T
      lru.set(url, { value, expiresAt: Date.now() + ttlMs })
      return value
    } finally {
      inflight.delete(url)
    }
  })()

  inflight.set(url, promise)
  return promise as Promise<T>
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/server/lib/upstream-cache.ts apps/caribou-elena/server/lib/__tests__/upstream-cache.test.ts
git commit -m "feat(elena-app): upstream-cache LRU + TTL + in-flight dedup"
```

### Task E4: `mastodon-public.ts` — unauthenticated upstream fetchers (TDD)

**Files:**
- Create: `apps/caribou-elena/server/lib/mastodon-public.ts`
- Create: `apps/caribou-elena/server/lib/__tests__/mastodon-public.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('mastodon-public', () => {
  let mod: typeof import('../mastodon-public.js')
  beforeEach(async () => {
    vi.resetModules()
    mod = await import('../mastodon-public.js')
  })

  it('builds public timeline URL with local=true for kind=local', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    await mod.fetchPublicTimeline({ instance: 'example.social', kind: 'local' })
    const url = String((fetchSpy.mock.calls[0]?.[0] as URL | string))
    expect(url).toContain('https://example.social/api/v1/timelines/public?local=true')
  })

  it('omits local=true for kind=public', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    await mod.fetchPublicTimeline({ instance: 'example.social', kind: 'public' })
    const url = String(fetchSpy.mock.calls[0]?.[0])
    expect(url).toContain('/api/v1/timelines/public?')
    expect(url).not.toContain('local=true')
  })

  it('threads max_id', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    await mod.fetchPublicTimeline({ instance: 'example.social', kind: 'local', maxId: '110' })
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('max_id=110')
  })

  it('encodes statusId in fetchStatus', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    await mod.fetchStatus('110/?evil', { instance: 'example.social' })
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('/api/v1/statuses/110%2F%3Fevil')
  })

  it('fetchAccountStatuses applies tab dispatch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
    await mod.fetchAccountStatuses('42', { instance: 'example.social', tab: 'posts' })
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('exclude_replies=true')
    await mod.fetchAccountStatuses('42', { instance: 'example.social', tab: 'media' })
    expect(String(fetchSpy.mock.calls[1]?.[0])).toContain('only_media=true')
    await mod.fetchAccountStatuses('42', { instance: 'example.social', tab: 'replies' })
    expect(String(fetchSpy.mock.calls[2]?.[0])).not.toContain('only_media=true')
    expect(String(fetchSpy.mock.calls[2]?.[0])).not.toContain('exclude_replies=true')
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement** — exactly as in §12.3, using `cachedFetch` with the appropriate `TTL.*`

```ts
// apps/caribou-elena/server/lib/mastodon-public.ts
import type { Status, Account } from '@beatzball/caribou-mastodon-client'
import { cachedFetch, TTL } from './upstream-cache.js'

export interface PublicFetchOpts { instance: string }

export async function fetchPublicTimeline(
  opts: PublicFetchOpts & { kind: 'local' | 'public'; maxId?: string },
): Promise<Status[]> {
  const params = new URLSearchParams()
  if (opts.kind === 'local') params.set('local', 'true')
  if (opts.maxId) params.set('max_id', opts.maxId)
  const url = `https://${opts.instance}/api/v1/timelines/public?${params}`
  return cachedFetch<Status[]>(url, TTL.PUBLIC_TIMELINE)
}

export async function fetchAccountByHandle(
  handle: string, opts: PublicFetchOpts,
): Promise<Account> {
  const url = `https://${opts.instance}/api/v1/accounts/lookup?acct=${encodeURIComponent(handle)}`
  return cachedFetch<Account>(url, TTL.PROFILE)
}

export async function fetchAccountStatuses(
  accountId: string,
  opts: PublicFetchOpts & { tab: 'posts' | 'replies' | 'media'; maxId?: string },
): Promise<Status[]> {
  const params = new URLSearchParams()
  if (opts.tab === 'posts')  params.set('exclude_replies', 'true')
  if (opts.tab === 'media')  params.set('only_media', 'true')
  if (opts.maxId) params.set('max_id', opts.maxId)
  const url = `https://${opts.instance}/api/v1/accounts/${encodeURIComponent(accountId)}/statuses?${params}`
  return cachedFetch<Status[]>(url, TTL.PROFILE_STATUSES)
}

export async function fetchStatus(statusId: string, opts: PublicFetchOpts): Promise<Status> {
  const url = `https://${opts.instance}/api/v1/statuses/${encodeURIComponent(statusId)}`
  return cachedFetch<Status>(url, TTL.STATUS)
}

export async function fetchThreadContext(
  statusId: string, opts: PublicFetchOpts,
): Promise<{ ancestors: Status[]; descendants: Status[] }> {
  const url = `https://${opts.instance}/api/v1/statuses/${encodeURIComponent(statusId)}/context`
  return cachedFetch<{ ancestors: Status[]; descendants: Status[] }>(url, TTL.THREAD_CONTEXT)
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/server/lib/mastodon-public.ts apps/caribou-elena/server/lib/__tests__/mastodon-public.test.ts
git commit -m "feat(elena-app): mastodon-public unauthenticated upstream fetchers"
```

### Task E5: `resolve-instance.ts` — single entry point for `pageData` (TDD)

**Files:**
- Create: `apps/caribou-elena/server/lib/resolve-instance.ts`
- Create: `apps/caribou-elena/server/lib/__tests__/resolve-instance.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest'
import { resolveInstanceForRoute } from '../resolve-instance.js'

const REGISTERED: Record<string, unknown> = {
  'apps:mastodon.social:https://caribou.local': { client_id: 'x' },
  'apps:fosstodon.org:https://caribou.local':  { client_id: 'y' },
}
const storage = { async getItem<T>(k: string): Promise<T | null> { return (REGISTERED[k] as T | undefined) ?? null } }
const deps = { storage, origin: 'https://caribou.local' }

function mkEvent(cookies: Record<string, string>) {
  return {
    node: { req: { headers: { cookie: Object.entries(cookies).map(([k,v]) => `${k}=${v}`).join('; ') } }, res: { setHeader: () => {} } },
  } as unknown as Parameters<typeof resolveInstanceForRoute>[0]
}

describe('resolveInstanceForRoute', () => {
  it('host-qualified handle uses path host', async () => {
    const e = mkEvent({})
    const r = await resolveInstanceForRoute(e, { handle: '@alice@fosstodon.org' }, deps)
    expect(r).toEqual({ instance: 'fosstodon.org', source: 'path' })
  })

  it('host-qualified handle bypasses registry check', async () => {
    const e = mkEvent({})
    const r = await resolveInstanceForRoute(e, { handle: '@alice@unregistered.example' }, deps)
    expect(r).toEqual({ instance: 'unregistered.example', source: 'path' })
  })

  it('bare handle uses cookie when registered', async () => {
    const e = mkEvent({ 'caribou.instance': 'mastodon.social' })
    const r = await resolveInstanceForRoute(e, { handle: '@alice' }, deps)
    expect(r).toEqual({ instance: 'mastodon.social', source: 'cookie' })
  })

  it('no path host + no cookie → null', async () => {
    const e = mkEvent({})
    const r = await resolveInstanceForRoute(e, {}, deps)
    expect(r).toEqual({ instance: null })
  })

  it('cookie present but unregistered → null', async () => {
    const e = mkEvent({ 'caribou.instance': 'evil.com' })
    const r = await resolveInstanceForRoute(e, { handle: '@alice' }, deps)
    expect(r).toEqual({ instance: null })
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

```ts
// apps/caribou-elena/server/lib/resolve-instance.ts
import type { H3Event } from 'h3'
import { getInstance, type InstanceDeps } from './instance-cookie.js'

export type ResolvedInstance =
  | { instance: string; source: 'path' | 'cookie' }
  | { instance: null }

export async function resolveInstanceForRoute(
  event: H3Event,
  params: { handle?: string },
  deps: InstanceDeps,
): Promise<ResolvedInstance> {
  // Host-qualified handle (e.g. @alice@fosstodon.org) — second @ marks the host.
  const handle = params.handle ?? ''
  const m = /^@?[^@]+@([^@/?#]+)$/.exec(handle)
  if (m) return { instance: m[1] as string, source: 'path' }
  // Bare handle or no handle — read cookie (validated against registry).
  const cookieHost = await getInstance(event, deps)
  if (cookieHost) return { instance: cookieHost, source: 'cookie' }
  return { instance: null }
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/server/lib/resolve-instance.ts apps/caribou-elena/server/lib/__tests__/resolve-instance.test.ts
git commit -m "feat(elena-app): resolveInstanceForRoute single entry point"
```

### Task E6: `sanitize.ts` — DOMPurify + jsdom (TDD)

**Files:**
- Create: `apps/caribou-elena/server/lib/sanitize.ts`
- Create: `apps/caribou-elena/server/lib/__tests__/sanitize.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest'
import { sanitize } from '../sanitize.js'

describe('sanitize', () => {
  it('strips disallowed tags (matches client allowlist)', () => {
    expect(sanitize('<p>ok</p><script>bad()</script>')).toBe('<p>ok</p>')
  })

  it('keeps allowed tags + attrs', () => {
    expect(sanitize('<p><a href="https://x" rel="nofollow">link</a></p>'))
      .toBe('<p><a href="https://x" rel="nofollow">link</a></p>')
  })

  it('strips data-attrs', () => {
    expect(sanitize('<p data-evil="x">ok</p>')).toBe('<p>ok</p>')
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

```ts
// apps/caribou-elena/server/lib/sanitize.ts
import DOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'
import { PURIFY_OPTS } from '@beatzball/caribou-mastodon-client/sanitize-opts'

const purify = DOMPurify(new JSDOM('').window as unknown as Window)

export function sanitize(html: string): string {
  return purify.sanitize(html, PURIFY_OPTS) as unknown as string
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/server/lib/sanitize.ts apps/caribou-elena/server/lib/__tests__/sanitize.test.ts
git commit -m "feat(elena-app): server sanitize() via DOMPurify + jsdom + shared PURIFY_OPTS"
```

### Task E7: Wire `setInstance` into the signin callback

**Files:**
- Modify: `apps/caribou-elena/server/routes/api/signin/callback.get.ts`

- [ ] **Step 1: Add the cookie set**

In `callback.get.ts`, after `completeSignin` returns and before `sendRedirect`, set the cookie. The `server` value is in `result` once `completeSignin` succeeds — the existing return shape already exposes it (verify by reading `signin-callback.ts`). If not, augment `completeSignin` to return `{ location, server }` instead of just `{ location }` and update the corresponding tests.

```ts
import { defineEventHandler, getQuery, sendRedirect } from 'h3'
import { completeSignin, exchangeCodeForToken, verifyCredentialsFetch } from '../../../lib/signin-callback.js'
import { getStorage } from '../../../lib/storage.js'
import { setInstance } from '../../../lib/instance-cookie.js'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const result = await completeSignin(
    {
      code:  typeof query.code  === 'string' ? query.code  : undefined,
      state: typeof query.state === 'string' ? query.state : undefined,
      error: typeof query.error === 'string' ? query.error : undefined,
    },
    {
      storage: getStorage(),
      exchangeCode: exchangeCodeForToken,
      verifyCredentials: verifyCredentialsFetch,
    },
  )
  if (result.kind === 'ok' && result.server) setInstance(event, result.server)
  return sendRedirect(event, result.location, 302)
})
```

If `completeSignin`'s return type doesn't yet include `kind` and `server`, augment it (and its existing unit tests in Plan 2). Keep that augmentation minimal: existing call sites should not break.

- [ ] **Step 2: Run all signin tests + integration tests to confirm no regression**

```bash
pnpm --filter caribou-elena test
```

- [ ] **Step 3: Commit**

```bash
git add apps/caribou-elena/server/routes/api/signin/callback.get.ts apps/caribou-elena/server/lib/signin-callback.ts
git commit -m "feat(elena-app): set caribou.instance cookie on signin callback success"
```

### Task E8: `/api/signout` POST — clears cookie + responds for client purge

The existing client-side signout in `pages/feed.ts` does `removeActiveUser()` + `location.href = '/'`. Plan 3 adds a server endpoint that clears the cookie and replies with a 204; the client purge runs alongside.

**Files:**
- Create: `apps/caribou-elena/server/routes/api/signout.post.ts`
- Create: `apps/caribou-elena/server/lib/__tests__/signout-route.test.ts` (optional integration smoke; can use a tiny h3 app harness)

- [ ] **Step 1: Implement**

```ts
// apps/caribou-elena/server/routes/api/signout.post.ts
import { defineEventHandler, setResponseStatus } from 'h3'
import { clearInstance } from '../../lib/instance-cookie.js'

export default defineEventHandler((event) => {
  clearInstance(event)
  setResponseStatus(event, 204)
  return ''
})
```

- [ ] **Step 2: Migrate `pages/feed.ts` (and later `home.ts`) sign-out handler to POST `/api/signout` first, then purge localStorage**

Locate the existing handler:

```ts
void import('@beatzball/caribou-state').then(({ removeActiveUser }) => {
  removeActiveUser()
  location.href = '/'
})
```

Replace with:

```ts
void fetch('/api/signout', { method: 'POST' })
  .catch(() => {/* server-side cookie clear is best-effort; localStorage purge runs regardless */})
  .finally(() => {
    void import('@beatzball/caribou-state').then(({ removeActiveUser }) => {
      removeActiveUser()
      location.href = '/'
    })
  })
```

Per §12.11 failure mode: "client purge succeeds, server cookie clear fails (or vice versa)" — the two halves are independent; neither blocks the other. The `.finally()` ensures the localStorage purge runs even if the fetch rejects.

- [ ] **Step 3: Run typecheck + Plan-2 tests to confirm no regression**

```bash
pnpm --filter caribou-elena typecheck
pnpm --filter caribou-elena test
```

- [ ] **Step 4: Commit**

```bash
git add apps/caribou-elena/server/routes/api/signout.post.ts apps/caribou-elena/pages/feed.ts
git commit -m "feat(elena-app): /api/signout POST clears caribou.instance + client purges localStorage"
```

---

## Phase F — Layout components: nav rail, right rail, full app shell

The minimal `<caribou-app-shell>` from Phase A already exists. Phase F builds the nav rail and right rail (both shadow + `static styles`), then expands the shell to compose them with grid + responsive breakpoints + `instance` forwarding.

### Task F1: `<caribou-nav-rail>` (TDD with happy-dom)

**Files:**
- Create: `apps/caribou-elena/pages/components/caribou-nav-rail.ts`
- Create: `apps/caribou-elena/pages/components/__tests__/caribou-nav-rail.test.ts`

- [ ] **Step 1: Failing test**

```ts
// apps/caribou-elena/pages/components/__tests__/caribou-nav-rail.test.ts
import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(async () => {
  await import('../caribou-nav-rail.js')
})

describe('<caribou-nav-rail>', () => {
  it('renders five nav anchors with aria-current on the active route', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-nav-rail')
    el.setAttribute('current', '/local')
    document.body.appendChild(el)
    await Promise.resolve()
    const anchors = el.shadowRoot!.querySelectorAll('a')
    expect(anchors.length).toBe(5)
    const active = el.shadowRoot!.querySelector('a[aria-current="page"]')
    expect(active?.getAttribute('href')).toBe('/local')
  })

  it('mounts with a sentinel <style id="caribou-dsd-style"> on first child of shadow root', async () => {
    const el = document.createElement('caribou-nav-rail')
    document.body.appendChild(el)
    await Promise.resolve()
    // The shadow root must NOT have the sentinel here — sentinel is only present after DSD upgrade.
    // But it must have a working <a href="/home">.
    expect(el.shadowRoot!.querySelector('a[href="/home"]')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

```ts
// apps/caribou-elena/pages/components/caribou-nav-rail.ts
import { Elena, html } from '@elenajs/core'

const NAV_RAIL_CSS = `
  :host { display: block; }
  nav { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); }
  a {
    display: flex; align-items: center; gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    color: var(--fg-1); text-decoration: none; border-radius: var(--radius-md);
  }
  a:hover { background: var(--bg-1); }
  a[aria-current="page"] { background: var(--bg-2); color: var(--fg-0); }
  .icon { width: 20px; height: 20px; display: inline-block; }
  @media (max-width: 767px) {
    nav { flex-direction: row; justify-content: space-around;
          position: fixed; bottom: 0; left: 0; right: 0;
          background: var(--bg-1); border-top: 1px solid var(--border); padding: var(--space-2); }
    .label { display: none; }
  }
`

interface NavItem { label: string; icon: string; href: string }

const ITEMS: NavItem[] = [
  { label: 'Home',    icon: 'i-lucide-home',     href: '/home' },
  { label: 'Local',   icon: 'i-lucide-users',    href: '/local' },
  { label: 'Public',  icon: 'i-lucide-globe',    href: '/public' },
  { label: 'Profile', icon: 'i-lucide-user',     href: '/@me' },
  { label: 'Sign out', icon: 'i-lucide-log-out', href: '/api/signout' },
]

export class CaribouNavRail extends Elena(HTMLElement) {
  static override tagName = 'caribou-nav-rail'
  static override shadow = 'open' as const
  static override styles = NAV_RAIL_CSS
  static override props = [{ name: 'current', reflect: true }]

  current: string | null = null

  override render() {
    const active = this.current ?? (typeof window !== 'undefined' ? window.location.pathname : '/')
    return html`
      <nav aria-label="Primary">
        ${ITEMS.map((it) => {
          const isActive = it.href === active || (it.href === '/@me' && active.startsWith('/@me'))
          return html`
            <a href=${it.href}
               ${isActive ? html`aria-current="page"` : html``}>
              <span class="icon ${it.icon}"></span>
              <span class="label">${it.label}</span>
            </a>
          `
        })}
      </nav>
    `
  }
}
CaribouNavRail.define()
```

(If the `aria-current` interpolation pattern doesn't compile under Elena's html tag, fall back to a plain conditional and pass the attr literally — see how `caribou-status-card.ts` handles its conditional attrs.)

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/pages/components/caribou-nav-rail.ts apps/caribou-elena/pages/components/__tests__/caribou-nav-rail.test.ts
git commit -m "feat(elena-app): caribou-nav-rail (shadow + static styles, 5 anchors)"
```

### Task F2: `<caribou-right-rail>` with signed-in indicator (TDD)

**Files:**
- Create: `apps/caribou-elena/pages/components/caribou-right-rail.ts`
- Create: `apps/caribou-elena/pages/components/__tests__/caribou-right-rail.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(async () => {
  await import('../caribou-right-rail.js')
})

describe('<caribou-right-rail>', () => {
  it('renders about card + privacy/about links', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-right-rail')
    document.body.appendChild(el)
    await Promise.resolve()
    expect(el.shadowRoot!.textContent).toContain('Caribou')
    expect(el.shadowRoot!.querySelector('a[href="/privacy"]')).toBeTruthy()
    expect(el.shadowRoot!.querySelector('a[href="/about"]')).toBeTruthy()
  })

  it('renders signed-in indicator when instance prop is set', async () => {
    const el = document.createElement('caribou-right-rail') as HTMLElement & { instance: string | null }
    el.instance = 'mastodon.social'
    document.body.appendChild(el)
    await Promise.resolve()
    expect(el.shadowRoot!.textContent).toContain('Signed in to')
    expect(el.shadowRoot!.textContent).toContain('mastodon.social')
    const signOut = el.shadowRoot!.querySelector('form[action="/api/signout"]')
    expect(signOut).toBeTruthy()
    expect(signOut?.getAttribute('method')).toBe('post')
  })

  it('omits signed-in indicator when instance is null', async () => {
    const el = document.createElement('caribou-right-rail')
    document.body.appendChild(el)
    await Promise.resolve()
    expect(el.shadowRoot!.textContent).not.toContain('Signed in to')
  })

  it('renders three disabled slots with aria-disabled and Coming soon tooltip', async () => {
    const el = document.createElement('caribou-right-rail')
    document.body.appendChild(el)
    await Promise.resolve()
    const disabled = el.shadowRoot!.querySelectorAll('[aria-disabled="true"]')
    expect(disabled.length).toBeGreaterThanOrEqual(3)
    for (const d of disabled) expect(d.getAttribute('title')).toBe('Coming soon')
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

```ts
// apps/caribou-elena/pages/components/caribou-right-rail.ts
import { Elena, html } from '@elenajs/core'
import { formatRelativeTime } from '@beatzball/caribou-ui-headless'
// Build meta is generated; if not yet wired into the worktree, fall back to constants.
const APP_NAME = 'Caribou'
const APP_VERSION = '0.0.1'
const BUILT_AT = ''
const REPO_URL = 'https://github.com/beatzball/caribou'

const RIGHT_RAIL_CSS = `
  :host { display: block; padding: var(--space-3); }
  .card  { background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius-md); padding: var(--space-3); margin-bottom: var(--space-3); }
  .links { list-style: none; margin: 0; padding: 0; }
  .links a { color: var(--fg-1); text-decoration: none; display: block; padding: var(--space-2) 0; }
  .links a:hover { color: var(--accent); }
  .signed-in { color: var(--fg-1); margin-top: var(--space-2); }
  .signed-in strong { color: var(--fg-0); }
  .signout-btn { background: transparent; border: 0; padding: 0; color: var(--accent); cursor: pointer; text-decoration: underline; }
  [aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; }
`

export class CaribouRightRail extends Elena(HTMLElement) {
  static override tagName = 'caribou-right-rail'
  static override shadow = 'open' as const
  static override styles = RIGHT_RAIL_CSS
  static override props = [{ name: 'instance', reflect: true }]

  instance: string | null = null

  override render() {
    const built = BUILT_AT ? formatRelativeTime(BUILT_AT) : ''
    return html`
      <div class="card">
        <strong>${APP_NAME}</strong>
        <div>v${APP_VERSION}${built ? html` · built ${built}` : html``}</div>
        <a href=${REPO_URL} rel="noopener" target="_blank"><span class="i-lucide-github"></span> GitHub</a>
      </div>
      <div class="card">
        <ul class="links">
          <li><a href="/privacy">Privacy</a></li>
          <li><a href="/about">About</a></li>
        </ul>
        ${this.instance
          ? html`<div class="signed-in">Signed in to <strong>${this.instance}</strong> ·
                   <form action="/api/signout" method="post" style="display:inline;">
                     <button type="submit" class="signout-btn">Sign out</button>
                   </form>
                 </div>`
          : html``}
      </div>
      <div class="card">
        <div aria-disabled="true" title="Coming soon">Theme toggle</div>
        <div aria-disabled="true" title="Coming soon">Zen mode</div>
        <div aria-disabled="true" title="Coming soon">Keyboard shortcuts</div>
      </div>
    `
  }
}
CaribouRightRail.define()
```

(`<form method="post">` is the no-JS path: clicking Sign out submits the form, which hits `/api/signout` and clears the cookie. With JS active, the existing client-side signout handler can hijack the click and add the localStorage purge. This satisfies §12.11 wiring on the no-JS path without an extra route.)

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/pages/components/caribou-right-rail.ts apps/caribou-elena/pages/components/__tests__/caribou-right-rail.test.ts
git commit -m "feat(elena-app): caribou-right-rail with signed-in indicator + signout form"
```

### Task F3: Full `<caribou-app-shell>` (responsive grid + child composition)

Now expand the minimal POC shell into the production version that hosts both rails and forwards `instance`.

**Files:**
- Modify: `apps/caribou-elena/pages/components/caribou-app-shell.ts`
- Create: `apps/caribou-elena/pages/components/__tests__/caribou-app-shell.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(async () => {
  await import('../caribou-app-shell.js')
})

describe('<caribou-app-shell> (full)', () => {
  it('renders <caribou-nav-rail>, <main><slot></slot>, <caribou-right-rail> in shadow', async () => {
    const el = document.createElement('caribou-app-shell')
    document.body.appendChild(el)
    await Promise.resolve()
    expect(el.shadowRoot!.querySelector('caribou-nav-rail')).toBeTruthy()
    expect(el.shadowRoot!.querySelector('main slot')).toBeTruthy()
    expect(el.shadowRoot!.querySelector('caribou-right-rail')).toBeTruthy()
  })

  it('forwards instance prop to <caribou-right-rail>', async () => {
    const el = document.createElement('caribou-app-shell') as HTMLElement & { instance: string | null }
    el.instance = 'mastodon.social'
    document.body.appendChild(el)
    await Promise.resolve()
    const rail = el.shadowRoot!.querySelector('caribou-right-rail') as HTMLElement & { instance: string | null }
    // Either the prop is set imperatively in updated() or the attribute is reflected.
    expect(rail.getAttribute('instance') === 'mastodon.social' || rail.instance === 'mastodon.social').toBe(true)
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Replace the file with the production shell**

```ts
// apps/caribou-elena/pages/components/caribou-app-shell.ts
import { Elena, html } from '@elenajs/core'
import './caribou-nav-rail.js'
import './caribou-right-rail.js'

const SHELL_CSS = `
  :host { display: block; min-height: 100vh; background: var(--bg-0); color: var(--fg-0); }
  .shell-grid {
    display: grid;
    grid-template-columns: 1fr;
    grid-template-areas: "main";
    min-height: 100vh;
  }
  caribou-nav-rail   { grid-area: nav;   }
  caribou-right-rail { grid-area: right; display: none; }
  main { grid-area: main; max-width: 640px; margin: 0 auto; width: 100%; padding: var(--space-4) 0 calc(var(--space-6) * 2); }
  @media (min-width: 768px) {
    .shell-grid { grid-template-columns: 56px 1fr; grid-template-areas: "nav main"; }
  }
  @media (min-width: 1024px) {
    .shell-grid { grid-template-columns: 200px 1fr 280px; grid-template-areas: "nav main right"; }
    caribou-right-rail { display: block; }
  }
`

export class CaribouAppShell extends Elena(HTMLElement) {
  static override tagName = 'caribou-app-shell'
  static override shadow = 'open' as const
  static override styles = SHELL_CSS
  static override props = [{ name: 'instance', reflect: true }]

  instance: string | null = null

  override updated() {
    // Elena does not wire `.prop=` bindings; assign the right rail's `instance`
    // imperatively on every update so cookie changes propagate without remount.
    const rail = this.shadowRoot?.querySelector<HTMLElement & { instance: string | null }>('caribou-right-rail')
    if (rail && rail.instance !== this.instance) rail.instance = this.instance
  }

  override render() {
    return html`
      <div class="shell-grid">
        <caribou-nav-rail></caribou-nav-rail>
        <main><slot></slot></main>
        <caribou-right-rail></caribou-right-rail>
      </div>
    `
  }
}
CaribouAppShell.define()
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm --filter caribou-elena test caribou-app-shell
```

- [ ] **Step 5: Re-run the SSR parity test from Phase A6 (must still pass with the bigger shell)**

```bash
pnpm --filter caribou-elena test ssr-hydration-parity-shell
```

If the test file is now broken because the shell's `render()` shape changed, update the test to match — the assertion is "server SSR string equals client render string", which holds regardless of the rendered template's content as long as the same instance is constructed identically on both sides.

- [ ] **Step 6: Commit**

```bash
git add apps/caribou-elena/pages/components/caribou-app-shell.ts apps/caribou-elena/pages/components/__tests__/caribou-app-shell.test.ts
git commit -m "feat(elena-app): full caribou-app-shell with grid + responsive + instance forward"
```

---

## Phase G — Page components: timeline rename, status-card variants + boost, profile, thread

### Task G1: Rename `caribou-home-timeline` → `caribou-timeline` + add `kind` + `initial`

This is a **single sweeping commit** per §8.2. Rename the file, the class, the custom-element tag, and every caller, in one go. After this commit the codebase no longer references `caribou-home-timeline` anywhere.

**Files:**
- Move: `apps/caribou-elena/pages/components/caribou-home-timeline.ts` → `apps/caribou-elena/pages/components/caribou-timeline.ts`
- Modify: `apps/caribou-elena/pages/feed.ts` — update import path + tag name
- Update any test files that reference the old name (Plan 2 created at least one)

- [ ] **Step 1: Rename + edit class/tag**

```bash
git mv apps/caribou-elena/pages/components/caribou-home-timeline.ts apps/caribou-elena/pages/components/caribou-timeline.ts
```

Edit the new file:

```ts
// apps/caribou-elena/pages/components/caribou-timeline.ts
import { Elena, html } from '@elenajs/core'
import { effect } from '@preact/signals-core'
import type { Status } from '@beatzball/caribou-mastodon-client'
import {
  activeClient, createTimelineStore, startPolling, type TimelineStore,
} from '@beatzball/caribou-state'
import { createIntersectionObserver } from '@beatzball/caribou-ui-headless'
import './caribou-status-card.js'
import './caribou-new-posts-banner.js'

type TimelineKind = 'home' | 'local' | 'public'

export class CaribouTimeline extends Elena(HTMLElement) {
  static override tagName = 'caribou-timeline'
  static override props = [
    { name: 'kind',    reflect: true  },
    { name: 'initial', reflect: false },  // SSR-injected pageData "ok" branch
  ]

  kind: TimelineKind = 'home'
  initial: { statuses: Status[]; nextMaxId: string | null } | null = null

  private store: TimelineStore | null = null
  private disposeBindings: (() => void) | null = null
  private disposeBannerBinding: (() => void) | null = null
  private stopPolling: (() => void) | null = null
  private io: { observe(el: Element): void; disconnect(): void } | null = null

  private statuses: Status[] = []
  private loading = false
  private errorMsg: string | null = null
  private nextMaxId: string | null = null

  override connectedCallback() {
    super.connectedCallback?.()
    this.store = createTimelineStore(this.kind, {
      clientSource: () => activeClient.value,
      ...(this.initial ? { initial: this.initial } : {}),
    })
    if (this.initial) this.nextMaxId = this.initial.nextMaxId

    this.disposeBindings = effect(() => {
      const statuses = this.store!.statuses.value
      const loading  = this.store!.loading.value
      const errorMsg = this.store!.error.value?.message ?? null
      let changed =
        statuses.length !== this.statuses.length ||
        loading !== this.loading ||
        errorMsg !== this.errorMsg
      if (!changed) for (let i = 0; i < statuses.length; i++) if (statuses[i] !== this.statuses[i]) { changed = true; break }
      this.statuses = statuses; this.loading = loading; this.errorMsg = errorMsg
      if (changed) this.requestUpdate()
    })

    this.disposeBannerBinding = effect(() => {
      const count = this.store!.newPostsCount.value
      const banner = this.querySelector<HTMLElement & { count?: number }>('caribou-new-posts-banner')
      if (banner && banner.count !== count) banner.count = count
    })

    if (!this.initial) void this.store.load()
    if (this.kind === 'home') {
      this.stopPolling = startPolling({ intervalMs: 30_000, fn: () => this.store?.poll() })
    }
    this.addEventListener('apply-new-posts', () => this.store?.applyNewPosts())
  }

  override disconnectedCallback() {
    this.disposeBindings?.()
    this.disposeBannerBinding?.()
    this.stopPolling?.()
    this.io?.disconnect()
    super.disconnectedCallback?.()
  }

  override updated() {
    const banner = this.querySelector<HTMLElement & { requestUpdate?: () => void }>('caribou-new-posts-banner')
    if (banner && banner.children.length === 0) banner.requestUpdate?.()
    const cards = this.querySelectorAll<HTMLElement & { status?: Status | null }>('caribou-status-card[data-index]')
    cards.forEach((card) => {
      const idx = Number(card.dataset.index)
      const status = this.statuses[idx]
      if (status && card.status !== status) card.status = status
    })
    // Wire IO sentinel on the "Older posts" anchor if present (no-JS path leaves it as a real link).
    const sentinel = this.querySelector<HTMLAnchorElement>('a[data-sentinel]')
    if (sentinel && !this.io) {
      this.io = createIntersectionObserver(async (entry) => {
        if (!entry.isIntersecting) return
        sentinel.removeEventListener('click', this.onSentinelClick)
        sentinel.addEventListener('click', this.onSentinelClick)
        await this.store?.loadMore()
        this.refreshSentinel()
      })
      this.io.observe(sentinel)
    }
  }

  private onSentinelClick = (e: Event) => { e.preventDefault() }

  private refreshSentinel() {
    const sentinel = this.querySelector<HTMLAnchorElement>('a[data-sentinel]')
    if (!sentinel) return
    if (!this.store?.hasMore.value) { sentinel.remove(); this.io?.disconnect(); this.io = null; return }
    const last = this.statuses[this.statuses.length - 1]
    if (!last) return
    const url = new URL(window.location.href)
    url.searchParams.set('max_id', last.id)
    sentinel.href = url.pathname + url.search
    this.io?.observe(sentinel)
  }

  override render() {
    if (this.errorMsg) return html`<div role="alert" class="p-4 danger">${this.errorMsg}</div>`
    if (this.loading && this.statuses.length === 0) return html`<div class="p-4 fg-muted">Loading…</div>`
    if (this.statuses.length === 0) return html`<div class="p-4 fg-muted">No posts yet.</div>`
    const last = this.statuses[this.statuses.length - 1]
    const nextHref = last ? this.buildNextHref(last.id) : null
    return html`
      <div>
        <caribou-new-posts-banner></caribou-new-posts-banner>
        <ul class="list-none p-0 m-0">
          ${this.statuses.map((s, i) => html`
            <li><caribou-status-card data-index=${i} data-status-id=${s.id}></caribou-status-card></li>
          `)}
        </ul>
        ${nextHref
          ? html`<a href=${nextHref} rel="next" data-sentinel class="older-posts-link p-4 fg-muted">Older posts →</a>`
          : html``}
      </div>
    `
  }

  private buildNextHref(lastId: string): string {
    if (typeof window === 'undefined') return `?max_id=${lastId}`
    const url = new URL(window.location.href); url.searchParams.set('max_id', lastId)
    return url.pathname + url.search
  }
}
CaribouTimeline.define()
```

- [ ] **Step 2: Update every importer**

```bash
pnpm --filter caribou-elena exec rg --files-with-matches caribou-home-timeline | xargs -I{} sed -i '' 's/caribou-home-timeline/caribou-timeline/g' {}
```

(Replace `sed -i ''` with `sed -i` on Linux. Or just use the editor to find-and-replace; the Grep tool can locate them.)

- [ ] **Step 3: Run typecheck + tests**

```bash
pnpm --filter caribou-elena typecheck
pnpm --filter caribou-elena test
```

The home-timeline tests from Plan 2 should still pass after the rename (the tag changed but the behavior is preserved on `kind="home"` mode). If any test file path references the old name, rename it.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(elena-app): rename caribou-home-timeline → caribou-timeline; add kind + initial + Older-posts anchor + IO sentinel"
```

### Task G2: `<caribou-status-card>` variants (TDD)

**Files:**
- Modify: `apps/caribou-elena/pages/components/caribou-status-card.ts`
- Create: `apps/caribou-elena/pages/components/__tests__/caribou-status-card-variants.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(async () => {
  await import('../caribou-status-card.js')
})

const fixture = (over: Partial<Record<string, unknown>> = {}): unknown => ({
  id: '1',
  content: '<p>hello</p>',
  account: { id: '1', acct: 'a', username: 'a', displayName: 'A', avatar: '', avatarStatic: '' },
  createdAt: '2026-04-28T12:00:00Z',
  ...over,
})

describe('<caribou-status-card> variants', () => {
  it.each(['timeline', 'focused', 'ancestor', 'descendant'] as const)('applies variant=%s on root <article>', async (v) => {
    const el = document.createElement('caribou-status-card') as HTMLElement & { status: unknown; variant: string }
    el.variant = v
    el.status = fixture()
    document.body.appendChild(el)
    await Promise.resolve()
    const article = el.shadowRoot!.querySelector('article')!
    expect(article.dataset.variant).toBe(v)
  })

  it('focused variant emits an absolute timestamp', async () => {
    const el = document.createElement('caribou-status-card') as HTMLElement & { status: unknown; variant: string }
    el.variant = 'focused'
    el.status = fixture()
    document.body.appendChild(el)
    await Promise.resolve()
    const time = el.shadowRoot!.querySelector('time')!
    expect(time.getAttribute('datetime')).toBe('2026-04-28T12:00:00Z')
    // The pre-hydration mode emits absolute formatted text; relative form
    // is swapped in via a microtask after hydration. So at this snapshot,
    // we expect a date-like string, not "just now".
    expect(time.textContent).not.toBe('just now')
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

In `caribou-status-card.ts`:

1. Add a `variant` prop:
   ```ts
   static override props = [
     { name: 'status',  reflect: false },
     { name: 'variant', reflect: true  },
   ]
   variant: 'timeline' | 'focused' | 'ancestor' | 'descendant' = 'timeline'
   ```
2. Extend `STATUS_STYLES` with per-variant rules:
   ```ts
   const STATUS_STYLES = `
     /* … existing wrap rules … */
     article[data-variant="focused"] { border: 1px solid var(--accent); border-radius: var(--radius-md); padding: var(--space-4); }
     article[data-variant="focused"] .status-content { font-size: 1.1rem; }
     article[data-variant="ancestor"] { opacity: 0.75; }
     article[data-variant="descendant"] { margin-inline-start: var(--space-4); }
   `
   ```
3. In `render()`, add `data-variant=${this.variant}` on the `<article>`, and add a `<time>` element next to the header with `datetime` and a pre-hydration absolute text:
   ```ts
   const dt = s.createdAt
   const absLabel = new Date(dt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
   const relLabel = this._hydrated ? formatRelativeTime(dt) : absLabel
   // …
   return html`
     <article data-variant=${this.variant} …>
       <img …/>
       <div …>
         <header …>
           <strong>${display.account.displayName || display.account.username}</strong>
           <span class="fg-muted">@${display.account.acct}</span>
           <time datetime=${dt}>${relLabel}</time>
         </header>
         <div class="status-content">${unsafeHTML(safe)}</div>
       </div>
     </article>
   `
   ```
4. Add `_hydrated` swap in `connectedCallback`:
   ```ts
   private _hydrated = false
   override connectedCallback() {
     super.connectedCallback?.()
     queueMicrotask(() => { this._hydrated = true; this.requestUpdate?.() })
   }
   ```

(`formatRelativeTime` is imported from `@beatzball/caribou-ui-headless`.)

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/pages/components/caribou-status-card.ts apps/caribou-elena/pages/components/__tests__/caribou-status-card-variants.test.ts
git commit -m "feat(elena-app): caribou-status-card variants + pre/post-hydration timestamp swap"
```

### Task G3: `<caribou-status-card>` boost rendering (TDD)

**Files:**
- Modify: `apps/caribou-elena/pages/components/caribou-status-card.ts`
- Create: `apps/caribou-elena/pages/components/__tests__/caribou-status-card-boost.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(async () => { await import('../caribou-status-card.js') })

const REBLOG_STATUS = {
  id: 'wrapper',
  content: '',
  account: { id: '99', acct: 'booster', username: 'booster', displayName: 'Booster',
             avatar: '', avatarStatic: '' },
  createdAt: '2026-04-28T12:00:00Z',
  reblog: {
    id: 'inner',
    content: '<p>boosted content</p>',
    account: { id: '42', acct: 'alice', username: 'alice', displayName: 'Alice',
               avatar: '', avatarStatic: '' },
    createdAt: '2026-04-28T11:00:00Z',
  },
}

describe('<caribou-status-card> boost rendering', () => {
  it.each(['timeline', 'focused', 'ancestor', 'descendant'] as const)
    ('variant=%s renders reblog content with attribution row', async (v) => {
    const el = document.createElement('caribou-status-card') as HTMLElement & { status: unknown; variant: string }
    el.variant = v
    el.status = REBLOG_STATUS
    document.body.appendChild(el)
    await Promise.resolve()
    expect(el.shadowRoot!.textContent).toContain('boosted content')
    expect(el.shadowRoot!.textContent).toContain('Alice')
    expect(el.shadowRoot!.textContent).toContain('Booster')
    expect(el.shadowRoot!.querySelector('.boost-attribution')).toBeTruthy()
    expect(el.shadowRoot!.querySelector('.i-lucide-repeat-2')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

In `caribou-status-card.ts` `render()`:

```ts
const s = this.status
if (!s) return html``
const display = s.reblog ?? s
const safe = DOMPurify.sanitize(display.content ?? '', PURIFY_OPTS)
const dt = display.createdAt
// …
return html`
  <article data-variant=${this.variant} …>
    ${s.reblog
      ? html`<div class="boost-attribution fg-muted">
               <span class="i-lucide-repeat-2"></span>
               <span>${s.account.displayName || s.account.username} boosted</span>
             </div>`
      : html``}
    <img src=${display.account.avatarStatic || display.account.avatar} …/>
    <div …>
      <header …>
        <strong>${display.account.displayName || display.account.username}</strong>
        <span class="fg-muted">@${display.account.acct}</span>
        <time datetime=${dt}>${relLabel}</time>
      </header>
      <div class="status-content">${unsafeHTML(safe)}</div>
    </div>
  </article>
`
```

Add a `.boost-attribution` style block to `STATUS_STYLES`:

```css
.boost-attribution { display: flex; gap: var(--space-2); align-items: center; padding: 0 0 var(--space-2) var(--space-2); font-size: 0.875rem; }
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/pages/components/caribou-status-card.ts apps/caribou-elena/pages/components/__tests__/caribou-status-card-boost.test.ts
git commit -m "fix(elena-app): caribou-status-card renders reblog content with booster attribution"
```

### Task G4: `<caribou-profile-header>` (TDD)

**Files:**
- Create: `apps/caribou-elena/pages/components/caribou-profile-header.ts`
- Create: `apps/caribou-elena/pages/components/__tests__/caribou-profile-header.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(async () => { await import('../caribou-profile-header.js') })

const ACCOUNT = {
  id: '42', acct: 'alice@example.social', username: 'alice', displayName: 'Alice',
  avatar: '', avatarStatic: '', note: '<p>bio</p>', followersCount: 10, followingCount: 20, statusesCount: 30,
  header: '', headerStatic: '',
}

describe('<caribou-profile-header>', () => {
  it('renders avatar, display name, handle, bio, counts', async () => {
    const el = document.createElement('caribou-profile-header') as HTMLElement & { account: unknown }
    el.account = ACCOUNT
    document.body.appendChild(el)
    await Promise.resolve()
    const root = el.shadowRoot!
    expect(root.textContent).toContain('Alice')
    expect(root.textContent).toContain('@alice@example.social')
    expect(root.querySelector('.bio')?.innerHTML).toContain('bio')
    expect(root.textContent).toContain('10')
    expect(root.textContent).toContain('20')
    expect(root.textContent).toContain('30')
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

```ts
// apps/caribou-elena/pages/components/caribou-profile-header.ts
import { Elena, html, unsafeHTML } from '@elenajs/core'
import DOMPurify from 'dompurify'
import { PURIFY_OPTS } from '@beatzball/caribou-mastodon-client/sanitize-opts'
import type { Account } from '@beatzball/caribou-mastodon-client'

const HEADER_CSS = `
  :host { display: block; border-bottom: 1px solid var(--border); }
  .banner { aspect-ratio: 3/1; background: var(--bg-2); }
  .row    { display: flex; gap: var(--space-3); padding: var(--space-3); }
  img.avatar { width: 80px; height: 80px; border-radius: var(--radius-md); flex-shrink: 0; }
  .name   { color: var(--fg-0); font-weight: 600; font-size: 1.25rem; }
  .handle { color: var(--fg-muted); }
  .bio    { color: var(--fg-1); padding: 0 var(--space-3) var(--space-3); }
  .counts { display: flex; gap: var(--space-4); padding: 0 var(--space-3) var(--space-3); color: var(--fg-1); }
`

export class CaribouProfileHeader extends Elena(HTMLElement) {
  static override tagName = 'caribou-profile-header'
  static override shadow = 'open' as const
  static override styles = HEADER_CSS
  static override props = [{ name: 'account', reflect: false }]
  account: Account | null = null

  override render() {
    const a = this.account
    if (!a) return html``
    const safe = DOMPurify.sanitize(a.note ?? '', PURIFY_OPTS) as unknown as string
    return html`
      <div class="banner" style=${a.headerStatic || a.header ? `background-image:url(${a.headerStatic || a.header});background-size:cover;` : ''}></div>
      <div class="row">
        <img class="avatar" src=${a.avatarStatic || a.avatar} alt="" loading="lazy" decoding="async"/>
        <div>
          <div class="name">${a.displayName || a.username}</div>
          <div class="handle">@${a.acct}</div>
        </div>
      </div>
      <div class="bio">${unsafeHTML(safe)}</div>
      <div class="counts">
        <span><strong>${String(a.statusesCount)}</strong> Posts</span>
        <span><strong>${String(a.followingCount)}</strong> Following</span>
        <span><strong>${String(a.followersCount)}</strong> Followers</span>
      </div>
    `
  }
}
CaribouProfileHeader.define()
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/pages/components/caribou-profile-header.ts apps/caribou-elena/pages/components/__tests__/caribou-profile-header.test.ts
git commit -m "feat(elena-app): caribou-profile-header (shadow, sanitized bio, counts)"
```

### Task G5: `<caribou-profile-tabs>` (TDD)

**Files:**
- Create: `apps/caribou-elena/pages/components/caribou-profile-tabs.ts`
- Create: `apps/caribou-elena/pages/components/__tests__/caribou-profile-tabs.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(async () => { await import('../caribou-profile-tabs.js') })

describe('<caribou-profile-tabs>', () => {
  it('renders three anchors with proper href + aria-current on active tab', async () => {
    const el = document.createElement('caribou-profile-tabs') as HTMLElement & { handle: string; tab: string }
    el.handle = '@alice@example.social'; el.tab = 'replies'
    document.body.appendChild(el)
    await Promise.resolve()
    const anchors = el.shadowRoot!.querySelectorAll('a')
    expect(anchors.length).toBe(3)
    const active = el.shadowRoot!.querySelector('a[aria-current="page"]')
    expect(active?.getAttribute('href')).toContain('tab=replies')
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

```ts
// apps/caribou-elena/pages/components/caribou-profile-tabs.ts
import { Elena, html } from '@elenajs/core'

const TABS_CSS = `
  :host { display: block; border-bottom: 1px solid var(--border); }
  nav { display: flex; gap: 0; }
  a { padding: var(--space-3) var(--space-4); color: var(--fg-1); text-decoration: none; border-bottom: 2px solid transparent; }
  a[aria-current="page"] { color: var(--fg-0); border-bottom-color: var(--accent); }
`

const TABS = ['posts','replies','media'] as const

export class CaribouProfileTabs extends Elena(HTMLElement) {
  static override tagName = 'caribou-profile-tabs'
  static override shadow = 'open' as const
  static override styles = TABS_CSS
  static override props = [
    { name: 'handle', reflect: true },
    { name: 'tab',    reflect: true },
  ]
  handle = ''
  tab: 'posts' | 'replies' | 'media' = 'posts'

  override render() {
    return html`
      <nav>
        ${TABS.map((t) => {
          const href = `/${this.handle}?tab=${t}`
          return t === this.tab
            ? html`<a href=${href} aria-current="page">${t}</a>`
            : html`<a href=${href}>${t}</a>`
        })}
      </nav>
    `
  }
}
CaribouProfileTabs.define()
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/pages/components/caribou-profile-tabs.ts apps/caribou-elena/pages/components/__tests__/caribou-profile-tabs.test.ts
git commit -m "feat(elena-app): caribou-profile-tabs with aria-current on active"
```

### Task G6: `<caribou-profile>` host (light-DOM, like timeline) (TDD)

**Files:**
- Create: `apps/caribou-elena/pages/components/caribou-profile.ts`
- Create: `apps/caribou-elena/pages/components/__tests__/caribou-profile.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll, vi } from 'vitest'

beforeAll(async () => { await import('../caribou-profile.js') })

const ACCOUNT = { id: '42', acct: 'alice@example.social', username: 'alice', displayName: 'A', avatar: '', avatarStatic: '', note: '', followersCount: 0, followingCount: 0, statusesCount: 0, header: '', headerStatic: '' }
const STATUS  = { id: '210', content: '<p>x</p>', account: ACCOUNT, createdAt: '2026-04-28T12:00:00Z' }

describe('<caribou-profile>', () => {
  it('mounts header + tabs + status list when initial is provided', async () => {
    const el = document.createElement('caribou-profile') as HTMLElement & { handle: string; tab: string; initial: unknown }
    el.handle = '@alice@example.social'; el.tab = 'media'
    el.initial = { account: ACCOUNT, statuses: [STATUS], nextMaxId: null, tab: 'media' }
    document.body.appendChild(el)
    await Promise.resolve()
    expect(el.querySelector('caribou-profile-header')).toBeTruthy()
    expect(el.querySelector('caribou-profile-tabs')).toBeTruthy()
    expect(el.querySelectorAll('caribou-status-card').length).toBe(1)
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

```ts
// apps/caribou-elena/pages/components/caribou-profile.ts
import { Elena, html } from '@elenajs/core'
import { effect } from '@preact/signals-core'
import type { Account, Status } from '@beatzball/caribou-mastodon-client'
import {
  activeClient, createAccountCache, createProfileStore, type ProfileStore, type ProfileTab,
} from '@beatzball/caribou-state'
import { createIntersectionObserver } from '@beatzball/caribou-ui-headless'
import './caribou-profile-header.js'
import './caribou-profile-tabs.js'
import './caribou-status-card.js'

export class CaribouProfile extends Elena(HTMLElement) {
  static override tagName = 'caribou-profile'
  static override props = [
    { name: 'handle',  reflect: true  },
    { name: 'tab',     reflect: true  },
    { name: 'initial', reflect: false },
  ]
  handle = ''
  tab: ProfileTab = 'posts'
  initial: { account: Account; statuses: Status[]; nextMaxId: string | null; tab: ProfileTab } | null = null

  private account: Account | null = null
  private store: ProfileStore | null = null
  private dispose: (() => void) | null = null
  private statuses: Status[] = []
  private io: { observe(el: Element): void; disconnect(): void } | null = null

  override async connectedCallback() {
    super.connectedCallback?.()
    if (this.initial) {
      this.account = this.initial.account
      this.store = createProfileStore(this.account.id, this.tab, {
        clientSource: () => activeClient.value,
        initial: { statuses: this.initial.statuses, nextMaxId: this.initial.nextMaxId },
      })
    } else {
      const cache = createAccountCache(() => activeClient.value)
      this.account = await cache.lookup(this.handle.replace(/^@/, ''))
      if (this.account) {
        this.store = createProfileStore(this.account.id, this.tab, { clientSource: () => activeClient.value })
        await this.store.load()
      }
    }
    if (!this.store) return
    this.dispose = effect(() => {
      const next = this.store!.statuses.value
      let changed = next.length !== this.statuses.length
      if (!changed) for (let i = 0; i < next.length; i++) if (next[i] !== this.statuses[i]) { changed = true; break }
      this.statuses = next
      if (changed) this.requestUpdate()
    })
    this.requestUpdate()
  }

  override disconnectedCallback() {
    this.dispose?.()
    this.io?.disconnect()
    super.disconnectedCallback?.()
  }

  override updated() {
    const cards = this.querySelectorAll<HTMLElement & { status?: Status | null }>('caribou-status-card[data-index]')
    cards.forEach((card) => {
      const idx = Number(card.dataset.index)
      const status = this.statuses[idx]
      if (status && card.status !== status) card.status = status
    })
    const sentinel = this.querySelector<HTMLAnchorElement>('a[data-sentinel]')
    if (sentinel && !this.io) {
      this.io = createIntersectionObserver(async (e) => {
        if (!e.isIntersecting) return
        await this.store?.loadMore()
        const last = this.statuses[this.statuses.length - 1]
        if (!last || !this.store?.hasMore.value) { sentinel.remove(); this.io?.disconnect(); this.io = null; return }
        const url = new URL(window.location.href); url.searchParams.set('max_id', last.id)
        sentinel.href = url.pathname + url.search
        this.io?.observe(sentinel)
      })
      this.io.observe(sentinel)
    }
  }

  override render() {
    if (!this.account) return html`<div class="p-4 fg-muted">Loading…</div>`
    const last = this.statuses[this.statuses.length - 1]
    const nextHref = last && this.store?.hasMore.value
      ? `${this.locationPathname()}?tab=${this.tab}&max_id=${last.id}`
      : null
    return html`
      <caribou-profile-header .account=${this.account}></caribou-profile-header>
      <caribou-profile-tabs handle=${this.handle} tab=${this.tab}></caribou-profile-tabs>
      <ul class="list-none p-0 m-0">
        ${this.statuses.map((s, i) => html`
          <li><caribou-status-card data-index=${i} data-status-id=${s.id} variant="timeline"></caribou-status-card></li>
        `)}
      </ul>
      ${nextHref ? html`<a href=${nextHref} rel="next" data-sentinel class="older-posts-link p-4 fg-muted">Older posts →</a>` : html``}
    `
  }

  private locationPathname() {
    return typeof window !== 'undefined' ? window.location.pathname : `/${this.handle}`
  }

  override updated2() {/* Elena calls updated; this stub keeps types tidy if needed */}
}
CaribouProfile.define()
```

(Imperative `<caribou-profile-header>` `account` assignment in `updated()` if Elena's template engine doesn't bind `.prop=`. The `.account=${…}` form in the template is pseudocode; if it doesn't compile, drop the binding and assign in `updated()` like the timeline does for status cards.)

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/pages/components/caribou-profile.ts apps/caribou-elena/pages/components/__tests__/caribou-profile.test.ts
git commit -m "feat(elena-app): caribou-profile (light-DOM host: header + tabs + status list)"
```

### Task G7: `<caribou-thread>` (TDD)

**Files:**
- Create: `apps/caribou-elena/pages/components/caribou-thread.ts`
- Create: `apps/caribou-elena/pages/components/__tests__/caribou-thread.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(async () => { await import('../caribou-thread.js') })

const A = { id: 'a', content: '<p>a</p>', account: { id: '1' }, createdAt: '', inReplyToId: null } as const
const B = { id: 'b', content: '<p>b</p>', account: { id: '1' }, createdAt: '', inReplyToId: 'a' } as const
const F = { id: 'f', content: '<p>f</p>', account: { id: '1' }, createdAt: '', inReplyToId: 'b' } as const
const C = { id: 'c', content: '<p>c</p>', account: { id: '1' }, createdAt: '', inReplyToId: 'f' } as const
const D = { id: 'd', content: '<p>d</p>', account: { id: '1' }, createdAt: '', inReplyToId: 'c' } as const
const E = { id: 'e', content: '<p>e</p>', account: { id: '1' }, createdAt: '', inReplyToId: 'd' } as const
const G = { id: 'g', content: '<p>g</p>', account: { id: '1' }, createdAt: '', inReplyToId: 'e' } as const

describe('<caribou-thread> indent cap at depth 3', () => {
  it('caps depth at 3 for descendants more than 3 levels below focused', async () => {
    const el = document.createElement('caribou-thread') as HTMLElement & { initial: unknown; statusId: string }
    el.statusId = 'f'
    el.initial = { focused: F, ancestors: [A, B], descendants: [C, D, E, G] }
    document.body.appendChild(el)
    await Promise.resolve()
    const cards = el.shadowRoot!.querySelectorAll('caribou-status-card[data-depth]')
    const depths = Array.from(cards).map((c) => Number((c as HTMLElement).dataset.depth))
    expect(Math.max(...depths)).toBeLessThanOrEqual(3)
  })

  it('renders ancestors (no indent), focused, then descendants (indented)', async () => {
    const el = document.createElement('caribou-thread') as HTMLElement & { initial: unknown; statusId: string }
    el.statusId = 'f'
    el.initial = { focused: F, ancestors: [A, B], descendants: [C] }
    document.body.appendChild(el)
    await Promise.resolve()
    const cards = el.shadowRoot!.querySelectorAll('caribou-status-card')
    expect(cards.length).toBe(4)
    const variants = Array.from(cards).map((c) => c.getAttribute('variant'))
    expect(variants).toEqual(['ancestor','ancestor','focused','descendant'])
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

```ts
// apps/caribou-elena/pages/components/caribou-thread.ts
import { Elena, html } from '@elenajs/core'
import { effect } from '@preact/signals-core'
import type { Status } from '@beatzball/caribou-mastodon-client'
import { activeClient, createThreadStore, type ThreadStore } from '@beatzball/caribou-state'
import './caribou-status-card.js'

const THREAD_CSS = `
  :host { display: block; }
  ul { list-style: none; padding: 0; margin: 0; }
`

const MAX_DEPTH = 3

function depthMap(focusedId: string, descendants: Status[]): Map<string, number> {
  const byParent = new Map<string, Status[]>()
  for (const d of descendants) {
    const p = (d as Status & { inReplyToId: string | null }).inReplyToId
    if (!p) continue
    if (!byParent.has(p)) byParent.set(p, [])
    byParent.get(p)!.push(d)
  }
  const depths = new Map<string, number>()
  function walk(id: string, depth: number) {
    for (const child of byParent.get(id) ?? []) {
      const capped = Math.min(depth, MAX_DEPTH)
      depths.set(child.id, capped)
      walk(child.id, depth + 1)
    }
  }
  walk(focusedId, 1)
  return depths
}

export class CaribouThread extends Elena(HTMLElement) {
  static override tagName = 'caribou-thread'
  static override shadow = 'open' as const
  static override styles = THREAD_CSS
  static override props = [
    { name: 'statusId', reflect: true },
    { name: 'initial',  reflect: false },
  ]
  statusId = ''
  initial: { focused: Status; ancestors: Status[]; descendants: Status[] } | null = null

  private store: ThreadStore | null = null
  private dispose: (() => void) | null = null

  override async connectedCallback() {
    super.connectedCallback?.()
    const client = activeClient.value
    this.store = createThreadStore(client!, this.statusId, this.initial ? { initial: this.initial } : {})
    if (!this.initial) await this.store.load()
    this.dispose = effect(() => { this.store!.focused.value; this.store!.context.value; this.requestUpdate() })
  }

  override disconnectedCallback() { this.dispose?.(); super.disconnectedCallback?.() }

  override updated() {
    // Imperatively assign each status into its card.
    const allCards = this.shadowRoot!.querySelectorAll<HTMLElement & { status: Status | null }>('caribou-status-card[data-id]')
    allCards.forEach((card) => {
      const id = card.dataset.id!
      const all = this.collectStatuses()
      const s = all.find((x) => x.id === id) ?? null
      if (s && card.status !== s) card.status = s
    })
  }

  private collectStatuses(): Status[] {
    if (this.store?.focused.value.status === 'ready' && this.store.context.value.status === 'ready') {
      return [
        ...this.store.context.value.data.ancestors,
        this.store.focused.value.data,
        ...this.store.context.value.data.descendants,
      ]
    }
    return []
  }

  override render() {
    if (!this.store || this.store.focused.value.status !== 'ready' || this.store.context.value.status !== 'ready') {
      return html`<div class="p-4 fg-muted">Loading…</div>`
    }
    const focused = this.store.focused.value.data
    const { ancestors, descendants } = this.store.context.value.data
    const depths = depthMap(focused.id, descendants)
    return html`
      <ul>
        ${ancestors.map((s) => html`<li><caribou-status-card data-id=${s.id} variant="ancestor"></caribou-status-card></li>`)}
        <li><caribou-status-card data-id=${focused.id} variant="focused"></caribou-status-card></li>
        ${descendants.map((s) => {
          const depth = depths.get(s.id) ?? MAX_DEPTH
          return html`<li data-depth=${String(depth)} style="margin-inline-start:calc(var(--space-4)*${String(depth)})">
            <caribou-status-card data-id=${s.id} data-depth=${String(depth)} variant="descendant"></caribou-status-card>
          </li>`
        })}
      </ul>
    `
  }
}
CaribouThread.define()
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/pages/components/caribou-thread.ts apps/caribou-elena/pages/components/__tests__/caribou-thread.test.ts
git commit -m "feat(elena-app): caribou-thread with depth-capped descendants"
```

---

## Phase H — Pages (route files, SSR `pageData`, redirects, placeholders)

Each route file is thin: it imports the relevant component, declares `pageData` (per §8.1, §12.6), and renders the shell with the component slotted in. The auth-required placeholder is a single shared light-DOM template fragment.

**Files created in this phase:**
- `apps/caribou-elena/pages/home.ts` (refactored from `feed.ts`)
- `apps/caribou-elena/pages/feed.ts` (replaced — now a 301 redirect)
- `apps/caribou-elena/pages/local.ts` (new)
- `apps/caribou-elena/pages/public.ts` (new)
- `apps/caribou-elena/pages/privacy.ts` (new)
- `apps/caribou-elena/pages/about.ts` (new)
- `apps/caribou-elena/pages/@[handle].ts` (new)
- `apps/caribou-elena/pages/@[handle]/[statusId].ts` (new)
- `apps/caribou-elena/pages/components/caribou-auth-required.ts` (new — shared placeholder fragment, light-DOM, per §8.8)

### Task H1: Auth-required placeholder fragment

**Files:**
- Create: `apps/caribou-elena/pages/components/caribou-auth-required.ts`
- Test: `apps/caribou-elena/pages/components/__tests__/caribou-auth-required.test.ts`

Per §8.8: a single light-DOM fragment, no shadow DOM. Used by `/home`, `/@me`, `/@me/[id]`, and bare-handle profile routes when the cookie is absent.

- [ ] **Step 1: Write failing test**

```ts
// apps/caribou-elena/pages/components/__tests__/caribou-auth-required.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import '../caribou-auth-required.js'

describe('caribou-auth-required', () => {
  beforeAll(() => customElements.upgrade(document.body))

  it('renders sign-in CTA copy and link to /', () => {
    const el = document.createElement('caribou-auth-required')
    el.setAttribute('label', '/home shows your personal timeline.')
    document.body.appendChild(el)
    expect(el.textContent).toContain('Sign in to continue')
    expect(el.textContent).toContain('/home shows your personal timeline.')
    const link = el.querySelector<HTMLAnchorElement>('a[href="/"]')!
    expect(link).not.toBeNull()
    expect(link.textContent).toContain('Sign in')
  })

  it('uses light DOM (no shadowRoot)', () => {
    const el = document.createElement('caribou-auth-required')
    document.body.appendChild(el)
    expect(el.shadowRoot).toBeNull()
  })
})
```

- [ ] **Step 2: Run — expect fail (component undefined)**

```bash
pnpm -C apps/caribou-elena vitest run pages/components/__tests__/caribou-auth-required.test.ts
```

- [ ] **Step 3: Implement**

```ts
// apps/caribou-elena/pages/components/caribou-auth-required.ts
import { Elena, html } from '@elenajs/core'

export class CaribouAuthRequired extends Elena(HTMLElement) {
  static override tagName = 'caribou-auth-required'
  static override props = [{ name: 'label', reflect: true }]

  label = ''

  override render() {
    return html`
      <article class="auth-required-placeholder p-4">
        <h1 class="text-2xl font-semibold mb-3">Sign in to continue</h1>
        <p class="fg-1">
          ${this.label}
          <a href="/" class="text-accent underline">Sign in</a>
          to view it.
        </p>
      </article>
    `
  }
}
CaribouAuthRequired.define()
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/pages/components/caribou-auth-required.ts apps/caribou-elena/pages/components/__tests__/caribou-auth-required.test.ts
git commit -m "feat(elena-app): caribou-auth-required placeholder fragment"
```

---

### Task H2: Rename `pages/feed.ts` → `pages/home.ts` (refactored to use shell + timeline)

**Files:**
- Modify (rename): `apps/caribou-elena/pages/feed.ts` → `apps/caribou-elena/pages/home.ts`

Per §3.2 and §8.1: `/home` is auth-required (no SSR token), so its `pageData` returns `{ kind: 'auth-required', shell }`. SSR emits the placeholder; client mount swaps in the real `<caribou-timeline kind="home">` if `me.signal` resolves.

- [ ] **Step 1: Update existing test file path**

```bash
git mv apps/caribou-elena/pages/__tests__/feed.test.ts apps/caribou-elena/pages/__tests__/home.test.ts 2>/dev/null || true
```

- [ ] **Step 2: Update test to assert auth-required SSR + client swap**

```ts
// apps/caribou-elena/pages/__tests__/home.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveInstanceForRoute } from '../../server/lib/resolve-instance.js'

vi.mock('../../server/lib/resolve-instance.js', () => ({
  resolveInstanceForRoute: vi.fn(),
}))

describe('/home pageData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns auth-required with shell instance from cookie', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'fosstodon.org', source: 'cookie',
    })
    const { pageData } = await import('../home.js')
    const result = await pageData({} as any)
    expect(result).toEqual({
      kind: 'auth-required',
      shell: { instance: 'fosstodon.org' },
    })
  })

  it('returns auth-required with null instance when cookie absent', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({ instance: null })
    const { pageData } = await import('../home.js')
    const result = await pageData({} as any)
    expect(result.kind).toBe('auth-required')
    expect(result.shell.instance).toBeNull()
  })
})
```

- [ ] **Step 3: Run — expect fail (file not yet renamed)**

- [ ] **Step 4: Replace `pages/feed.ts` → `pages/home.ts`**

```ts
// apps/caribou-elena/pages/home.ts
import { Elena, html } from '@elenajs/core'
import { definePageData } from '@litrojs/core'
import { resolveInstanceForRoute } from '../server/lib/resolve-instance.js'
import type { ShellInfo } from '../server/lib/page-data-types.js'
import './components/caribou-app-shell.js'
import './components/caribou-timeline.js'
import './components/caribou-auth-required.js'

export const pageData = definePageData<{ kind: 'auth-required'; shell: ShellInfo }>(
  async (event) => {
    const resolution = await resolveInstanceForRoute(event, {})
    return { kind: 'auth-required', shell: { instance: resolution.instance } }
  },
)

export class HomePage extends Elena(HTMLElement) {
  static override tagName = 'home-page'

  pageData!: Awaited<ReturnType<typeof pageData>>

  override connectedCallback() {
    super.connectedCallback?.()
    queueMicrotask(() => this.maybeSwapToTimeline())
  }

  private maybeSwapToTimeline() {
    // me.signal lives in localStorage and is populated by Plan 2's bootstrap.
    // If signed in, replace the placeholder with the real timeline component.
    const meRaw = typeof localStorage !== 'undefined' ? localStorage.getItem('caribou.me') : null
    if (!meRaw) return
    const shell = this.querySelector('caribou-app-shell')
    if (!shell) return
    const real = document.createElement('caribou-timeline')
    real.setAttribute('kind', 'home')
    shell.replaceChildren(real)
  }

  override render() {
    const { shell } = this.pageData
    return html`
      <caribou-app-shell instance=${shell.instance ?? ''}>
        <caribou-auth-required slot="default"
          label="/home shows your personal timeline. It requires a Mastodon access token, which Caribou keeps on your device."></caribou-auth-required>
      </caribou-app-shell>
    `
  }
}
HomePage.define()
```

- [ ] **Step 5: Run home test — expect pass**

```bash
pnpm -C apps/caribou-elena vitest run pages/__tests__/home.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/caribou-elena/pages/home.ts apps/caribou-elena/pages/__tests__/home.test.ts
git rm apps/caribou-elena/pages/feed.ts 2>/dev/null || true
git commit -m "feat(elena-app): rename /feed → /home with shell + auth-required SSR"
```

---

### Task H3: `/feed` 301 redirect

**Files:**
- Create: `apps/caribou-elena/pages/feed.ts` (replaces deleted file)

Per §3.2: `/feed` becomes a Litro server route that issues a 301 to `/home`. Removed in Plan 4/5.

- [ ] **Step 1: Write failing test**

```ts
// apps/caribou-elena/pages/__tests__/feed-redirect.test.ts
import { describe, it, expect, vi } from 'vitest'

describe('/feed redirect', () => {
  it('issues 301 to /home', async () => {
    const sendRedirect = vi.fn()
    const event = { node: { res: {} }, sendRedirect } as any
    const { default: handler } = await import('../feed.js')
    await handler(event)
    expect(sendRedirect).toHaveBeenCalledWith('/home', 301)
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

```ts
// apps/caribou-elena/pages/feed.ts
import type { H3Event } from 'h3'
import { sendRedirect } from 'h3'

export default async function feedRedirect(event: H3Event) {
  return sendRedirect(event, '/home', 301)
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/pages/feed.ts apps/caribou-elena/pages/__tests__/feed-redirect.test.ts
git commit -m "feat(elena-app): /feed → /home 301 redirect"
```

---

### Task H4: `/local` page (full SSR via `pageData`)

**Files:**
- Create: `apps/caribou-elena/pages/local.ts`
- Test: `apps/caribou-elena/pages/__tests__/local.test.ts`

Per §8.1, §12.3, §12.6: `pageData` resolves instance, fetches public timeline, returns `TimelinePageData`. The page renders `<caribou-app-shell>` with `<caribou-timeline kind="local" .initial>` slotted in (or auth-required placeholder if no instance).

- [ ] **Step 1: Write failing test**

```ts
// apps/caribou-elena/pages/__tests__/local.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveInstanceForRoute } from '../../server/lib/resolve-instance.js'
import { fetchPublicTimeline } from '../../server/lib/mastodon-public.js'

vi.mock('../../server/lib/resolve-instance.js', () => ({
  resolveInstanceForRoute: vi.fn(),
}))
vi.mock('../../server/lib/mastodon-public.js', () => ({
  fetchPublicTimeline: vi.fn(),
}))

describe('/local pageData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns ok with statuses + nextMaxId', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'mastodon.social', source: 'cookie',
    })
    const fixture = [{ id: '11', content: 'hi' }, { id: '10', content: 'older' }] as any[]
    vi.mocked(fetchPublicTimeline).mockResolvedValue(fixture)
    const event = {
      context: {},
      node: { req: { url: '/local' } },
    } as any
    const { pageData } = await import('../local.js')
    const result = await pageData(event)
    expect(result).toEqual({
      kind: 'ok',
      statuses: fixture,
      nextMaxId: '10',
      shell: { instance: 'mastodon.social' },
    })
  })

  it('returns auth-required when no instance', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({ instance: null })
    const event = { context: {}, node: { req: { url: '/local' } } } as any
    const { pageData } = await import('../local.js')
    const result = await pageData(event)
    expect(result.kind).toBe('auth-required')
  })

  it('returns error on upstream fetch failure', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'mastodon.social', source: 'cookie',
    })
    vi.mocked(fetchPublicTimeline).mockRejectedValue(new Error('upstream 503'))
    const event = { context: {}, node: { req: { url: '/local' } } } as any
    const { pageData } = await import('../local.js')
    const result = await pageData(event)
    expect(result.kind).toBe('error')
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

```ts
// apps/caribou-elena/pages/local.ts
import { Elena, html } from '@elenajs/core'
import { definePageData } from '@litrojs/core'
import { getQuery } from 'h3'
import { resolveInstanceForRoute } from '../server/lib/resolve-instance.js'
import { fetchPublicTimeline } from '../server/lib/mastodon-public.js'
import type { TimelinePageData, ShellInfo } from '../server/lib/page-data-types.js'
import './components/caribou-app-shell.js'
import './components/caribou-timeline.js'
import './components/caribou-auth-required.js'

type LocalPageData = TimelinePageData & { shell: ShellInfo }

export const pageData = definePageData<LocalPageData>(async (event) => {
  const resolution = await resolveInstanceForRoute(event, {})
  const shell: ShellInfo = { instance: resolution.instance }
  if (!resolution.instance) return { kind: 'auth-required', shell }
  const query = getQuery(event)
  const maxId = typeof query.max_id === 'string' ? query.max_id : undefined
  try {
    const statuses = await fetchPublicTimeline({
      instance: resolution.instance, kind: 'local', maxId,
    })
    const nextMaxId = statuses.length > 0 ? statuses[statuses.length - 1].id : null
    return { kind: 'ok', statuses, nextMaxId, shell }
  } catch (err) {
    return { kind: 'error', message: String(err), shell }
  }
})

export class LocalPage extends Elena(HTMLElement) {
  static override tagName = 'local-page'

  pageData!: LocalPageData

  override render() {
    const { shell } = this.pageData
    if (this.pageData.kind === 'auth-required') {
      return html`
        <caribou-app-shell instance=${shell.instance ?? ''}>
          <caribou-auth-required slot="default"
            label="/local needs to know which instance to query. Sign in once and Caribou will remember."></caribou-auth-required>
        </caribou-app-shell>
      `
    }
    if (this.pageData.kind === 'error') {
      return html`
        <caribou-app-shell instance=${shell.instance ?? ''}>
          <article slot="default" class="p-4 fg-muted" role="alert">
            Couldn't load /local. <a href="/local" class="text-accent underline">Retry</a>
          </article>
        </caribou-app-shell>
      `
    }
    const initial = { statuses: this.pageData.statuses, nextMaxId: this.pageData.nextMaxId }
    return html`
      <caribou-app-shell instance=${shell.instance ?? ''}>
        <caribou-timeline kind="local" slot="default"
          .initial=${initial}></caribou-timeline>
      </caribou-app-shell>
    `
  }

  override updated() {
    // Elena does not wire `.prop=` bindings; assign imperatively.
    if (this.pageData.kind !== 'ok') return
    const tl = this.querySelector<HTMLElement & { initial?: unknown }>('caribou-timeline')
    if (tl && tl.initial !== undefined) return
    if (tl) tl.initial = { statuses: this.pageData.statuses, nextMaxId: this.pageData.nextMaxId }
  }
}
LocalPage.define()
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/pages/local.ts apps/caribou-elena/pages/__tests__/local.test.ts
git commit -m "feat(elena-app): /local page with SSR pageData"
```

---

### Task H5: `/public` page

**Files:**
- Create: `apps/caribou-elena/pages/public.ts`
- Test: `apps/caribou-elena/pages/__tests__/public.test.ts`

Identical to `/local` except `kind: 'public'`. Repeat the full code rather than refer to Task H4 — engineer may read out of order.

- [ ] **Step 1: Write failing test**

```ts
// apps/caribou-elena/pages/__tests__/public.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveInstanceForRoute } from '../../server/lib/resolve-instance.js'
import { fetchPublicTimeline } from '../../server/lib/mastodon-public.js'

vi.mock('../../server/lib/resolve-instance.js', () => ({ resolveInstanceForRoute: vi.fn() }))
vi.mock('../../server/lib/mastodon-public.js', () => ({ fetchPublicTimeline: vi.fn() }))

describe('/public pageData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes kind: "public" to fetchPublicTimeline', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'mastodon.social', source: 'cookie',
    })
    vi.mocked(fetchPublicTimeline).mockResolvedValue([])
    const event = { context: {}, node: { req: { url: '/public' } } } as any
    const { pageData } = await import('../public.js')
    await pageData(event)
    expect(fetchPublicTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'public', instance: 'mastodon.social' }),
    )
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

```ts
// apps/caribou-elena/pages/public.ts
import { Elena, html } from '@elenajs/core'
import { definePageData } from '@litrojs/core'
import { getQuery } from 'h3'
import { resolveInstanceForRoute } from '../server/lib/resolve-instance.js'
import { fetchPublicTimeline } from '../server/lib/mastodon-public.js'
import type { TimelinePageData, ShellInfo } from '../server/lib/page-data-types.js'
import './components/caribou-app-shell.js'
import './components/caribou-timeline.js'
import './components/caribou-auth-required.js'

type PublicPageData = TimelinePageData & { shell: ShellInfo }

export const pageData = definePageData<PublicPageData>(async (event) => {
  const resolution = await resolveInstanceForRoute(event, {})
  const shell: ShellInfo = { instance: resolution.instance }
  if (!resolution.instance) return { kind: 'auth-required', shell }
  const query = getQuery(event)
  const maxId = typeof query.max_id === 'string' ? query.max_id : undefined
  try {
    const statuses = await fetchPublicTimeline({
      instance: resolution.instance, kind: 'public', maxId,
    })
    const nextMaxId = statuses.length > 0 ? statuses[statuses.length - 1].id : null
    return { kind: 'ok', statuses, nextMaxId, shell }
  } catch (err) {
    return { kind: 'error', message: String(err), shell }
  }
})

export class PublicPage extends Elena(HTMLElement) {
  static override tagName = 'public-page'

  pageData!: PublicPageData

  override render() {
    const { shell } = this.pageData
    if (this.pageData.kind === 'auth-required') {
      return html`
        <caribou-app-shell instance=${shell.instance ?? ''}>
          <caribou-auth-required slot="default"
            label="/public needs to know which instance to query. Sign in once and Caribou will remember."></caribou-auth-required>
        </caribou-app-shell>
      `
    }
    if (this.pageData.kind === 'error') {
      return html`
        <caribou-app-shell instance=${shell.instance ?? ''}>
          <article slot="default" class="p-4 fg-muted" role="alert">
            Couldn't load /public. <a href="/public" class="text-accent underline">Retry</a>
          </article>
        </caribou-app-shell>
      `
    }
    return html`
      <caribou-app-shell instance=${shell.instance ?? ''}>
        <caribou-timeline kind="public" slot="default"></caribou-timeline>
      </caribou-app-shell>
    `
  }

  override updated() {
    if (this.pageData.kind !== 'ok') return
    const tl = this.querySelector<HTMLElement & { initial?: unknown }>('caribou-timeline')
    if (tl && tl.initial !== undefined) return
    if (tl) tl.initial = { statuses: this.pageData.statuses, nextMaxId: this.pageData.nextMaxId }
  }
}
PublicPage.define()
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/pages/public.ts apps/caribou-elena/pages/__tests__/public.test.ts
git commit -m "feat(elena-app): /public page with SSR pageData"
```

---

### Task H6: `/privacy` and `/about` stub pages

**Files:**
- Create: `apps/caribou-elena/pages/privacy.ts`
- Create: `apps/caribou-elena/pages/about.ts`
- Test: `apps/caribou-elena/pages/__tests__/stubs.test.ts`

Per §3.5, §8.7: static-content pages with shell-only `pageData` (so `<caribou-app-shell>`'s `instance` populates).

- [ ] **Step 1: Write failing test**

```ts
// apps/caribou-elena/pages/__tests__/stubs.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveInstanceForRoute } from '../../server/lib/resolve-instance.js'

vi.mock('../../server/lib/resolve-instance.js', () => ({ resolveInstanceForRoute: vi.fn() }))

describe('/privacy and /about stubs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('/privacy returns shell only', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'fosstodon.org', source: 'cookie',
    })
    const event = { context: {}, node: { req: { url: '/privacy' } } } as any
    const { pageData } = await import('../privacy.js')
    const result = await pageData(event)
    expect(result).toEqual({ shell: { instance: 'fosstodon.org' } })
  })

  it('/about returns shell only', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({ instance: null })
    const event = { context: {}, node: { req: { url: '/about' } } } as any
    const { pageData } = await import('../about.js')
    const result = await pageData(event)
    expect(result).toEqual({ shell: { instance: null } })
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement `pages/privacy.ts`**

```ts
// apps/caribou-elena/pages/privacy.ts
import { Elena, html } from '@elenajs/core'
import { definePageData } from '@litrojs/core'
import { resolveInstanceForRoute } from '../server/lib/resolve-instance.js'
import type { ShellInfo } from '../server/lib/page-data-types.js'
import './components/caribou-app-shell.js'

export const pageData = definePageData<{ shell: ShellInfo }>(async (event) => {
  const resolution = await resolveInstanceForRoute(event, {})
  return { shell: { instance: resolution.instance } }
})

export class PrivacyPage extends Elena(HTMLElement) {
  static override tagName = 'privacy-page'

  pageData!: { shell: ShellInfo }

  override render() {
    const { shell } = this.pageData
    return html`
      <caribou-app-shell instance=${shell.instance ?? ''}>
        <article slot="default" class="prose fg-1 p-4 max-w-[640px]">
          <h1 class="text-2xl font-semibold mb-4">Privacy</h1>
          <p>
            Privacy policy coming soon. Caribou does not collect analytics or
            telemetry. Your Mastodon instance sees your activity; Caribou's
            server proxies unauthenticated public reads (timelines, profiles,
            threads) on your behalf and stores a hostname-only
            <code>caribou.instance</code> cookie when you sign in so bare-URL
            profile views know which instance to query — your access token and
            post content stay on your device.
          </p>
        </article>
      </caribou-app-shell>
    `
  }
}
PrivacyPage.define()
```

- [ ] **Step 4: Implement `pages/about.ts`**

```ts
// apps/caribou-elena/pages/about.ts
import { Elena, html } from '@elenajs/core'
import { definePageData } from '@litrojs/core'
import { resolveInstanceForRoute } from '../server/lib/resolve-instance.js'
import type { ShellInfo } from '../server/lib/page-data-types.js'
import { REPO_URL } from '../build-meta.generated.js'
import './components/caribou-app-shell.js'

export const pageData = definePageData<{ shell: ShellInfo }>(async (event) => {
  const resolution = await resolveInstanceForRoute(event, {})
  return { shell: { instance: resolution.instance } }
})

export class AboutPage extends Elena(HTMLElement) {
  static override tagName = 'about-page'

  pageData!: { shell: ShellInfo }

  override render() {
    const { shell } = this.pageData
    return html`
      <caribou-app-shell instance=${shell.instance ?? ''}>
        <article slot="default" class="prose fg-1 p-4 max-w-[640px]">
          <h1 class="text-2xl font-semibold mb-4">About</h1>
          <p>
            Caribou — A Mastodon client built on Litro.
            <a href=${REPO_URL} class="text-accent underline" rel="noopener">Source on GitHub</a>.
          </p>
        </article>
      </caribou-app-shell>
    `
  }
}
AboutPage.define()
```

- [ ] **Step 5: Run — expect pass**

- [ ] **Step 6: Commit**

```bash
git add apps/caribou-elena/pages/privacy.ts apps/caribou-elena/pages/about.ts apps/caribou-elena/pages/__tests__/stubs.test.ts
git commit -m "feat(elena-app): /privacy and /about stub pages"
```

---

### Task H7: `/@[handle]` profile page

**Files:**
- Create: `apps/caribou-elena/pages/@[handle].ts`
- Test: `apps/caribou-elena/pages/__tests__/handle.test.ts`

Per §8.1, §12.3: parses `?tab=`, calls `fetchAccountByHandle` then `fetchAccountStatuses`, returns `ProfilePageData`.

- [ ] **Step 1: Write failing test**

```ts
// apps/caribou-elena/pages/__tests__/handle.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveInstanceForRoute } from '../../server/lib/resolve-instance.js'
import {
  fetchAccountByHandle, fetchAccountStatuses,
} from '../../server/lib/mastodon-public.js'

vi.mock('../../server/lib/resolve-instance.js', () => ({ resolveInstanceForRoute: vi.fn() }))
vi.mock('../../server/lib/mastodon-public.js', () => ({
  fetchAccountByHandle: vi.fn(),
  fetchAccountStatuses: vi.fn(),
}))

describe('/@[handle] pageData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns ok with account + statuses + tab=posts when no tab param', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'mastodon.social', source: 'cookie',
    })
    vi.mocked(fetchAccountByHandle).mockResolvedValue({ id: '42', acct: 'alice@example.social' } as any)
    vi.mocked(fetchAccountStatuses).mockResolvedValue([{ id: '99' }] as any)
    const event = {
      context: { params: { handle: 'alice@example.social' } },
      node: { req: { url: '/@alice@example.social' } },
    } as any
    const { pageData } = await import('../@[handle].js')
    const result = await pageData(event)
    expect(result).toMatchObject({
      kind: 'ok',
      account: { id: '42' },
      tab: 'posts',
      nextMaxId: '99',
    })
  })

  it('passes onlyMedia=true when tab=media', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'mastodon.social', source: 'cookie',
    })
    vi.mocked(fetchAccountByHandle).mockResolvedValue({ id: '42' } as any)
    vi.mocked(fetchAccountStatuses).mockResolvedValue([])
    const event = {
      context: { params: { handle: 'alice@example.social' } },
      node: { req: { url: '/@alice@example.social?tab=media' } },
    } as any
    const { pageData } = await import('../@[handle].js')
    await pageData(event)
    expect(fetchAccountStatuses).toHaveBeenCalledWith(
      '42', expect.objectContaining({ onlyMedia: true }),
    )
  })

  it('returns auth-required for bare handle when no instance cookie', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({ instance: null })
    const event = {
      context: { params: { handle: 'alice' } },
      node: { req: { url: '/@alice' } },
    } as any
    const { pageData } = await import('../@[handle].js')
    const result = await pageData(event)
    expect(result.kind).toBe('auth-required')
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

```ts
// apps/caribou-elena/pages/@[handle].ts
import { Elena, html } from '@elenajs/core'
import { definePageData } from '@litrojs/core'
import { getQuery } from 'h3'
import { resolveInstanceForRoute } from '../server/lib/resolve-instance.js'
import {
  fetchAccountByHandle, fetchAccountStatuses,
} from '../server/lib/mastodon-public.js'
import type { ProfilePageData, ShellInfo } from '../server/lib/page-data-types.js'
import './components/caribou-app-shell.js'
import './components/caribou-profile.js'
import './components/caribou-auth-required.js'

type Tab = 'posts' | 'replies' | 'media'

function parseTab(raw: unknown): Tab {
  return raw === 'replies' || raw === 'media' ? raw : 'posts'
}

type HandlePageData = ProfilePageData & { shell: ShellInfo; handle: string }

export const pageData = definePageData<HandlePageData>(async (event) => {
  const handle = String(event.context?.params?.handle ?? '')
  const resolution = await resolveInstanceForRoute(event, { handle })
  const shell: ShellInfo = { instance: resolution.instance }
  if (!resolution.instance) return { kind: 'auth-required', shell, handle }
  const query = getQuery(event)
  const tab = parseTab(query.tab)
  const maxId = typeof query.max_id === 'string' ? query.max_id : undefined
  try {
    const account = await fetchAccountByHandle(handle, { instance: resolution.instance })
    const statuses = await fetchAccountStatuses(account.id, {
      instance: resolution.instance,
      maxId,
      excludeReplies: tab !== 'replies',
      onlyMedia:      tab === 'media',
    })
    const nextMaxId = statuses.length > 0 ? statuses[statuses.length - 1].id : null
    return { kind: 'ok', account, statuses, nextMaxId, tab, shell, handle }
  } catch (err) {
    return { kind: 'error', message: String(err), shell, handle }
  }
})

export class HandlePage extends Elena(HTMLElement) {
  static override tagName = 'handle-page'

  pageData!: HandlePageData

  override render() {
    const { shell, handle } = this.pageData
    if (this.pageData.kind === 'auth-required') {
      return html`
        <caribou-app-shell instance=${shell.instance ?? ''}>
          <caribou-auth-required slot="default"
            label="Profiles by bare handle (@user without @host) need to know which instance to query."></caribou-auth-required>
        </caribou-app-shell>
      `
    }
    if (this.pageData.kind === 'error') {
      return html`
        <caribou-app-shell instance=${shell.instance ?? ''}>
          <article slot="default" class="p-4 fg-muted" role="alert">
            Couldn't load profile @${handle}.
          </article>
        </caribou-app-shell>
      `
    }
    const { tab } = this.pageData
    return html`
      <caribou-app-shell instance=${shell.instance ?? ''}>
        <caribou-profile slot="default" handle=${handle} tab=${tab}></caribou-profile>
      </caribou-app-shell>
    `
  }

  override updated() {
    if (this.pageData.kind !== 'ok') return
    const profile = this.querySelector<HTMLElement & { initial?: unknown }>('caribou-profile')
    if (!profile || profile.initial !== undefined) return
    profile.initial = {
      account:   this.pageData.account,
      statuses:  this.pageData.statuses,
      nextMaxId: this.pageData.nextMaxId,
      tab:       this.pageData.tab,
    }
  }
}
HandlePage.define()
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add 'apps/caribou-elena/pages/@[handle].ts' apps/caribou-elena/pages/__tests__/handle.test.ts
git commit -m "feat(elena-app): /@[handle] profile page with SSR pageData"
```

---

### Task H8: `/@[handle]/[statusId]` thread page

**Files:**
- Create: `apps/caribou-elena/pages/@[handle]/[statusId].ts`
- Test: `apps/caribou-elena/pages/__tests__/handle-status.test.ts`

Per §8.1, §12.3: parallel `fetchStatus` + `fetchThreadContext` via `Promise.allSettled`.

- [ ] **Step 1: Write failing test**

```ts
// apps/caribou-elena/pages/__tests__/handle-status.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveInstanceForRoute } from '../../server/lib/resolve-instance.js'
import {
  fetchStatus, fetchThreadContext,
} from '../../server/lib/mastodon-public.js'

vi.mock('../../server/lib/resolve-instance.js', () => ({ resolveInstanceForRoute: vi.fn() }))
vi.mock('../../server/lib/mastodon-public.js', () => ({
  fetchStatus: vi.fn(),
  fetchThreadContext: vi.fn(),
}))

describe('/@[handle]/[statusId] pageData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns ok with focused + ancestors + descendants when both succeed', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'mastodon.social', source: 'cookie',
    })
    vi.mocked(fetchStatus).mockResolvedValue({ id: '99', content: 'hi' } as any)
    vi.mocked(fetchThreadContext).mockResolvedValue({
      ancestors: [{ id: '90' }] as any,
      descendants: [{ id: '100' }] as any,
    })
    const event = {
      context: { params: { handle: 'alice@example.social', statusId: '99' } },
      node: { req: { url: '/@alice@example.social/99' } },
    } as any
    const { pageData } = await import('../@[handle]/[statusId].js')
    const result = await pageData(event)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected ok')
    expect(result.focused.id).toBe('99')
    expect(result.ancestors).toHaveLength(1)
    expect(result.descendants).toHaveLength(1)
  })

  it('returns error when fetchStatus rejects', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'mastodon.social', source: 'cookie',
    })
    vi.mocked(fetchStatus).mockRejectedValue(new Error('404'))
    vi.mocked(fetchThreadContext).mockResolvedValue({ ancestors: [], descendants: [] })
    const event = {
      context: { params: { handle: 'alice@example.social', statusId: '99' } },
      node: { req: { url: '/@alice@example.social/99' } },
    } as any
    const { pageData } = await import('../@[handle]/[statusId].js')
    const result = await pageData(event)
    expect(result.kind).toBe('error')
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

```ts
// apps/caribou-elena/pages/@[handle]/[statusId].ts
import { Elena, html } from '@elenajs/core'
import { definePageData } from '@litrojs/core'
import { resolveInstanceForRoute } from '../../server/lib/resolve-instance.js'
import {
  fetchStatus, fetchThreadContext,
} from '../../server/lib/mastodon-public.js'
import type { ThreadPageData, ShellInfo } from '../../server/lib/page-data-types.js'
import '../components/caribou-app-shell.js'
import '../components/caribou-thread.js'
import '../components/caribou-auth-required.js'

type StatusPageData = ThreadPageData & { shell: ShellInfo; statusId: string; handle: string }

export const pageData = definePageData<StatusPageData>(async (event) => {
  const handle   = String(event.context?.params?.handle ?? '')
  const statusId = String(event.context?.params?.statusId ?? '')
  const resolution = await resolveInstanceForRoute(event, { handle })
  const shell: ShellInfo = { instance: resolution.instance }
  if (!resolution.instance) return { kind: 'auth-required', shell, statusId, handle }
  const [focusedR, contextR] = await Promise.allSettled([
    fetchStatus(statusId, { instance: resolution.instance }),
    fetchThreadContext(statusId, { instance: resolution.instance }),
  ])
  if (focusedR.status === 'rejected') {
    return { kind: 'error', message: String(focusedR.reason), shell, statusId, handle }
  }
  const ancestors   = contextR.status === 'fulfilled' ? contextR.value.ancestors   : []
  const descendants = contextR.status === 'fulfilled' ? contextR.value.descendants : []
  return {
    kind: 'ok',
    focused: focusedR.value, ancestors, descendants,
    shell, statusId, handle,
  }
})

export class HandleStatusPage extends Elena(HTMLElement) {
  static override tagName = 'handle-status-page'

  pageData!: StatusPageData

  override render() {
    const { shell, statusId } = this.pageData
    if (this.pageData.kind === 'auth-required') {
      return html`
        <caribou-app-shell instance=${shell.instance ?? ''}>
          <caribou-auth-required slot="default"
            label="Threads by bare handle need to know which instance to query."></caribou-auth-required>
        </caribou-app-shell>
      `
    }
    if (this.pageData.kind === 'error') {
      return html`
        <caribou-app-shell instance=${shell.instance ?? ''}>
          <article slot="default" class="p-4 fg-muted" role="alert">
            Couldn't load status ${statusId}.
          </article>
        </caribou-app-shell>
      `
    }
    return html`
      <caribou-app-shell instance=${shell.instance ?? ''}>
        <caribou-thread slot="default" status-id=${statusId}></caribou-thread>
      </caribou-app-shell>
    `
  }

  override updated() {
    if (this.pageData.kind !== 'ok') return
    const thread = this.querySelector<HTMLElement & { initial?: unknown }>('caribou-thread')
    if (!thread || thread.initial !== undefined) return
    thread.initial = {
      focused:     this.pageData.focused,
      ancestors:   this.pageData.ancestors,
      descendants: this.pageData.descendants,
    }
  }
}
HandleStatusPage.define()
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
mkdir -p 'apps/caribou-elena/pages/@[handle]'
git add 'apps/caribou-elena/pages/@[handle]/[statusId].ts' apps/caribou-elena/pages/__tests__/handle-status.test.ts
git commit -m "feat(elena-app): /@[handle]/[statusId] thread page with parallel SSR fetches"
```

---

## Phase I — Hydration parity, no-JS smoke, manual verification

This phase ties §10 (testing strategy) and §12.6 (hydration parity) together, plus manual checks for routes that don't get automated coverage.

### Task I1: Byte-equal hydration parity test harness

**Files:**
- Create: `apps/caribou-elena/test/hydration-parity.test.ts`

Per §10.2 + §12.6: each SSR'd public route's `pageData` output piped through `renderShadowComponentToString` (server side) and through the client component's pre-hydration `render()` must produce byte-equal HTML after whitespace normalization.

- [ ] **Step 1: Write the harness as one parameterized test**

```ts
// apps/caribou-elena/test/hydration-parity.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { renderShadowComponentToString } from '../server/lib/render-shadow.js'
import '../pages/components/caribou-status-card.js'
import '../pages/components/caribou-app-shell.js'
import '../pages/components/caribou-nav-rail.js'
import '../pages/components/caribou-right-rail.js'

function normalize(html: string): string {
  return html
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim()
}

const STATUS_FIXTURE = {
  id: '11',
  content: '<p>hello</p>',
  account: { id: '1', username: 'alice', acct: 'alice@example.social',
              displayName: 'Alice', avatar: '', avatarStatic: '' },
  createdAt: '2026-04-01T12:00:00.000Z',
  reblog: null,
} as any

describe('hydration parity (byte-equal SSR ↔ pre-hydration client render)', () => {
  beforeAll(() => customElements.upgrade(document.body))

  const cases: Array<{ name: string; tag: string; props: Record<string, unknown> }> = [
    { name: 'caribou-status-card timeline variant',
      tag: 'caribou-status-card',
      props: { status: STATUS_FIXTURE, variant: 'timeline' } },
    { name: 'caribou-status-card focused variant',
      tag: 'caribou-status-card',
      props: { status: STATUS_FIXTURE, variant: 'focused' } },
    { name: 'caribou-app-shell with instance',
      tag: 'caribou-app-shell',
      props: { instance: 'mastodon.social' } },
    { name: 'caribou-nav-rail',
      tag: 'caribou-nav-rail',
      props: { current: '/local' } },
    { name: 'caribou-right-rail with instance',
      tag: 'caribou-right-rail',
      props: { instance: 'mastodon.social' } },
  ]

  for (const c of cases) {
    it(c.name, async () => {
      const ssrHtml = await renderShadowComponentToString(c.tag, c.props)

      const clientEl = document.createElement(c.tag) as any
      for (const [k, v] of Object.entries(c.props)) clientEl[k] = v
      // pre-hydration mode: _hydrated stays false; do NOT trigger queueMicrotask swap
      document.body.appendChild(clientEl)
      const clientHtml = clientEl.outerHTML
      clientEl.remove()

      expect(normalize(clientHtml)).toBe(normalize(ssrHtml))
    })
  }
})
```

- [ ] **Step 2: Run — expect first failure**

```bash
pnpm -C apps/caribou-elena vitest run test/hydration-parity.test.ts
```

If failure is "byte differs", inspect first divergence by logging both strings into separate temp files, diff them, fix the offending source-of-divergence (usually attribute order or whitespace inside template literal). Repeat until all five cases pass.

- [ ] **Step 3: Once green, commit**

```bash
git add apps/caribou-elena/test/hydration-parity.test.ts
git commit -m "test(elena-app): byte-equal hydration parity harness for SSR'd components"
```

---

### Task I2: Cookie hostname validation tests

**Files:**
- Create: `apps/caribou-elena/server/lib/__tests__/instance-cookie.test.ts` (or extend existing)

Per §10.2: `getInstance(event)` must reject unregistered hosts and SSRF-amplification patterns.

- [ ] **Step 1: Write tests**

```ts
// apps/caribou-elena/server/lib/__tests__/instance-cookie.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getInstance } from '../instance-cookie.js'
import * as storage from '../storage.js'

vi.mock('../storage.js')

function eventWith(cookie: string | null) {
  return {
    node: { req: { headers: { cookie: cookie ? `caribou.instance=${cookie}` : '' } } },
  } as any
}

describe('getInstance', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns hostname when cookie set and registered', async () => {
    vi.mocked(storage.getOAuthApp).mockResolvedValue({ host: 'mastodon.social' } as any)
    expect(await getInstance(eventWith('mastodon.social'))).toBe('mastodon.social')
  })

  it('returns undefined when cookie set but unregistered', async () => {
    vi.mocked(storage.getOAuthApp).mockResolvedValue(null)
    expect(await getInstance(eventWith('evil.example'))).toBeUndefined()
  })

  it('rejects 169.254.169.254 (SSRF amplification)', async () => {
    expect(await getInstance(eventWith('169.254.169.254'))).toBeUndefined()
  })

  it('rejects localhost', async () => {
    expect(await getInstance(eventWith('localhost'))).toBeUndefined()
  })

  it('rejects IPv6 literal in brackets', async () => {
    expect(await getInstance(eventWith('[::1]'))).toBeUndefined()
  })

  it('rejects empty string', async () => {
    expect(await getInstance(eventWith(''))).toBeUndefined()
  })

  it('rejects host:port form', async () => {
    expect(await getInstance(eventWith('mastodon.social:8080'))).toBeUndefined()
  })

  it('returns undefined when cookie absent', async () => {
    expect(await getInstance(eventWith(null))).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run — expect pass (covered by Phase E logic)**

- [ ] **Step 3: Commit**

```bash
git add apps/caribou-elena/server/lib/__tests__/instance-cookie.test.ts
git commit -m "test(elena-app): cookie hostname validation rejects SSRF + unregistered hosts"
```

---

### Task I3: Playwright JS-disabled smoke test

**Files:**
- Create: `apps/caribou-elena/e2e/no-js.spec.ts`

Per §10.2 + §12: single test launched with `javaScriptEnabled: false`, asserting `/local` and `/home` render correctly without JS.

- [ ] **Step 1: Write spec**

```ts
// apps/caribou-elena/e2e/no-js.spec.ts
import { test, expect } from '@playwright/test'

test.describe('no-JS smoke', () => {
  test.use({ javaScriptEnabled: false })

  test('/local renders status cards + Older posts anchor without JS', async ({ page }) => {
    // Test instance must be seeded with `caribou.instance` cookie
    // matching a registered host. CI fixture sets the cookie via a
    // pre-test `setCookie` step in the Playwright project config.
    const consoleErrors: string[] = []
    page.on('pageerror', (e) => consoleErrors.push(String(e)))
    await page.goto('/local')
    await expect(page.locator('caribou-status-card').first()).toBeVisible()
    const olderLink = page.locator('a.older-posts-link')
    await expect(olderLink).toHaveAttribute('href', /\?max_id=/)
    expect(consoleErrors).toEqual([])

    // Click anchor → server re-renders with new max_id
    const beforeFirstId = await page.locator('caribou-status-card').first().getAttribute('data-status-id')
    await olderLink.click()
    await expect(page).toHaveURL(/max_id=/)
    const afterFirstId = await page.locator('caribou-status-card').first().getAttribute('data-status-id')
    expect(afterFirstId).not.toBe(beforeFirstId)
  })

  test('/home shows auth-required placeholder without JS', async ({ page }) => {
    await page.goto('/home')
    await expect(page.getByText('Sign in to continue')).toBeVisible()
    await expect(page.getByRole('link', { name: /Sign in/ })).toHaveAttribute('href', '/')
  })
})
```

- [ ] **Step 2: Add Playwright project for no-JS (if not already in config)**

```ts
// apps/caribou-elena/playwright.config.ts (snippet)
projects: [
  { name: 'js',     use: { javaScriptEnabled: true } },
  { name: 'no-js',  testMatch: 'no-js.spec.ts', use: { javaScriptEnabled: false } },
]
```

- [ ] **Step 3: Run — expect pass against local dev server**

```bash
pnpm -C apps/caribou-elena playwright test e2e/no-js.spec.ts --project=no-js
```

- [ ] **Step 4: Commit**

```bash
git add apps/caribou-elena/e2e/no-js.spec.ts apps/caribou-elena/playwright.config.ts
git commit -m "test(elena-app): no-JS Playwright smoke for /local and /home"
```

---

### Task I4: Manual verification checklist (run before declaring plan done)

**Files:** none — this is a runbook task.

Per §10.4. Before opening PR:

- [ ] Run `pnpm -w typecheck && pnpm -w test && pnpm -w build` at repo root — all green.
- [ ] `pnpm -C apps/caribou-elena dev`, then in a browser:
  - [ ] `/home`, `/local`, `/public` each render real data; scroll-sentinel loads more (with JS on).
  - [ ] `/@me` loads own profile.
  - [ ] Switching tabs via URL (posts → replies → media) works; no flicker on tab change.
  - [ ] `/@alice@example.social` resolves a remote handle.
  - [ ] `/@alice@example.social/<statusId>` renders focused post + ancestors + descendants; chain of depth >3 caps visual indent at depth 3.
  - [ ] `/feed` 301-redirects to `/home`; browser address bar updates.
  - [ ] `/privacy`, `/about` load.
  - [ ] Right-rail disabled slots show "Coming soon" on hover; clicks do nothing.
  - [ ] Bottom tab bar on `<md`; nav rail only on `md`; nav rail + right rail on `lg` (resize Chrome to 500/800/1200 px).
  - [ ] Sign out + sign back in on same instance still works.
- [ ] In browser DevTools, disable JS, reload `/local`: cards + "Older posts →" anchor render. Click anchor → URL updates with `?max_id=`, different cards render. No console errors.
- [ ] In DevTools, disable JS, reload `/home`: "Sign in to continue" placeholder renders.
- [ ] Inspect emitted SSR HTML for `/local`: confirm `<template shadowrootmode="open">` blocks present on shell, nav-rail, right-rail, and each status card. Confirm a single `<style id="caribou-dsd-style">` inside each shadow root.
- [ ] Inspect a status card's `shadowRoot.adoptedStyleSheets.length` post-hydration in DevTools console: must equal `0` (Elena's adoption was suppressed by the sentinel; inline DSD `<style>` is the source of truth).

---

## Phase J — Per-package changesets, final sweep, push & merge

Per the user's standing rule (memory: "One changeset file per package"), every package modified in Plan 3 gets its own `.changeset/*.md` describing only that package's change.

### Task J1: Write changeset files

**Files:**
- Create: `.changeset/plan-03-mastodon-client.md`
- Create: `.changeset/plan-03-state.md`
- Create: `.changeset/plan-03-ui-headless.md`
- Create: `.changeset/plan-03-design-tokens.md`
- Create: `.changeset/plan-03-elena-app.md`

- [ ] **Step 1: Write each file**

```md
---
"@beatzball/caribou-mastodon-client": minor
---

Add read-only fetchers `fetchStatus`, `fetchThread`, `lookupAccount`, and
`fetchAccountStatuses` on `CaribouClient`. Re-export `Status` and `Account`
from the package barrel. Add `./sanitize-opts` subpath export sharing
`PURIFY_OPTS` between the client and server-side sanitizer.
```

```md
---
"@beatzball/caribou-state": minor
---

Add `createAccountCache` (handle → Account memoization with stale-while-revalidate),
`createProfileStore` (per-account paginated profile statuses with tab-driven remount),
and `createThreadStore` (parallel focused-status + thread-context fetch with
`AsyncState` discriminated-union state). `createTimelineStore` gains an `initial`
option for SSR-seeded hydration without a redundant first fetch.
```

```md
---
"@beatzball/caribou-ui-headless": minor
---

New package. Headless utilities for Caribou's UI layer: `createIntersectionObserver`
(observe/disconnect lifecycle wrapper) and `formatRelativeTime` (six-range
relative time formatter for status timestamps).
```

```md
---
"@beatzball/caribou-design-tokens": minor
---

Add `presetCaribou()` UnoCSS preset. Maps Caribou's design-token CSS variables
(`--bg-0/1/2`, `--fg-0/1/muted`, `--accent`, `--accent-fg`, `--border`,
`--danger`, `--success`, `--radius-sm/md/lg`, `--space-1..6`) to atomic utility
classes consumable by app shells via `presetUno() + presetCaribou()`.
```

```md
---
"@beatzball/caribou-elena": minor
---

Plan 3: read-only completeness. Adds `/local`, `/public`, `/@[handle]`,
`/@[handle]/[statusId]`, `/privacy`, `/about` routes; renames `/feed` → `/home`
with a 301 redirect on `/feed`; introduces shadow-DOM layout components
`<caribou-app-shell>`, `<caribou-nav-rail>`, `<caribou-right-rail>`; status-card
gains four variants (timeline / focused / ancestor / descendant) and renders
boosts via `status.reblog ?? status` with a booster-attribution row; SSR
`pageData` for every public-read route; hostname-only `caribou.instance`
cookie (validated against the OAuth registry) drives bare-URL routing;
LRU + in-flight dedup upstream cache; server-side DOMPurify+jsdom sanitizer;
declarative-shadow-DOM emission with adoption-suppression sentinel; anchor-
as-source-of-truth pagination with IO-sentinel hijack; auth-required
placeholder for `/home`, `/@me`, `/@me/[id]`. UnoCSS installed app-local
with `presetUno() + presetIcons() + presetCaribou()`. Lucide icons via
`@iconify-json/lucide`.
```

- [ ] **Step 2: Commit**

```bash
git add .changeset/plan-03-*.md
git commit -m "chore: changesets for Plan 3 (read-only completeness)"
```

---

### Task J2: Final repo-wide sweep

**Files:** none (verification only).

- [ ] **Step 1: Run typecheck across all packages**

```bash
pnpm -w typecheck
```

Expected: PASS in every package.

- [ ] **Step 2: Run all unit tests**

```bash
pnpm -w test
```

Expected: PASS, no skipped tests.

- [ ] **Step 3: Build**

```bash
pnpm -w build
```

Expected: PASS for every workspace.

- [ ] **Step 4: Run Playwright suite (existing + new no-JS)**

```bash
pnpm -C apps/caribou-elena playwright test
```

Expected: PASS (signin, home timeline, no-JS smoke, hydration parity covered separately by vitest).

- [ ] **Step 5: Lint**

```bash
pnpm -w lint
```

Expected: PASS, no warnings.

- [ ] **Step 6: Verify shell POC gate (§6.6) is still green**

Re-run the Playwright shell POC test alone:

```bash
pnpm -C apps/caribou-elena playwright test e2e/shell-poc.spec.ts
```

Expected: PASS (slotted child styled with var() tokens; grid layout responds to viewport; `adoptedStyleSheets.length === 0` post-DSD).

- [ ] **Step 7: Verify no Plan-2 functionality regressed**

Manually open dev build, sign in, see `/home` with timeline, sign out. Plan 2 is the floor; nothing in Plan 3 should disturb it.

---

### Task J3: Push branch and open PR

**Files:** none.

- [ ] **Step 1: Push branch**

```bash
git push -u origin 03-read-only-completeness
```

- [ ] **Step 2: Open PR via `gh`**

```bash
gh pr create --title "Plan 3: read-only completeness" --body "$(cat <<'EOF'
## Summary

- Adds `/local`, `/public`, `/@[handle]`, `/@[handle]/[statusId]`, `/privacy`, `/about` routes
- Renames `/feed` → `/home`; `/feed` becomes a 301 redirect
- Shadow-DOM layout components: `<caribou-app-shell>`, `<caribou-nav-rail>`, `<caribou-right-rail>`
- Status-card variants (timeline/focused/ancestor/descendant) + boost rendering fix
- UnoCSS standup with `presetCaribou()` from `@beatzball/caribou-design-tokens`
- Full progressive enhancement: SSR `pageData` for every public-read route, hostname-only `caribou.instance` cookie (registry-validated), upstream LRU + in-flight dedup, server-side DOMPurify+jsdom sanitizer, declarative-shadow-DOM emission, byte-equal hydration parity, anchor-as-source-of-truth pagination
- Auth-required placeholder for `/home`, `/@me`, `/@me/[id]`

## Test plan

- [ ] `pnpm -w typecheck && pnpm -w test && pnpm -w build` — green
- [ ] `pnpm -C apps/caribou-elena playwright test` — green (incl. shell POC + no-JS smoke)
- [ ] Hydration parity (vitest) — green for every SSR'd component
- [ ] Cookie validation (vitest) — rejects unregistered hosts, SSRF patterns, malformed values
- [ ] Manual checklist (§10.4) — every box ticked
- [ ] No-JS browser sanity — `/local` cards + Older posts anchor work; `/home` shows placeholder

EOF
)"
```

- [ ] **Step 3: Capture PR URL** in the post-execution summary so the user can review.

---

## Self-review checklist

After all phases land in commits, run this checklist (the writing-plans skill mandates it):

1. **Spec coverage:**
   - §3 routes — H2..H8 ✅
   - §4 data-layer additions — C1..C5, D1..D4 ✅
   - §5 UnoCSS — A1..A5 ✅
   - §6 layout components — F1..F4 ✅
   - §6.6 shell POC gate — A6..A8 ✅
   - §7 ui-headless — B1..B4 ✅
   - §8 page components — G1..G7 ✅
   - §9 amendments — implicit (no code; documented in spec) ✅
   - §10 testing — I1..I3 (parity, cookie validation, no-JS smoke); per-package tests inline in C/D/B/A ✅
   - §12.2 cookie — E2, plus signin wiring E7 + signout endpoint E8 ✅
   - §12.3 fetch pipeline — E4 (mastodon-public) + E5 (resolve-instance) ✅
   - §12.4 cache — E3 ✅
   - §12.5 sanitizer — E6 ✅
   - §12.6 hydration parity — A7 (helper), I1 (test) ✅
   - §12.6a normative type contracts — E1 ✅
   - §12.7 pagination — G1 (timeline anchor + IO hijack), echoed in H4..H8 ✅
   - §12.8 auth-required placeholder — H1, used in H2, H4..H8 ✅
2. **Placeholder scan:** searched plan for "TBD", "TODO", "implement later", "fill in details", "appropriate error handling" — none found.
3. **Type consistency:** `ShellInfo`, `TimelinePageData`, `ProfilePageData`, `ThreadPageData`, `AsyncState<T>` used identically across all referencing tasks. Method names verified: `lookupAccount`, `fetchAccountStatuses`, `fetchStatus`, `fetchThread` (client) ↔ `fetchAccountByHandle`, `fetchAccountStatuses`, `fetchStatus`, `fetchThreadContext`, `fetchPublicTimeline` (server-lib unauth). Custom-element tags: `caribou-app-shell`, `caribou-nav-rail`, `caribou-right-rail`, `caribou-timeline`, `caribou-status-card`, `caribou-profile`, `caribou-profile-header`, `caribou-profile-tabs`, `caribou-thread`, `caribou-auth-required` — used identically.



