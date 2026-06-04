# Caribou `<caribou-list-mount>` SSR DSD adoption — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the SSR-paint flash on `/local` and `/public` by making `<caribou-list-mount>` an Elena component with DSD-emitted `<li data-key>` children. `<caribou-timeline>` serializes its items into the new `initial-items-html` attribute via a small helper. The keyed reconciler already supports SSR-emitted children — no contract change needed.

**Scope:** Timeline only. `<caribou-profile>` and `<caribou-thread>` share the SSR-paint flash, but their `<li>` shapes are richer (variant attribute, depth-styling, tree ordering) and they need their own serializers. Both inherit the type-import path change from this PR (mechanical) but their render() updates land in separate follow-up PRs once the Elena `<caribou-list-mount>` + helper pattern is proven on the highest-impact route.

**Architecture:** Move `<caribou-list-mount>` from `packages/caribou-ui-headless/src/list-mount.ts` (plain `HTMLElement`) to `apps/caribou-elena/pages/components/caribou-list-mount.ts` (Elena component with `shadow: 'open'`, `static styles`, and an `initial-items-html` prop). Delete the plain version — the "future caribou-lit / caribou-fast adapters might want it" rationale was speculative and those adapters would need their own list-mount anyway because Lit/FAST reactivity differs from Elena's. Inline comment in the new file documents the adapter framing. The keyed reconciler stays in `caribou-ui-headless` — it really is framework-agnostic. A small helper `_render-status-li.ts` does manual attribute escaping for the inner HTML string passed via `initial-items-html` (Elena's tagged template handles the outer attribute slot).

**Tech Stack:** Elena (`@elenajs/core` — shadow + DSD + `unsafeHTML`), `@beatzball/caribou-ui-headless` (reconciler — unchanged), vitest + happy-dom (component unit), vitest (SSR integration), Playwright with `javaScriptEnabled: false` (no-JS smoke).

**Spec:** `docs/superpowers/specs/2026-06-03-caribou-list-mount-ssr-dsd-design.md`

---

## Pre-flight

- [ ] **Verify worktree + branch**

```bash
git worktree list
git branch --show-current  # should be a new branch off main, e.g. ssr-paint-list-mount
git log -1 --oneline       # should be on the merged main (0424963 or later)
```

- [ ] **Baseline green**

```bash
pnpm --filter caribou-elena typecheck
pnpm --filter caribou-elena test
pnpm --filter caribou-elena exec playwright test --project=chromium
```

All three green before starting any task.

---

## Task 1: SSR `<li>` serializer `_render-status-li.ts` (TDD)

**Files:**
- Create: `apps/caribou-elena/pages/components/_render-status-li.ts`
- Create: `apps/caribou-elena/pages/components/__tests__/_render-status-li.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/_render-status-li.test.ts
import { describe, it, expect } from 'vitest'
import { renderStatusLi, renderStatusLiList } from '../_render-status-li.js'

const baseStatus = {
  id: '99', content: 'hi', createdAt: '2026-06-01T00:00:00.000Z',
} as unknown as Parameters<typeof renderStatusLi>[0]

describe('renderStatusLi', () => {
  it('emits an <li data-key> wrapping a <caribou-status-card>', () => {
    const html = renderStatusLi(baseStatus)
    expect(html).toMatch(/^<li data-key="99"><caribou-status-card status=".*"><\/caribou-status-card><\/li>$/)
  })

  it('escapes HTML-special characters in data-key (id)', () => {
    const s = { ...baseStatus, id: 'a"b&c<d>e' } as typeof baseStatus
    const html = renderStatusLi(s)
    expect(html).toContain('data-key="a&quot;b&amp;c&lt;d&gt;e"')
  })

  it('escapes HTML-special characters in the JSON status attribute', () => {
    const s = { ...baseStatus, content: '<script>"&\'</script>' } as typeof baseStatus
    const html = renderStatusLi(s)
    // The JSON itself contains escaped < > but the ATTRIBUTE must HTML-escape & and "
    expect(html).not.toContain('"<')              // raw < cannot appear unescaped in the attr
    expect(html).not.toContain('""')              // adjacent unescaped quote would break out
    expect(html).toContain('&quot;')              // " always escaped
  })

  it('round-trips: JSON.parse(unescape(attr-value)) === status', () => {
    const s = { ...baseStatus, content: '<p>hello "world" &amp; friends</p>' } as typeof baseStatus
    const html = renderStatusLi(s)
    const m = /status="([^"]*)"/.exec(html)!
    const raw = m[1]!
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
    expect(JSON.parse(raw)).toEqual(s)
  })

  it('renderStatusLiList concatenates with no separator', () => {
    const a = { ...baseStatus, id: '1' } as typeof baseStatus
    const b = { ...baseStatus, id: '2' } as typeof baseStatus
    const html = renderStatusLiList([a, b])
    expect(html).toBe(renderStatusLi(a) + renderStatusLi(b))
  })

  it('renderStatusLiList returns empty string for empty input', () => {
    expect(renderStatusLiList([])).toBe('')
  })
})
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm --filter caribou-elena exec vitest run pages/components/__tests__/_render-status-li.test.ts
```

Expected: import error (file doesn't exist).

- [ ] **Step 3: Implement**

```ts
// _render-status-li.ts
import type { mastodon } from 'masto'

// HTML attribute-value escaping. Covers the five characters the HTML spec
// requires when emitting an attribute via raw string concatenation. The
// JSON.stringify ahead of this already escapes `\` and `"` for JSON's own
// grammar; this pass then escapes `&` and `"` for HTML's. Order matters:
// `&` first so we don't double-escape entities we introduce.
const ENTITIES: Record<string, string> = {
  '&': '&amp;', '"': '&quot;', "'": '&#39;', '<': '&lt;', '>': '&gt;',
}
function escapeHtmlAttr(s: string): string {
  return s.replace(/[&"'<>]/g, (c) => ENTITIES[c]!)
}

export function renderStatusLi(s: mastodon.v1.Status): string {
  const key = escapeHtmlAttr(s.id)
  const statusJson = escapeHtmlAttr(JSON.stringify(s))
  return `<li data-key="${key}"><caribou-status-card status="${statusJson}"></caribou-status-card></li>`
}

export function renderStatusLiList(items: readonly mastodon.v1.Status[]): string {
  if (items.length === 0) return ''
  let out = ''
  for (const s of items) out += renderStatusLi(s)
  return out
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```
feat(caribou-elena): _render-status-li serializer for SSR <li> children

Concatenates <li data-key><caribou-status-card status></caribou-status-card></li>
from a Status array; manually HTML-attribute-escapes since the consumer
uses unsafeHTML to inject the result into <caribou-list-mount>'s shadow.
Five-char attribute-value escape (& " ' < >); round-trip tests cover the
escape contract.
```

---

## Task 2: Replace `<caribou-list-mount>` with the Elena variant (TDD)

**Files:**
- Delete: `packages/caribou-ui-headless/src/list-mount.ts` (and its test, if any)
- Modify: `packages/caribou-ui-headless/src/index.ts` (drop the export)
- Create: `apps/caribou-elena/pages/components/caribou-list-mount.ts`
- Create: `apps/caribou-elena/pages/components/__tests__/caribou-list-mount.test.ts`
- Modify (type-import path only): `apps/caribou-elena/pages/components/caribou-timeline.ts`, `caribou-profile.ts`, `caribou-thread.ts`

- [ ] **Step 1: Write the failing test for the Elena variant**

```ts
// caribou-elena/pages/components/__tests__/caribou-list-mount.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

beforeAll(async () => {
  await import('../caribou-list-mount.js')
})

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('<caribou-list-mount> (Elena)', () => {
  it('attaches an open shadow root with a <ul> mount', async () => {
    const el = document.createElement('caribou-list-mount') as HTMLElement & { mountUl: HTMLUListElement }
    document.body.appendChild(el)
    await Promise.resolve()
    expect(el.shadowRoot).not.toBeNull()
    expect(el.shadowRoot!.querySelector('ul')).not.toBeNull()
    expect(el.mountUl).toBe(el.shadowRoot!.querySelector('ul'))
  })

  it('renders the empty shadow when initial-items-html is unset', async () => {
    const el = document.createElement('caribou-list-mount')
    document.body.appendChild(el)
    await Promise.resolve()
    expect(el.shadowRoot!.querySelector('ul')!.children.length).toBe(0)
  })

  it('renders the initial-items-html children into the shadow <ul>', async () => {
    const el = document.createElement('caribou-list-mount') as HTMLElement & { initialItemsHtml: string }
    el.setAttribute('initial-items-html', '<li data-key="a"><span>A</span></li><li data-key="b"><span>B</span></li>')
    document.body.appendChild(el)
    await Promise.resolve()
    const lis = Array.from(el.shadowRoot!.querySelector('ul')!.children) as HTMLElement[]
    expect(lis.length).toBe(2)
    expect(lis[0]!.dataset.key).toBe('a')
    expect(lis[1]!.dataset.key).toBe('b')
  })
})
```

- [ ] **Step 2: Run — expect fail** (module not found).

- [ ] **Step 3: Implement the Elena variant**

```ts
// apps/caribou-elena/pages/components/caribou-list-mount.ts

// Elena adapter. Lit/FAST adapters would need separate impls; the keyed reconciler depends only on the morph-opaque shadow boundary.
import { Elena, html, unsafeHTML } from '@elenajs/core'

const STYLES = `
  :host { display: block; }
  ul { list-style: none; margin: 0; padding: 0; }
`

export class CaribouListMount extends Elena(HTMLElement) {
  static override tagName = 'caribou-list-mount'
  static override shadow = 'open' as const
  static override styles = STYLES
  static override props = [{ name: 'initial-items-html', reflect: false }]

  initialItemsHtml: string = ''

  override render() {
    return html`<ul>${this.initialItemsHtml ? unsafeHTML(this.initialItemsHtml) : html``}</ul>`
  }

  get mountUl(): HTMLUListElement {
    return this.shadowRoot!.querySelector('ul')!
  }
}
CaribouListMount.define()
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Delete the plain version + drop the package barrel export**

```bash
rm packages/caribou-ui-headless/src/list-mount.ts
rm -f packages/caribou-ui-headless/src/__tests__/list-mount.test.ts
```

Edit `packages/caribou-ui-headless/src/index.ts` and remove the line that re-exports `./list-mount.js`.

Run `pnpm --filter caribou-ui-headless test` — should still pass (its remaining tests cover the reconciler and other primitives, not list-mount).

- [ ] **Step 6: Fix the broken type imports in timeline / profile / thread**

The deleted package export breaks three type-only imports. Update each:

```ts
// caribou-timeline.ts, caribou-profile.ts, caribou-thread.ts
- import type { CaribouListMount } from '@beatzball/caribou-ui-headless'
+ import type { CaribouListMount } from './caribou-list-mount.js'
```

`pnpm --filter caribou-elena typecheck` — expect clean.

- [ ] **Step 7: Side-effect import in timeline (and only timeline)** so the Elena `<caribou-list-mount>` is registered when the timeline loads. Profile and thread defer their wire-up to follow-up PRs; their existing usages of `<caribou-list-mount>` continue to work because the timeline's side-effect import has already registered the element by the time those routes load (the timeline component is imported transitively via `pages/local.ts`, `pages/public.ts`, AND `pages/home.ts` — covering all profile / thread parent contexts that share the app shell).

If that transitive-import assumption doesn't hold for a given test environment (vitest individual test files won't auto-load the timeline), add a side-effect import directly in `caribou-profile.ts` and `caribou-thread.ts`:
```ts
import './caribou-list-mount.js'
```

- [ ] **Step 8: Commit**

```
feat(caribou-elena): Elena <caribou-list-mount> with DSD-emit support

Replaces the plain HTMLElement implementation in caribou-ui-headless
with an Elena component in caribou-elena. Accepts an initial-items-html
prop that unsafeHTML-injects the SSR-rendered <li data-key> children
into the shadow <ul>. SSR via Elena adapter's renderComponent emits
<template shadowrootmode="open">, so the browser pre-populates the
shadow UL before JS runs.

The plain HTMLElement version is removed entirely — its rationale was
speculative scaffolding for caribou-lit / caribou-fast adapters that
don't exist and would need their own list-mount anyway because Lit's
ReactiveElement and FAST's FASTElement reactivity differ from Elena's.

caribou-profile and caribou-thread continue to render
<caribou-list-mount></caribou-list-mount> empty; their SSR-paint flash
fix lands in follow-up PRs.
```

---

## Task 3: Wire `<caribou-timeline>` to emit `initial-items-html` (TDD)

**Files:**
- Modify: `apps/caribou-elena/pages/components/caribou-timeline.ts`
- Modify: `apps/caribou-elena/pages/components/__tests__/caribou-timeline.test.ts` (or create one if absent)

- [ ] **Step 1: Verify existing timeline test still passes (baseline)**

```bash
pnpm --filter caribou-elena exec vitest run pages/components/__tests__/caribou-timeline.test.ts 2>&1
```

If no test exists yet, skip this step and create one in step 2.

- [ ] **Step 2: Write failing assertion: SSR output of caribou-timeline with `initial` set contains `<caribou-status-card>` × N**

The cleanest path is to call `renderComponent` directly. Set up the test in `tests/integration/ssr-timeline-paint.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import '../../pages/components/caribou-timeline.js'
import '../../pages/components/caribou-list-mount.js'
import '../../pages/components/caribou-status-card.js'
// renderComponent is internal to the Litro Elena adapter — drive it
// indirectly via the CE registry the SSR shim exposes.

it('SSR caribou-timeline with initial produces N status cards in the shadow', () => {
  const ceMap = (globalThis as unknown as { __litro_elena_ce_map__?: Map<string, CustomElementConstructor> }).__litro_elena_ce_map__
  const Tl = ceMap?.get('caribou-timeline')
  expect(Tl).toBeTruthy()
  // ... drive renderComponent or call Tl's render path manually
})
```

(See the Elena SSR adapter's `renderComponent` in `node_modules/.pnpm/@beatzball+litro.../dist/adapter/elena/index.js`; the test can wrap it or shim.)

- [ ] **Step 3: Run — expect fail** (timeline render still emits empty list-mount).

- [ ] **Step 4: Modify caribou-timeline render**

In `apps/caribou-elena/pages/components/caribou-timeline.ts`, inside the existing render():

```ts
import { renderStatusLiList } from './_render-status-li.js'
// ...
override render() {
  // ... existing error / loading / empty checks
  const lastList = this.statuses.length > 0 ? this.statuses : fallback
  // ...
  const itemsHtml = renderStatusLiList(lastList)
  return html`
    <div>
      <caribou-new-posts-banner></caribou-new-posts-banner>
      <caribou-list-mount initial-items-html="${itemsHtml}"></caribou-list-mount>
      ${nextHref
        ? html`<a href="${nextHref}" rel="next" data-sentinel
                 style="display:block;padding:var(--space-4);color:var(--fg-muted);text-align:center;">Older posts →</a>`
        : html``}
    </div>
  `
}
```

Switch the existing `import './caribou-list-mount.js'` (was the plain version) to the new Elena one if not already done by Task 2's wiring.

- [ ] **Step 5: Update reconciler client-side path**

The timeline's `reconcile()` already uses `mount.mountUl`. The new Elena list-mount exposes `mountUl` returning the shadow `<ul>` — same shape, no change needed.

- [ ] **Step 6: Run — expect pass**

- [ ] **Step 7: Verify existing timeline test still passes**

- [ ] **Step 8: Typecheck + commit**

```
feat(caribou-elena): caribou-timeline emits SSR <li> children via list-mount

When initial.statuses is present, serializes the items through
renderStatusLiList and passes the HTML string to <caribou-list-mount>'s
initial-items-html attribute. The list-mount's DSD-emitted shadow UL
arrives in the browser with cards already rendered; the reconciler's
first pass picks them up by data-key and just rebinds card.status.

Eliminates the structural-shell flash on /local, /public.
```

---

## Task 4: SSR integration test — `/local` returns `<caribou-status-card>` × N in HTML

**Files:**
- Create: `apps/caribou-elena/tests/integration/ssr-list-paint.test.ts`

- [ ] **Step 1: Write the test**

This test boots a minimal nitro server or stubs the SSR pipeline. The simpler path: build once, then `vitest` + `fetch` against a server started in a beforeAll/afterAll. Or use the existing `tests/integration/ssr-hydration-parity-shell.test.ts` harness.

```ts
import { describe, it, expect } from 'vitest'
// Use the same harness as existing SSR parity tests.

it('SSR /local with cookie + registered instance returns 20 <caribou-status-card> in HTML', async () => {
  const html = await renderRoute('/local', { cookies: 'caribou.instance=fosstodon.org' })
  const count = (html.match(/<caribou-status-card /g) || []).length
  expect(count).toBeGreaterThan(0)
  // For a fixed-fixture mock fetcher, lock to exact count (e.g. 20):
  // expect(count).toBe(20)
})
```

(If the existing harness doesn't support this shape, adjust or write a thinner one.)

- [ ] **Step 2: Run — expect pass** (Task 3 already shipped the production code).

- [ ] **Step 3: Commit**

```
test(caribou-elena): SSR integration — /local emits status cards in HTML

Confirms the SSR-paint flash is gone end-to-end: server-rendered HTML
for /local contains <caribou-status-card> elements with serialized
status JSON, not just the structural shell.
```

---

## Task 5: No-JS Playwright e2e

**Files:**
- Create: `apps/caribou-elena/tests/e2e/no-js-public-timeline.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { expect, test } from '@playwright/test'

test.use({ javaScriptEnabled: false })

// Hits the real fosstodon.org via SSR pageData fetch — same constraint
// as public-timeline.spec.ts. Skip in CI.
test.skip(!!process.env.CI, 'Hits real upstream; skip in CI')

test('/local renders status cards with JS disabled', async ({ page, context }) => {
  await context.addCookies([{
    name: 'caribou.instance', value: 'fosstodon.org',
    domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax',
  }])
  await page.goto('/local')
  const count = await page.locator('caribou-status-card').count()
  expect(count).toBeGreaterThan(0)
})

test('/local "Older posts" anchor navigates without JS', async ({ page, context }) => {
  await context.addCookies([{
    name: 'caribou.instance', value: 'fosstodon.org',
    domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax',
  }])
  await page.goto('/local')
  const anchor = page.locator('a[rel="next"][data-sentinel]')
  await expect(anchor).toBeVisible()
  const href = await anchor.getAttribute('href')
  expect(href).toMatch(/^\/local\?max_id=/)
})
```

- [ ] **Step 2: Run — expect pass**

```bash
pnpm --filter caribou-elena build
PORT=4321 STORAGE_DIR=$(pwd)/apps/caribou-elena/.data node apps/caribou-elena/dist/server/server/index.mjs &
E2E_BASE_URL=http://localhost:4321 pnpm --filter caribou-elena exec playwright test tests/e2e/no-js-public-timeline.spec.ts --project=chromium
```

- [ ] **Step 3: Commit**

```
test(caribou-elena): no-JS Playwright smoke for /local cards + pagination

Plan 3 Exit Criterion #8: JS-disabled visit to /local sees rendered
cards and a working "Older posts" anchor with ?max_id= query. Skipped
in CI per the existing upstream-network policy.
```

---

## Task 6: Verify avatar-no-refetch invariant + hydration parity still hold

- [ ] **Step 1: Existing avatar-no-refetch e2e — green in isolation**

```bash
E2E_BASE_URL=http://localhost:4321 pnpm --filter caribou-elena exec playwright test tests/e2e/home.spec.ts --project=chromium -g "avatar"
```

If it fails: the reconciler's hydration-time card.status reassignment may now be triggering avatar refetch. Adjust the spec or the timeline's update callback to compare deep-equal before reassignment.

- [ ] **Step 2: Existing hydration-parity test — green**

```bash
pnpm --filter caribou-elena exec vitest run tests/integration/ssr-hydration-parity-shell.test.ts
```

If it fails due to the new SSR-emitted children: adjust the parity helper's whitespace normalization, not the production output.

- [ ] **Step 3: Full vitest + Playwright run**

```bash
pnpm --filter caribou-elena test
E2E_BASE_URL=http://localhost:4321 pnpm --filter caribou-elena exec playwright test --project=chromium
```

If any fails: triage before proceeding. Common causes:
- Test snapshots / golden HTML capturing the old empty-list-mount shape — update the snapshots.
- The plain `<caribou-list-mount-plain>` rename broke a workspace dep — fix the import.

---

## Task 7: Changesets (one per affected package)

- [ ] **Step 1: Write `.changeset/list-mount-ssr-dsd.md` (caribou-elena)**

```markdown
---
"caribou-elena": patch
---

`<caribou-list-mount>` moves into caribou-elena as an Elena component (`shadow: 'open'`, DSD-aware). It accepts an `initial-items-html` attribute that `unsafeHTML`-injects pre-rendered `<li data-key>` children into the shadow `<ul>`. The previous behavior (empty shadow UL populated only by the imperative reconciler) is preserved on the client; the new SSR path emits the full populated list so first paint of `/local` and `/public` shows cards instead of an empty structural shell.

`<caribou-timeline>` now serializes its SSR-known statuses via a new `_render-status-li.ts` helper and passes the result through `initial-items-html`. The keyed reconciler's existing SSR-emitted-children contract picks up the `<li data-key>` children on hydration and rebinds `card.status` per item (one reassignment per card on first paint; steady-state polls remain no-ops, preserving the avatar-no-refetch invariant).

`<caribou-profile>` and `<caribou-thread>` still render an empty `<caribou-list-mount>` and populate it imperatively via the reconciler on client hydration. Their SSR-paint flash fix lands in follow-up PRs.

Plan 3 Exit Criterion #8 (no-JS smoke test sees cards on `/local`) now passes in the spirit, not just the letter.
```

- [ ] **Step 2: Write `.changeset/list-mount-removed.md` (caribou-ui-headless)**

```markdown
---
"@beatzball/caribou-ui-headless": patch
---

Removes the plain `HTMLElement`-based `CaribouListMount` export. The class and its `<caribou-list-mount>` tag registration move into caribou-elena as an Elena component with SSR Declarative Shadow DOM support. The keyed reconciler stays in this package — it really is framework-agnostic.

The "future caribou-lit / caribou-fast adapters might want a no-framework list-mount" rationale was speculative scaffolding; if/when those adapters are built they'll need their own list-mount because Lit's `ReactiveElement` and FAST's `FASTElement` reactivity differ from Elena's. No current consumer used the plain version directly.
```

- [ ] **Step 3: Commit**

```
chore: changesets for list-mount SSR DSD adoption + plain version removal
```

---

## Task 8: Manual verification (dev server)

- [ ] **Step 1: Run the dev server**

```bash
pnpm --filter caribou-elena dev
```

- [ ] **Step 2: Sign in once** to seed `caribou.instance` cookie + OAuth app record.

- [ ] **Step 3: Sign out** so localStorage is empty (cookie persists).

- [ ] **Step 4: Visit `/local` with browser cache disabled + network throttled to 3G**

Confirm: cards visible from first paint. No transition from empty list to populated.

- [ ] **Step 5: Visit `/public`** — same confirmation.

- [ ] **Step 6: Visit a profile `/@user@instance` and a thread `/@user@instance/[statusId]`** — confirm the SSR-paint flash *still exists* for these routes (expected for this PR's scope; flag for the follow-up PRs).

- [ ] **Step 7: View page source** on `/local`. Confirm `<caribou-status-card>` tags appear inside the `<caribou-list-mount>`'s `<template shadowrootmode="open">`.

- [ ] **Step 8: Stop the dev server.**

---

## Self-review checklist (before pushing)

- [ ] All 8 tasks complete; each commit is independently sensible.
- [ ] `pnpm --filter caribou-elena vitest run` — all unit + integration green.
- [ ] `pnpm --filter caribou-elena exec playwright test --project=chromium` — green (1 expected skip on the avatar test under parallel; consider running it isolated).
- [ ] `pnpm --filter caribou-elena typecheck` — no new errors.
- [ ] `pnpm --filter caribou-elena build` — clean.
- [ ] CI grep guard: `git grep -E "from '@beatzball/caribou-ui-headless'.*list-mount|CaribouListMount.*from '@beatzball/caribou-ui-headless'" apps/` returns empty.
- [ ] Memory: update `caribou-public-route-feed-restoration`'s "Open follow-up" section — timeline branch closed; profile + thread tracked separately.
