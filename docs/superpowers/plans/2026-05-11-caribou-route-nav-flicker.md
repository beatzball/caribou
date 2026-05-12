# Caribou — Public-Read Route SSR List Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SSR the populated `<ul><li>` status list inside `<caribou-list-mount>` on `/local`, `/public`, `/@user@host`, and `/@user@host/[statusId]` so cross-route navigation paints with content instead of an empty timeline.

**Architecture:** A new `renderPopulatedListMount(items, opts)` server-side helper composes the mount's declarative-shadow-DOM (DSD) HTML, calling `renderShadowComponentToString` once per status card. Each page's `pageData()` computes the helper output once at fetch time and stashes it as a `populatedListHtml` string on the data shape; the page's `render()` embeds it via `unsafeHTML(...)`. Server-now is threaded through `pageData → data-rendered-at attribute → card.render()` so the first client-side render reproduces the SSR timestamp byte-for-byte and Elena's morph is a no-op on hydration.

**Tech Stack:** TypeScript, Vitest + happy-dom, Elena custom elements (`@elenajs/core`), DOMPurify + jsdom (server-side sanitization, existing), `<template shadowrootmode="open">` declarative shadow DOM, existing `renderShadowComponentToString` helper from Plan 3.

**Spec:** `docs/superpowers/specs/2026-05-11-caribou-route-nav-flicker-design.md`

---

## Exit Criteria

All of the following must be true before this plan is considered done:

1. `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all pass from a clean worktree.
2. `renderShadowComponentToString` accepts both the legacy `Record<string, string|null|undefined>` form and the explicit `{ attrs, props }` form, with TypeScript overloads + structural runtime detection.
3. `formatRelativeTime(date, nowMs?)` accepts an optional `now` parameter; default behavior unchanged.
4. `<caribou-status-card>` reads `dataset.renderedAt` on connect and uses it as "now" for the first render only; subsequent renders use `Date.now()`.
5. `renderPopulatedListMount(items, opts)` exists in `apps/caribou-elena/server/lib/render-populated-list.ts`, returns deterministic byte-equal output for fixed inputs, sanitizes per the existing card path, and handles empty, N-item, depth, and mixed-variant cases.
6. `getServerNowMs()` exists in `apps/caribou-elena/server/lib/server-now.ts` and is the single source of "now" for SSR.
7. `TimelinePageData`, `ProfilePageData`, `ThreadPageData` carry `serverNowMs: number` and (on the success branch) `populatedListHtml: string`.
8. All four public-read routes' `pageData()` populate the new fields and their `render()` embeds the HTML via `unsafeHTML`.
9. Hydration-parity tests cover: cards with status data via the new `{ attrs, props }` form; the populated-list helper byte-equality across two invocations.
10. Per-route integration tests assert each route's `pageData()` produces HTML containing N `<li data-key>` markers with recognizable card content.
11. The existing Plan 3 no-JS Playwright test for `/local` still passes.
12. One `.changeset/*.md` per modified package.
13. PR body draft prepared at `docs/pr-notes/2026-05-11-route-nav-flicker-pr-body.md`.

---

## File Structure

### Created by this plan

```
caribou/
├── apps/caribou-elena/
│   ├── server/
│   │   ├── lib/
│   │   │   ├── server-now.ts                                  # getServerNowMs()
│   │   │   ├── render-populated-list.ts                       # the SSR composition helper
│   │   │   └── __tests__/
│   │   │       ├── server-now.test.ts
│   │   │       └── render-populated-list.test.ts
│   └── tests/integration/route-ssr/
│       ├── local-pagedata-ssr.test.ts
│       ├── public-pagedata-ssr.test.ts
│       ├── profile-pagedata-ssr.test.ts
│       └── thread-pagedata-ssr.test.ts
├── docs/
│   └── pr-notes/
│       └── 2026-05-11-route-nav-flicker-pr-body.md
└── .changeset/
    ├── <hash>-route-ssr-list.md                                # caribou-elena
    └── <hash>-ui-headless-format-now.md                        # @beatzball/caribou-ui-headless
```

### Modified by this plan

```
caribou/
├── apps/caribou-elena/
│   ├── server/lib/
│   │   ├── render-shadow.ts                                   # add {attrs, props} overload
│   │   └── page-data-types.ts                                 # add serverNowMs + populatedListHtml fields
│   ├── pages/
│   │   ├── local.ts                                           # pageData + render() adoption
│   │   ├── public.ts                                          # pageData + render() adoption
│   │   ├── @[handle].ts                                       # profile page adoption
│   │   ├── @[handle]/[statusId].ts                            # thread page adoption
│   │   └── components/
│   │       └── caribou-status-card.ts                         # now-resolution from dataset.renderedAt
│   ├── tests/integration/
│   │   └── hydration-parity.test.ts                           # add populated-list cases + new-form usage
│   └── pages/components/__tests__/
│       └── caribou-status-card-now.test.ts                    # new now-resolution unit test (NEW file)
└── packages/caribou-ui-headless/
    └── src/
        ├── relative-time.ts                                   # formatRelativeTime(date, nowMs?)
        └── __tests__/
            └── relative-time.test.ts                          # add nowMs parameter tests
```

---

## Task 1: `formatRelativeTime` accepts optional `nowMs`

**Goal of this task:** Extend `formatRelativeTime(date)` in `@beatzball/caribou-ui-headless` to accept an optional `nowMs: number` parameter, defaulting to `Date.now()`. Non-breaking: existing call sites unaffected.

**Files:**
- Modify: `packages/caribou-ui-headless/src/relative-time.ts`
- Modify: `packages/caribou-ui-headless/src/__tests__/relative-time.test.ts`

- [ ] **Step 1: Read the current relative-time.ts**

Run: `cat packages/caribou-ui-headless/src/relative-time.ts`

Note the existing signature (likely `formatRelativeTime(date: Date | string): string`) and the implementation. The change is additive — append an optional second parameter that defaults to `Date.now()`.

- [ ] **Step 2: Write a failing test**

Append to `packages/caribou-ui-headless/src/__tests__/relative-time.test.ts`:

```ts
describe('formatRelativeTime — explicit nowMs', () => {
  it('uses the provided nowMs instead of Date.now()', () => {
    const created = new Date('2026-05-11T07:00:00Z')
    // "now" is 5 minutes after creation
    const nowMs = new Date('2026-05-11T07:05:00Z').getTime()
    const result = formatRelativeTime(created, nowMs)
    // Match whatever the existing format uses; the assertion is that
    // the result reflects the explicit nowMs, not real-clock Date.now().
    expect(result).toMatch(/5m|5 min|5 minutes/i)
  })

  it('falls back to Date.now() when nowMs is omitted', () => {
    // We can't assert exact text without freezing the clock, but we can
    // assert the function still returns a non-empty string with the
    // legacy single-argument call.
    const created = new Date(Date.now() - 60_000) // 1 minute ago
    const result = formatRelativeTime(created)
    expect(result.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @beatzball/caribou-ui-headless test relative-time`

Expected: the first test FAILS because `formatRelativeTime` ignores the second argument (currently single-parameter). Or, if the function signature doesn't accept a second argument at all, the test would still run but match against `Date.now()`-based output, which is likely close enough to also pass — re-check by running and reading the failure. The second test should pass.

- [ ] **Step 4: Update the implementation**

Edit `packages/caribou-ui-headless/src/relative-time.ts`. Find the function signature and update:

```ts
// Before
export function formatRelativeTime(date: Date | string): string {
  const target = typeof date === 'string' ? new Date(date) : date
  const diff = Date.now() - target.getTime()
  // ...existing buckets and formatting...
}

// After
export function formatRelativeTime(date: Date | string, nowMs?: number): string {
  const target = typeof date === 'string' ? new Date(date) : date
  const now = nowMs ?? Date.now()
  const diff = now - target.getTime()
  // ...existing buckets and formatting... (no other changes)
}
```

The only change is parameter + line that computes `diff`. Keep all bucket logic identical.

- [ ] **Step 5: Run the test to verify pass**

Run: `pnpm --filter @beatzball/caribou-ui-headless test relative-time`

Expected: all tests passing (existing + 2 new).

- [ ] **Step 6: Commit**

```bash
git add packages/caribou-ui-headless/src/relative-time.ts packages/caribou-ui-headless/src/__tests__/relative-time.test.ts
git commit -m "feat(caribou-ui-headless): formatRelativeTime accepts optional nowMs

Allows callers to pin 'now' for testing or for SSR/client hydration
parity. Non-breaking — single-argument callers continue to use
Date.now() as before."
```

---

## Task 2: `renderShadowComponentToString` accepts `{ attrs, props }` form

**Goal of this task:** Extend `renderShadowComponentToString` to accept an optional `{ attrs, props }` shape that distinguishes attribute-reflected entries from property-only entries. Backwards-compat: the legacy `Record<string, string | null | undefined>` form remains supported via structural runtime detection.

**Files:**
- Modify: `apps/caribou-elena/server/lib/render-shadow.ts`
- Test addition: existing test file or a new unit test file under `apps/caribou-elena/server/lib/__tests__/`

- [ ] **Step 1: Read render-shadow.ts**

Run: `cat apps/caribou-elena/server/lib/render-shadow.ts`

Familiarize with the current `renderShadowComponentToString(tagName, props)` signature, the attribute escaping loop, and the property-assignment loop.

- [ ] **Step 2: Write a failing test**

Create `apps/caribou-elena/server/lib/__tests__/render-shadow-attrs-props.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { JSDOM } from 'jsdom'

beforeAll(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  ;(globalThis as unknown as { window: typeof dom.window }).window = dom.window
  ;(globalThis as unknown as { document: Document }).document =
    dom.window.document as unknown as Document
  ;(globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement =
    dom.window.HTMLElement as unknown as typeof HTMLElement
  ;(globalThis as unknown as { customElements: CustomElementRegistry }).customElements =
    dom.window.customElements as unknown as CustomElementRegistry
})

describe('renderShadowComponentToString — { attrs, props } form', () => {
  beforeAll(async () => {
    await import('../../../pages/components/caribou-status-card.js')
  })

  it('reflects attrs as host element attributes', async () => {
    const { renderShadowComponentToString } = await import('../render-shadow.js')
    const html = await renderShadowComponentToString('caribou-status-card', {
      attrs: { variant: 'timeline', 'data-rendered-at': '1700000000000' },
    })
    expect(html).toContain('variant="timeline"')
    expect(html).toContain('data-rendered-at="1700000000000"')
  })

  it('does NOT reflect props as host attributes', async () => {
    const { renderShadowComponentToString } = await import('../render-shadow.js')
    const fakeStatus = { id: 'a', content: '<p>x</p>', account: { id: '1' } }
    const html = await renderShadowComponentToString('caribou-status-card', {
      attrs: { variant: 'timeline' },
      props: { status: fakeStatus },
    })
    expect(html).not.toContain('status="')
    expect(html).not.toContain('[object Object]')
  })

  it('legacy form (no attrs/props keys) treats whole object as attrs', async () => {
    const { renderShadowComponentToString } = await import('../render-shadow.js')
    const html = await renderShadowComponentToString('caribou-status-card', {
      variant: 'focused',
    })
    expect(html).toContain('variant="focused"')
  })

  it('empty object is accepted and produces a bare DSD shell', async () => {
    const { renderShadowComponentToString } = await import('../render-shadow.js')
    const html = await renderShadowComponentToString('caribou-status-card', {})
    expect(html).toMatch(/<caribou-status-card>.*<template shadowrootmode="open">/)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter caribou-elena test render-shadow-attrs-props`

Expected: the first two tests FAIL — current code treats the whole object as attrs, so `{ attrs: {...}, props: {...} }` would try to reflect "attrs" and "props" as host attributes (with `[object Object]` values).

- [ ] **Step 4: Update render-shadow.ts**

Replace the function body with overloads + structural detection:

```ts
// At the top of the file, after existing imports/types:

export interface AttrsAndProps {
  attrs?: Record<string, string | null | undefined>
  props?: Record<string, unknown>
}

type RenderArg =
  | Record<string, string | null | undefined>
  | AttrsAndProps

function isAttrsAndProps(arg: RenderArg): arg is AttrsAndProps {
  if (typeof arg !== 'object' || arg === null) return false
  const keys = Object.keys(arg)
  // Detection rule: explicit new form iff every enumerable key is one of
  // {attrs, props}. Empty objects are treated as new form (vacuously
  // true — both interpretations produce the same empty output).
  return keys.every((k) => k === 'attrs' || k === 'props')
}

// Replace the existing function:

export async function renderShadowComponentToString(
  tagName: string,
  arg: RenderArg = {},
): Promise<string> {
  const Cls = getClass(tagName)
  if (!Cls) {
    throw new Error(`renderShadowComponentToString: unknown tag "${tagName}" — did the component module load?`)
  }

  let attrs: Record<string, string | null | undefined>
  let props: Record<string, unknown>
  if (isAttrsAndProps(arg)) {
    attrs = arg.attrs ?? {}
    props = arg.props ?? {}
  } else {
    attrs = arg
    props = {}
  }

  const instance = new Cls()

  // Assign attrs to the instance (so render() sees them as properties)
  // AND reflect them as host attributes in the output.
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue
    ;(instance as unknown as Record<string, unknown>)[k] = v
  }

  // Assign props to the instance ONLY (no attribute reflection).
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue
    ;(instance as unknown as Record<string, unknown>)[k] = v
  }

  const tpl = instance.render()
  const inner = renderTemplate(tpl)

  const stylesText = flattenStyles((Cls as unknown as ElenaCtorStatics).styles)

  const attrEntries = Object.entries(attrs)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => ` ${k}="${escAttr(v)}"`)
    .join('')

  return (
    `<${tagName}${attrEntries}>` +
    `<template shadowrootmode="open">` +
    `<style id="${SENTINEL_ID}">${stylesText}</style>` +
    inner +
    `</template>` +
    `</${tagName}>`
  )
}

export const renderComponentToString = renderShadowComponentToString
```

- [ ] **Step 5: Run the test to verify pass**

Run: `pnpm --filter caribou-elena test render-shadow-attrs-props`

Expected: all 4 tests pass.

- [ ] **Step 6: Run the existing hydration-parity test to confirm no regression**

Run: `pnpm --filter caribou-elena test hydration-parity`

Expected: all existing cases still pass (they use the legacy form, which the structural detection correctly routes to the attrs-only branch).

- [ ] **Step 7: Commit**

```bash
git add apps/caribou-elena/server/lib/render-shadow.ts apps/caribou-elena/server/lib/__tests__/render-shadow-attrs-props.test.ts
git commit -m "feat(caribou-elena): renderShadowComponentToString supports { attrs, props } form

Adds an explicit shape that distinguishes attribute-reflected entries
from property-only entries. Needed so SSR can pass complex props like
\`status\` to <caribou-status-card> without emitting [object Object]
on the host attribute.

Backwards-compatible: a flat Record<string, string|null> argument is
still accepted via structural runtime detection, so existing
hydration-parity callers keep working."
```

---

## Task 3: `getServerNowMs()` helper

**Goal of this task:** A tiny module that centralizes the call to `Date.now()` on the server side. Centralization makes test stubbing easy and ensures every SSR path uses the same value within a single request.

**Files:**
- Create: `apps/caribou-elena/server/lib/server-now.ts`
- Create: `apps/caribou-elena/server/lib/__tests__/server-now.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/caribou-elena/server/lib/__tests__/server-now.test.ts
import { describe, it, expect } from 'vitest'
import { getServerNowMs } from '../server-now.js'

describe('getServerNowMs', () => {
  it('returns a number close to Date.now()', () => {
    const before = Date.now()
    const result = getServerNowMs()
    const after = Date.now()
    expect(result).toBeGreaterThanOrEqual(before)
    expect(result).toBeLessThanOrEqual(after)
  })

  it('returns increasing values across calls', () => {
    const a = getServerNowMs()
    // Force a tiny gap.
    const b = (() => { const t0 = Date.now(); while (Date.now() === t0) {} return getServerNowMs() })()
    expect(b).toBeGreaterThan(a)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter caribou-elena test server-now`

Expected: FAIL with `Cannot find module '../server-now.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/caribou-elena/server/lib/server-now.ts

/**
 * Single source of truth for "now" on the server side. Captured once
 * per request via pageData() so SSR'd timestamps inside a single
 * response are mutually consistent and so tests can stub the value
 * by spying on this module.
 */
export function getServerNowMs(): number {
  return Date.now()
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter caribou-elena test server-now`

Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/server/lib/server-now.ts apps/caribou-elena/server/lib/__tests__/server-now.test.ts
git commit -m "feat(caribou-elena): getServerNowMs() centralizes SSR 'now'

Single seam for tests to stub server time. Used by pageData() to
capture 'now' once per request so every SSR'd timestamp in the
response is consistent."
```

---

## Task 4: `<caribou-status-card>` reads `dataset.renderedAt` for first render

**Goal of this task:** Extend the card component so that when SSR has set `data-rendered-at` on the host, the first client-side render uses that value as "now" for `formatRelativeTime`. Subsequent renders use `Date.now()` so timestamps stay live.

**Files:**
- Modify: `apps/caribou-elena/pages/components/caribou-status-card.ts`
- Create: `apps/caribou-elena/pages/components/__tests__/caribou-status-card-now.test.ts`

- [ ] **Step 1: Inspect the current card render**

Run: `grep -n "formatRelativeTime\|connectedCallback\|render()" apps/caribou-elena/pages/components/caribou-status-card.ts | head -15`

Identify: (a) where `formatRelativeTime(...)` is called in `render()`, (b) whether `connectedCallback` exists on the class, (c) the private-field naming convention used (underscore prefix vs camelCase).

- [ ] **Step 2: Write the failing test**

```ts
// apps/caribou-elena/pages/components/__tests__/caribou-status-card-now.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

beforeAll(async () => { await import('../caribou-status-card.js') })

const ACCT = { id: '1', acct: 'a', username: 'a', displayName: 'A', avatar: '', avatarStatic: '' }
const mkStatus = (id: string, createdAt: string) => ({
  id,
  content: `<p>${id}</p>`,
  account: ACCT,
  createdAt,
  inReplyToId: null,
})

describe('<caribou-status-card> — now-resolution', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('uses dataset.renderedAt for the first render after connect', async () => {
    const card = document.createElement('caribou-status-card') as HTMLElement & { status?: unknown }
    card.dataset.renderedAt = '1700000300000' // 2023-11-14T22:18:20.000Z
    document.body.appendChild(card)
    card.status = mkStatus('a', '2023-11-14T22:13:20.000Z') // 5 minutes earlier
    await new Promise((r) => setTimeout(r, 0))
    const text = card.shadowRoot?.textContent ?? ''
    expect(text).toMatch(/5\s*m|5\s*min|5 minutes/i)
  })

  it('switches to Date.now() on subsequent renders', async () => {
    const card = document.createElement('caribou-status-card') as HTMLElement & { status?: unknown }
    card.dataset.renderedAt = '1700000300000'
    document.body.appendChild(card)
    card.status = mkStatus('a', '2023-11-14T22:13:20.000Z')
    await new Promise((r) => setTimeout(r, 0))
    // Re-assign status — triggers a new render. Now we expect Date.now()
    // to dominate (the date is years in the past, so result will be "y" / "years").
    card.status = mkStatus('a', '2023-11-14T22:13:20.000Z')
    await new Promise((r) => setTimeout(r, 0))
    const text = card.shadowRoot?.textContent ?? ''
    // The status hasn't moved but "now" is real Date.now() (2026+), so
    // the relative-time string should reflect a much larger gap.
    expect(text).not.toMatch(/5\s*m|5\s*min|5 minutes/i)
  })
})
```

- [ ] **Step 3: Run test to verify failure**

Run: `pnpm --filter caribou-elena test caribou-status-card-now`

Expected: the first test FAILS — current `formatRelativeTime(status.createdAt)` uses `Date.now()`, so the relative-time text doesn't match "5m".

- [ ] **Step 4: Update the card component**

In `apps/caribou-elena/pages/components/caribou-status-card.ts`:

A. Add private fields near other private state (use the file's existing convention; if other fields use `_underscore`, match it):

```ts
  private _firstRenderDone = false
  private _initialNowMs: number | null = null
```

B. Add (or extend) `connectedCallback`:

```ts
  override connectedCallback() {
    super.connectedCallback?.()
    const renderedAt = this.dataset.renderedAt
    if (renderedAt) {
      const parsed = Number(renderedAt)
      if (Number.isFinite(parsed)) this._initialNowMs = parsed
    }
  }
```

If the file already has a `connectedCallback`, merge these lines into it. Place the `_initialNowMs` capture after the `super` call.

C. In `render()`, replace each `formatRelativeTime(status.createdAt)` call with a version that uses the per-render `nowMs`:

Add at the top of `render()` (before any return):

```ts
    const nowMs = !this._firstRenderDone && this._initialNowMs != null
      ? this._initialNowMs
      : Date.now()
    this._firstRenderDone = true
```

Then change every `formatRelativeTime(status.createdAt)` → `formatRelativeTime(status.createdAt, nowMs)`.

(There may be only one such call; double-check via `grep -n formatRelativeTime apps/caribou-elena/pages/components/caribou-status-card.ts` after editing.)

- [ ] **Step 5: Run test to verify pass**

Run: `pnpm --filter caribou-elena test caribou-status-card-now`

Expected: both tests pass.

- [ ] **Step 6: Run all card tests to confirm no regression**

Run: `pnpm --filter caribou-elena test caribou-status-card`

Expected: all existing card tests still pass.

- [ ] **Step 7: Commit**

```bash
git add apps/caribou-elena/pages/components/caribou-status-card.ts apps/caribou-elena/pages/components/__tests__/caribou-status-card-now.test.ts
git commit -m "feat(caribou-elena): <caribou-status-card> uses dataset.renderedAt for first render

connectedCallback reads dataset.renderedAt and stores it on the
instance. The first render after upgrade threads it through
formatRelativeTime so SSR-emitted cards and client-side cards
produce byte-equal timestamp text on hydration.

Subsequent renders use Date.now() so live cards keep up with
real time (poll, applyNewPosts, loadMore)."
```

---

## Task 5: `renderPopulatedListMount` — empty case

**Goal of this task:** Bootstrap the helper with the simplest scenario: empty items array produces a mount with an empty `<ul>` inside its DSD shadow.

**Files:**
- Create: `apps/caribou-elena/server/lib/render-populated-list.ts`
- Create: `apps/caribou-elena/server/lib/__tests__/render-populated-list.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/caribou-elena/server/lib/__tests__/render-populated-list.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { JSDOM } from 'jsdom'

beforeAll(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  ;(globalThis as unknown as { window: typeof dom.window }).window = dom.window
  ;(globalThis as unknown as { document: Document }).document =
    dom.window.document as unknown as Document
  ;(globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement =
    dom.window.HTMLElement as unknown as typeof HTMLElement
  ;(globalThis as unknown as { customElements: CustomElementRegistry }).customElements =
    dom.window.customElements as unknown as CustomElementRegistry
})

beforeAll(async () => {
  await import('../../../pages/components/caribou-status-card.js')
})

describe('renderPopulatedListMount — empty', () => {
  it('emits a mount with an empty <ul> when items is empty', async () => {
    const { renderPopulatedListMount } = await import('../render-populated-list.js')
    const html = await renderPopulatedListMount({ items: [], serverNowMs: 1700000000000 })
    expect(html).toContain('<caribou-list-mount>')
    expect(html).toContain('<template shadowrootmode="open">')
    expect(html).toContain('<ul')
    expect(html).toContain('</ul>')
    expect(html).not.toContain('<li')
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter caribou-elena test render-populated-list`

Expected: FAIL with `Cannot find module '../render-populated-list.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/caribou-elena/server/lib/render-populated-list.ts

import type { mastodon } from 'masto'
import { renderShadowComponentToString } from './render-shadow.js'

export interface PopulatedListItem {
  status: mastodon.v1.Status
  variant: 'timeline' | 'focused' | 'ancestor' | 'descendant'
  depth?: number | null
}

export interface RenderPopulatedListOptions {
  items: readonly PopulatedListItem[]
  serverNowMs: number
}

/**
 * Compose the declarative-shadow-DOM HTML for a <caribou-list-mount>
 * whose shadow root contains a populated <ul><li>...</li></ul>.
 *
 * Each <li> wraps a <caribou-status-card> rendered via
 * renderShadowComponentToString. The data-rendered-at attribute is
 * set on every card so the client's first render after hydration uses
 * the SSR 'now' (server-now threaded through opts.serverNowMs).
 */
export async function renderPopulatedListMount(
  opts: RenderPopulatedListOptions,
): Promise<string> {
  const { items, serverNowMs } = opts

  const liChunks: string[] = []
  for (const item of items) {
    const cardHtml = await renderShadowComponentToString('caribou-status-card', {
      attrs: {
        variant: item.variant,
        'data-rendered-at': String(serverNowMs),
      },
      props: { status: item.status },
    })
    liChunks.push(buildLi(item, cardHtml))
  }

  return (
    `<caribou-list-mount>` +
    `<template shadowrootmode="open">` +
    `<style>:host { display: block }</style>` +
    `<ul style="list-style:none;margin:0;padding:0;">` +
    liChunks.join('') +
    `</ul>` +
    `</template>` +
    `</caribou-list-mount>`
  )
}

function buildLi(item: PopulatedListItem, cardHtml: string): string {
  const key = item.status.id
  // Empty-case bootstrap: only the data-key is required. Depth / style
  // are added in Task 7.
  return `<li data-key="${escapeAttr(key)}">${cardHtml}</li>`
}

function escapeAttr(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter caribou-elena test render-populated-list`

Expected: PASS — the empty case produces a mount with an empty `<ul>`.

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/server/lib/render-populated-list.ts apps/caribou-elena/server/lib/__tests__/render-populated-list.test.ts
git commit -m "feat(caribou-elena): renderPopulatedListMount — bootstrap with empty case

Composes DSD HTML for <caribou-list-mount> with an empty inner <ul>.
Subsequent commits add N-item, depth, mixed-variant, and byte-equality
test coverage."
```

---

## Task 6: `renderPopulatedListMount` — N timeline items

**Goal of this task:** Cover the most common scenario — N status cards with `variant='timeline'` — and assert structure + ordering + per-card host attributes.

**Files:**
- Modify: `apps/caribou-elena/server/lib/__tests__/render-populated-list.test.ts`

- [ ] **Step 1: Append the failing test**

Add to the existing test file (define a `mkStatus` helper near the top of the file if it doesn't already exist):

```ts
function mkStatus(id: string, content = `<p>${id}</p>`): import('masto').mastodon.v1.Status {
  return {
    id,
    content,
    account: { id: '1', acct: 'u', username: 'u', displayName: 'U', avatar: '', avatarStatic: '' },
    createdAt: '2026-05-11T07:00:00Z',
    inReplyToId: null,
  } as unknown as import('masto').mastodon.v1.Status
}

describe('renderPopulatedListMount — N timeline items', () => {
  it('emits one <li data-key> per item in declared order', async () => {
    const { renderPopulatedListMount } = await import('../render-populated-list.js')
    const items = [
      { status: mkStatus('a'), variant: 'timeline' as const },
      { status: mkStatus('b'), variant: 'timeline' as const },
      { status: mkStatus('c'), variant: 'timeline' as const },
    ]
    const html = await renderPopulatedListMount({ items, serverNowMs: 1700000000000 })
    expect(html).toContain('<li data-key="a">')
    expect(html).toContain('<li data-key="b">')
    expect(html).toContain('<li data-key="c">')
    // Ordering: index of "a" < index of "b" < index of "c"
    expect(html.indexOf('data-key="a"')).toBeLessThan(html.indexOf('data-key="b"'))
    expect(html.indexOf('data-key="b"')).toBeLessThan(html.indexOf('data-key="c"'))
  })

  it('reflects variant + data-rendered-at on every card host', async () => {
    const { renderPopulatedListMount } = await import('../render-populated-list.js')
    const items = [
      { status: mkStatus('a'), variant: 'timeline' as const },
      { status: mkStatus('b'), variant: 'timeline' as const },
    ]
    const html = await renderPopulatedListMount({ items, serverNowMs: 1700000000000 })
    const matches = html.match(/variant="timeline"/g) ?? []
    expect(matches.length).toBe(2)
    const rendered = html.match(/data-rendered-at="1700000000000"/g) ?? []
    expect(rendered.length).toBe(2)
  })

  it('embeds each card via a DSD template', async () => {
    const { renderPopulatedListMount } = await import('../render-populated-list.js')
    const items = [{ status: mkStatus('a'), variant: 'timeline' as const }]
    const html = await renderPopulatedListMount({ items, serverNowMs: 1700000000000 })
    // One mount DSD + one card DSD = two shadowrootmode="open" templates.
    const matches = html.match(/<template shadowrootmode="open">/g) ?? []
    expect(matches.length).toBe(2)
  })
})
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter caribou-elena test render-populated-list`

Expected: all three new tests PASS without implementation changes (Task 5's impl already handles N items correctly).

- [ ] **Step 3: Commit**

```bash
git add apps/caribou-elena/server/lib/__tests__/render-populated-list.test.ts
git commit -m "test(caribou-elena): renderPopulatedListMount covers N timeline items

Pins per-item <li data-key> structure, declared ordering, per-card
variant + data-rendered-at host attributes, and the two-DSD-template
shape (mount + card) for a single-item list."
```

---

## Task 7: `renderPopulatedListMount` — depth + mixed variants

**Goal of this task:** Cover thread-specific shapes — descendants with `data-depth` and `margin-inline-start`, plus mixed variants (ancestor + focused + descendant in the same call).

**Files:**
- Modify: `apps/caribou-elena/server/lib/render-populated-list.ts`
- Modify: `apps/caribou-elena/server/lib/__tests__/render-populated-list.test.ts`

- [ ] **Step 1: Append the failing tests**

```ts
describe('renderPopulatedListMount — depth + mixed variants', () => {
  it('descendant with depth emits data-depth and margin-inline-start on the <li>', async () => {
    const { renderPopulatedListMount } = await import('../render-populated-list.js')
    const items = [
      { status: mkStatus('d1'), variant: 'descendant' as const, depth: 2 },
    ]
    const html = await renderPopulatedListMount({ items, serverNowMs: 1700000000000 })
    expect(html).toContain('data-depth="2"')
    expect(html).toContain('style="margin-inline-start:calc(var(--space-4)*2)"')
  })

  it('ancestor and focused items have no data-depth on the <li>', async () => {
    const { renderPopulatedListMount } = await import('../render-populated-list.js')
    const items = [
      { status: mkStatus('a1'), variant: 'ancestor' as const },
      { status: mkStatus('f1'), variant: 'focused' as const },
    ]
    const html = await renderPopulatedListMount({ items, serverNowMs: 1700000000000 })
    // No data-depth attribute on any <li>.
    expect(html).not.toMatch(/<li[^>]*data-depth=/)
  })

  it('mixed variants emit cards with correct variant attribute per item', async () => {
    const { renderPopulatedListMount } = await import('../render-populated-list.js')
    const items = [
      { status: mkStatus('a1'), variant: 'ancestor' as const },
      { status: mkStatus('f1'), variant: 'focused' as const },
      { status: mkStatus('d1'), variant: 'descendant' as const, depth: 1 },
    ]
    const html = await renderPopulatedListMount({ items, serverNowMs: 1700000000000 })
    expect(html).toContain('variant="ancestor"')
    expect(html).toContain('variant="focused"')
    expect(html).toContain('variant="descendant"')
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter caribou-elena test render-populated-list`

Expected: the first test FAILS — Task 5's `buildLi` doesn't include depth attributes yet.

- [ ] **Step 3: Update `buildLi` in render-populated-list.ts**

```ts
function buildLi(item: PopulatedListItem, cardHtml: string): string {
  const key = escapeAttr(item.status.id)
  const isDescendantWithDepth = item.variant === 'descendant' && item.depth != null
  if (isDescendantWithDepth) {
    const depth = String(item.depth)
    return `<li data-key="${key}" data-depth="${depth}" style="margin-inline-start:calc(var(--space-4)*${depth})">${cardHtml}</li>`
  }
  return `<li data-key="${key}">${cardHtml}</li>`
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter caribou-elena test render-populated-list`

Expected: all tests in the file pass.

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/server/lib/render-populated-list.ts apps/caribou-elena/server/lib/__tests__/render-populated-list.test.ts
git commit -m "feat(caribou-elena): renderPopulatedListMount handles depth + mixed variants

Descendant items with numeric depth emit data-depth and a CSS-var
indent on the <li>. Ancestor and focused variants skip depth entirely.
Mixed-variant calls (thread case: ancestors + focused + descendants)
emit correct variant attribute per card."
```

---

## Task 8: `renderPopulatedListMount` — byte-equality + sanitization

**Goal of this task:** Pin the determinism (same inputs → byte-equal output) that makes hydration parity possible, and pin that status content is sanitized at the card layer (no script tags leak through).

**Files:**
- Modify: `apps/caribou-elena/server/lib/__tests__/render-populated-list.test.ts`

- [ ] **Step 1: Append the tests**

```ts
describe('renderPopulatedListMount — byte-equality + sanitization', () => {
  it('returns byte-equal output for identical inputs', async () => {
    const { renderPopulatedListMount } = await import('../render-populated-list.js')
    const items = [
      { status: mkStatus('a'), variant: 'timeline' as const },
      { status: mkStatus('b'), variant: 'timeline' as const },
    ]
    const a = await renderPopulatedListMount({ items, serverNowMs: 1700000000000 })
    const b = await renderPopulatedListMount({ items, serverNowMs: 1700000000000 })
    expect(a).toBe(b)
  })

  it('strips script tags from status content (sanitization at the card layer)', async () => {
    const { renderPopulatedListMount } = await import('../render-populated-list.js')
    const malicious = mkStatus('x', '<p>safe</p><script>alert(1)</script>')
    const items = [{ status: malicious, variant: 'timeline' as const }]
    const html = await renderPopulatedListMount({ items, serverNowMs: 1700000000000 })
    expect(html).toContain('safe')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('alert(1)')
  })
})
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter caribou-elena test render-populated-list`

Expected: both PASS. The byte-equality holds because all inputs flow deterministically through `renderShadowComponentToString` + the helper's pure string concatenation. The sanitization is enforced by the card's own render (DOMPurify with PURIFY_OPTS) — the helper doesn't sanitize separately; it inherits the card's path.

If sanitization fails, the card's render() may be re-using DOMPurify in a context where its server-side DOM (jsdom) isn't properly set up. In that case, check whether the test's `beforeAll` JSDOM setup is present; the helper test file's setup mirrors `hydration-parity.test.ts` exactly.

- [ ] **Step 3: Commit**

```bash
git add apps/caribou-elena/server/lib/__tests__/render-populated-list.test.ts
git commit -m "test(caribou-elena): renderPopulatedListMount byte-equality + sanitization

Pins (a) deterministic output for identical inputs (the hydration-
parity load-bearing property), (b) script-tag stripping via the
card's existing DOMPurify path (no separate sanitization at the
helper layer)."
```

---

## Task 9: Extend `page-data-types.ts` with `serverNowMs` + `populatedListHtml`

**Goal of this task:** Update the shared TypeScript types so every public-read page-data shape carries the new fields. Implementer of each page integration (Tasks 10–17) consumes these types.

**Files:**
- Modify: `apps/caribou-elena/server/lib/page-data-types.ts`

- [ ] **Step 1: Read the current types**

Run: `cat apps/caribou-elena/server/lib/page-data-types.ts`

Identify `TimelinePageData`, `ProfilePageData`, `ThreadPageData`. They are likely tagged-union types with `kind: 'auth-required' | 'ok' | 'error'` branches.

- [ ] **Step 2: Update the types**

Add `serverNowMs: number` to every variant of every type (auth-required, ok, error — all branches carry it because `serverNowMs` is captured at the very top of `pageData` before branching).

Add `populatedListHtml: string` to **only the `ok` branch** of `TimelinePageData`, `ProfilePageData`, and `ThreadPageData` — it's the SSR-rendered list HTML that exists only when there's data to render.

Concrete shape (adapt to whatever the file currently has):

```ts
export type TimelinePageData =
  | { kind: 'auth-required'; shell: ShellInfo; serverNowMs: number }
  | { kind: 'error'; message: string; shell: ShellInfo; serverNowMs: number }
  | {
      kind: 'ok'
      statuses: mastodon.v1.Status[]
      nextMaxId: string | null
      shell: ShellInfo
      serverNowMs: number
      populatedListHtml: string
    }
```

Apply the same treatment to `ProfilePageData` and `ThreadPageData`. The exact existing field set on `ok` varies per type — preserve all existing fields and add the two new ones.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter caribou-elena typecheck`

Expected: typecheck FAILS in every page file (`local.ts`, `public.ts`, `@[handle].ts`, `@[handle]/[statusId].ts`) because their `pageData` return values now mismatch — they don't yet populate `serverNowMs` or `populatedListHtml`. That's the expected failure; we fix each page in Tasks 10, 12, 14, 16.

If the typecheck fails in OTHER files (e.g., something reads the type and expects the OLD shape), that's a sign the spec's type ripple needs widening — investigate, but most likely the only consumers are the pages themselves.

- [ ] **Step 4: Commit (the type-only change; the pages catch up in subsequent tasks)**

```bash
git add apps/caribou-elena/server/lib/page-data-types.ts
git commit -m "types(caribou-elena): page-data shapes carry serverNowMs + populatedListHtml

serverNowMs is captured once per request and threaded through to every
SSR-rendered card via dataset.renderedAt. populatedListHtml is the
DSD HTML for the populated <caribou-list-mount>, embedded into the
page's render() output via unsafeHTML.

Page integrations follow in subsequent commits — typecheck breaks
intentionally until they land."
```

---

## Task 10: `/local` page adoption

**Goal of this task:** Update `apps/caribou-elena/pages/local.ts` to compute `serverNowMs` + `populatedListHtml` in `pageData()` and embed the HTML in `render()` via `unsafeHTML`.

**Files:**
- Modify: `apps/caribou-elena/pages/local.ts`

- [ ] **Step 1: Read the current file**

Run: `cat apps/caribou-elena/pages/local.ts`

Note the current `pageData` shape and `render()` branches.

- [ ] **Step 2: Update imports**

At the top of the file, add:

```ts
import { unsafeHTML } from '@elenajs/core'
import { getServerNowMs } from '../server/lib/server-now.js'
import { renderPopulatedListMount } from '../server/lib/render-populated-list.js'
```

- [ ] **Step 3: Update `pageData()`**

Replace the body so it computes `serverNowMs` first and `populatedListHtml` on the success branch:

```ts
export const pageData = definePageData<LocalPageData>(async (event) => {
  const origin = getRequestURL(event).origin
  const resolution = await resolveInstanceForRoute(event, {}, { storage: getStorage(), origin })
  const shell: ShellInfo = { instance: resolution.instance }
  const serverNowMs = getServerNowMs()
  if (!resolution.instance) return { kind: 'auth-required', shell, serverNowMs }
  const query = getQuery(event)
  const maxId = typeof query.max_id === 'string' ? query.max_id : undefined
  try {
    const statuses = await fetchPublicTimeline({
      instance: resolution.instance, kind: 'local', maxId,
    })
    const nextMaxId = statuses.length > 0 ? statuses[statuses.length - 1]!.id : null
    const populatedListHtml = await renderPopulatedListMount({
      items: statuses.map((s) => ({ status: s, variant: 'timeline' as const })),
      serverNowMs,
    })
    return { kind: 'ok', statuses, nextMaxId, shell, serverNowMs, populatedListHtml }
  } catch (err) {
    return { kind: 'error', message: String(err), shell, serverNowMs }
  }
})
```

- [ ] **Step 4: Update `render()` ok branch**

Replace:

```ts
    return html`
      <caribou-app-shell instance="${inst}">
        <caribou-timeline kind="local"></caribou-timeline>
      </caribou-app-shell>
    `
```

With:

```ts
    return html`
      <caribou-app-shell instance="${inst}">
        <caribou-timeline kind="local">${unsafeHTML(data.populatedListHtml)}</caribou-timeline>
      </caribou-app-shell>
    `
```

Leave `auth-required` and `error` branches unchanged.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter caribou-elena typecheck`

Expected: `local.ts` no longer triggers type errors. (The other three pages still do; they're addressed in Tasks 12, 14, 16.)

- [ ] **Step 6: Run existing /local tests**

Run: `pnpm --filter caribou-elena test local`

Expected: all existing tests pass. The behavior change is "SSR HTML now includes populated cards"; client-side behavior on hydration is unchanged because `updated()` still sets `tl.initial` and the reconciler reuses existing `data-key`-marked nodes.

- [ ] **Step 7: Commit**

```bash
git add apps/caribou-elena/pages/local.ts
git commit -m "feat(caribou-elena): /local SSR-renders populated <ul><li> via render-populated-list

pageData() captures serverNowMs and pre-renders the populated mount;
render() embeds it via unsafeHTML inside the <caribou-timeline>.
Client-side updated() continues to set tl.initial so the reconciler
finds the SSR-emitted nodes by data-key and reconciles in place
without recreating cards."
```

---

## Task 11: `/local` SSR integration test

**Goal of this task:** Pin that `/local`'s `pageData` returns HTML containing N `<li data-key>` markers and recognizable card content. Regression guard against forgetting to call the helper.

**Files:**
- Create: `apps/caribou-elena/tests/integration/route-ssr/local-pagedata-ssr.test.ts`

- [ ] **Step 1: Write the test**

```ts
// apps/caribou-elena/tests/integration/route-ssr/local-pagedata-ssr.test.ts
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { JSDOM } from 'jsdom'

beforeAll(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  ;(globalThis as unknown as { window: typeof dom.window }).window = dom.window
  ;(globalThis as unknown as { document: Document }).document =
    dom.window.document as unknown as Document
  ;(globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement =
    dom.window.HTMLElement as unknown as typeof HTMLElement
  ;(globalThis as unknown as { customElements: CustomElementRegistry }).customElements =
    dom.window.customElements as unknown as CustomElementRegistry
})

beforeAll(async () => {
  await import('../../../pages/components/caribou-status-card.js')
})

const FIXTURE_STATUSES = [
  { id: 'a', content: '<p>first</p>',  account: { id: '1', acct: 'u', username: 'u', displayName: 'U', avatar: '', avatarStatic: '' }, createdAt: '2026-05-11T07:00:00Z', inReplyToId: null },
  { id: 'b', content: '<p>second</p>', account: { id: '1', acct: 'u', username: 'u', displayName: 'U', avatar: '', avatarStatic: '' }, createdAt: '2026-05-11T07:01:00Z', inReplyToId: null },
  { id: 'c', content: '<p>third</p>',  account: { id: '1', acct: 'u', username: 'u', displayName: 'U', avatar: '', avatarStatic: '' }, createdAt: '2026-05-11T07:02:00Z', inReplyToId: null },
]

describe('/local pageData — SSR list rendering', () => {
  it('returns populatedListHtml containing one <li data-key> per status', async () => {
    // Mock the upstream + cookie path. We intercept at the
    // mastodon-public module level.
    vi.doMock('../../../server/lib/mastodon-public.js', () => ({
      fetchPublicTimeline: async () => FIXTURE_STATUSES,
    }))
    vi.doMock('../../../server/lib/resolve-instance.js', () => ({
      resolveInstanceForRoute: async () => ({ instance: 'fosstodon.org' }),
    }))
    vi.doMock('../../../server/lib/storage.js', () => ({
      getStorage: () => ({} as unknown),
    }))

    const { pageData } = await import('../../../pages/local.js')

    // Fake H3 event sufficient for the page's pageData fetcher.
    const event = {
      context: { params: {} },
      node: { req: { url: '/local' }, res: {} },
    } as unknown as Parameters<typeof pageData>[0]

    const data = await pageData(event)
    expect(data.kind).toBe('ok')
    if (data.kind !== 'ok') throw new Error('expected ok')

    expect(data.populatedListHtml).toContain('<li data-key="a">')
    expect(data.populatedListHtml).toContain('<li data-key="b">')
    expect(data.populatedListHtml).toContain('<li data-key="c">')
    expect(data.populatedListHtml).toContain('<caribou-list-mount>')
    expect(data.populatedListHtml).toMatch(/<template shadowrootmode="open">/)
    expect(typeof data.serverNowMs).toBe('number')
  })
})
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter caribou-elena test local-pagedata-ssr`

Expected: PASS. If the test fails because of import-path resolution or the H3 event shape, adapt by looking at how existing integration tests under `tests/integration/` construct their event objects (they may use a helper from h3 directly).

- [ ] **Step 3: Commit**

```bash
git add apps/caribou-elena/tests/integration/route-ssr/local-pagedata-ssr.test.ts
git commit -m "test(caribou-elena): /local pageData returns populated <li data-key> list

Drives the page's server-side fetch + SSR helper end-to-end with a
mocked upstream and asserts the populatedListHtml string contains
the expected card markers. Regression guard against forgetting to
call renderPopulatedListMount in pageData."
```

---

## Task 12: `/public` page adoption

**Goal of this task:** Mirror Task 10 against `apps/caribou-elena/pages/public.ts`.

**Files:**
- Modify: `apps/caribou-elena/pages/public.ts`

- [ ] **Step 1: Read the current file**

Run: `cat apps/caribou-elena/pages/public.ts`

It should be a near-clone of `local.ts` with `kind: 'public'` in the fetch call.

- [ ] **Step 2: Apply the same changes as Task 10**

Add the same three imports (`unsafeHTML`, `getServerNowMs`, `renderPopulatedListMount`).

Update `pageData()` to compute `serverNowMs` and `populatedListHtml`. The `fetchPublicTimeline` call should pass `kind: 'public'` (preserve whatever value the original used).

Update `render()`'s ok branch to embed `unsafeHTML(data.populatedListHtml)` inside the `<caribou-timeline kind="public">`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter caribou-elena typecheck`

Expected: `public.ts` no longer triggers type errors.

- [ ] **Step 4: Run existing tests**

Run: `pnpm --filter caribou-elena test public`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/pages/public.ts
git commit -m "feat(caribou-elena): /public SSR-renders populated <ul><li> via render-populated-list

Mirrors the /local change in Task 10. pageData() pre-renders the
populated mount; render() embeds it via unsafeHTML."
```

---

## Task 13: `/public` SSR integration test

**Goal of this task:** Mirror Task 11 for `/public`.

**Files:**
- Create: `apps/caribou-elena/tests/integration/route-ssr/public-pagedata-ssr.test.ts`

- [ ] **Step 1: Write the test**

Copy `local-pagedata-ssr.test.ts` from Task 11 to `public-pagedata-ssr.test.ts`. Change:

- `import { pageData } from '../../../pages/local.js'` → `from '../../../pages/public.js'`
- The describe block name: `'/local pageData'` → `'/public pageData'`
- The mocked `fetchPublicTimeline` should still return `FIXTURE_STATUSES` — the helper doesn't care about `kind`.
- The mocked URL: `'/local'` → `'/public'`

- [ ] **Step 2: Run the test**

Run: `pnpm --filter caribou-elena test public-pagedata-ssr`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/caribou-elena/tests/integration/route-ssr/public-pagedata-ssr.test.ts
git commit -m "test(caribou-elena): /public pageData returns populated <li data-key> list"
```

---

## Task 14: `/@user@host` (profile) page adoption

**Goal of this task:** Adopt `renderPopulatedListMount` in the profile page. Profile already SSRs the header + tabs; we add SSR'd cards for the active tab's statuses.

**Files:**
- Modify: `apps/caribou-elena/pages/@[handle].ts`

- [ ] **Step 1: Read the current file**

Run: `cat 'apps/caribou-elena/pages/@[handle].ts'`

Note where statuses are fetched (likely a function that takes `tab: 'posts' | 'replies' | 'media'`) and where `render()` mounts `<caribou-profile>` with status data.

- [ ] **Step 2: Apply the changes**

Add the three imports (`unsafeHTML`, `getServerNowMs`, `renderPopulatedListMount`).

In `pageData()`:
1. Capture `serverNowMs = getServerNowMs()` at the top, before branching.
2. On the success path, after the statuses fetch:
   ```ts
   const populatedListHtml = await renderPopulatedListMount({
     items: statuses.map((s) => ({ status: s, variant: 'timeline' as const })),
     serverNowMs,
   })
   ```
3. Include `serverNowMs` on every branch and `populatedListHtml` on the success branch.

In `render()` ok branch: the profile page embeds a status list somewhere inside `<caribou-profile>`. Locate where the empty `<caribou-timeline>` (or equivalent) is emitted and inject `${unsafeHTML(data.populatedListHtml)}` inside it.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter caribou-elena typecheck`

Expected: profile-page type errors resolved.

- [ ] **Step 4: Run existing tests**

Run: `pnpm --filter caribou-elena test profile`

Expected: all pass. If the profile component's tests query for specific DOM structures, they may need to be adjusted — but typically those tests focus on header/tabs, which are unchanged.

- [ ] **Step 5: Commit**

```bash
git add 'apps/caribou-elena/pages/@[handle].ts'
git commit -m "feat(caribou-elena): profile page SSR-renders populated status list

pageData() pre-renders the populated mount for the active tab's
statuses; render() embeds it via unsafeHTML inside <caribou-profile>.
Header + tabs SSR is unchanged."
```

---

## Task 15: Profile SSR integration test

**Goal of this task:** Mirror Tasks 11/13 for the profile page.

**Files:**
- Create: `apps/caribou-elena/tests/integration/route-ssr/profile-pagedata-ssr.test.ts`

- [ ] **Step 1: Write the test**

Copy the Task 11 template and adapt:

- Import path: `'../../../pages/@[handle].js'`. The actual file is at `pages/@[handle].ts`; the import path in tests needs to escape the bracket if needed (use `'../../../pages/@[handle].js'`).
- Mock the profile-specific upstream call (`lookupAccount` + `fetchAccountStatuses`, depending on the actual API; check Plan 3's mastodon-public.ts exports).
- Fake H3 event: include `event.context.params.handle = 'user@example.test'`.
- Assertions: `data.populatedListHtml` contains the same `<li data-key>` markers.

- [ ] **Step 2: Run the test**

Run: `pnpm --filter caribou-elena test profile-pagedata-ssr`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/caribou-elena/tests/integration/route-ssr/profile-pagedata-ssr.test.ts
git commit -m "test(caribou-elena): profile pageData returns populated <li data-key> list"
```

---

## Task 16: `/@user@host/[statusId]` (thread) page adoption

**Goal of this task:** Adopt the helper for thread, which is the most structurally varied — ancestors + focused + descendants with depth.

**Files:**
- Modify: `apps/caribou-elena/pages/@[handle]/[statusId].ts`

- [ ] **Step 1: Read the current file**

Run: `cat 'apps/caribou-elena/pages/@[handle]/[statusId].ts'`

Locate the fetch of focused + context (ancestors + descendants), the depth-map helper, and where `<caribou-thread>` is mounted in `render()`.

- [ ] **Step 2: Build the items array**

In `pageData()`, after the fetch (and after `serverNowMs = getServerNowMs()` at the top):

```ts
import { depthMap, MAX_DEPTH } from '@beatzball/caribou-state' // or wherever it lives
import type { PopulatedListItem } from '../server/lib/render-populated-list.js'

// ...inside pageData on the success path...
const depths = depthMap(focused.id, descendants)
const items: PopulatedListItem[] = [
  ...ancestors.map((s) => ({ status: s, variant: 'ancestor' as const })),
  { status: focused, variant: 'focused' as const },
  ...descendants.map((s) => ({
    status: s,
    variant: 'descendant' as const,
    depth: depths.get(s.id) ?? MAX_DEPTH,
  })),
]
const populatedListHtml = await renderPopulatedListMount({ items, serverNowMs })
```

(Adapt the `depthMap` / `MAX_DEPTH` import path to wherever they actually live — likely `@beatzball/caribou-state` or a thread-local module. Confirm by `grep -rn 'depthMap\|MAX_DEPTH' apps/caribou-elena packages/state | head`.)

In `render()` ok branch, embed `${unsafeHTML(data.populatedListHtml)}` inside `<caribou-thread>`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter caribou-elena typecheck`

Expected: thread page no longer errors.

- [ ] **Step 4: Run existing thread tests**

Run: `pnpm --filter caribou-elena test thread`

Expected: pass. The thread component's tests query specific DOM structures (variants, depth caps) — those should still hold because the helper emits the same structure.

- [ ] **Step 5: Commit**

```bash
git add 'apps/caribou-elena/pages/@[handle]/[statusId].ts'
git commit -m "feat(caribou-elena): thread page SSR-renders ancestors+focused+descendants

pageData() builds a flat {status, variant, depth?} items array from
the fetch and pre-renders the populated mount. render() embeds it
via unsafeHTML inside <caribou-thread>. Descendant depth is preserved
on the <li> via data-depth + margin-inline-start, matching the
client-side reconciler's per-li styling."
```

---

## Task 17: Thread SSR integration test

**Goal of this task:** Mirror Tasks 11/13/15 for thread, with the additional variant + depth assertions.

**Files:**
- Create: `apps/caribou-elena/tests/integration/route-ssr/thread-pagedata-ssr.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { JSDOM } from 'jsdom'

beforeAll(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  ;(globalThis as unknown as { window: typeof dom.window }).window = dom.window
  ;(globalThis as unknown as { document: Document }).document =
    dom.window.document as unknown as Document
  ;(globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement =
    dom.window.HTMLElement as unknown as typeof HTMLElement
  ;(globalThis as unknown as { customElements: CustomElementRegistry }).customElements =
    dom.window.customElements as unknown as CustomElementRegistry
})

beforeAll(async () => {
  await import('../../../pages/components/caribou-status-card.js')
})

const ACCT = { id: '1', acct: 'u', username: 'u', displayName: 'U', avatar: '', avatarStatic: '' }
const F  = { id: 'f',  content: '<p>focused</p>',     account: ACCT, createdAt: '2026-05-11T07:00:00Z', inReplyToId: null }
const A1 = { id: 'a1', content: '<p>ancestor</p>',    account: ACCT, createdAt: '2026-05-11T06:59:00Z', inReplyToId: null }
const D1 = { id: 'd1', content: '<p>desc1</p>',       account: ACCT, createdAt: '2026-05-11T07:01:00Z', inReplyToId: 'f' }
const D2 = { id: 'd2', content: '<p>desc2 deep</p>',  account: ACCT, createdAt: '2026-05-11T07:02:00Z', inReplyToId: 'd1' }

describe('thread pageData — SSR list rendering', () => {
  it('returns populatedListHtml with variants + depth attributes', async () => {
    vi.doMock('../../../server/lib/mastodon-public.js', () => ({
      fetchStatus: async () => F,
      fetchThread: async () => ({ ancestors: [A1], descendants: [D1, D2] }),
    }))
    vi.doMock('../../../server/lib/resolve-instance.js', () => ({
      resolveInstanceForRoute: async () => ({ instance: 'fosstodon.org' }),
    }))
    vi.doMock('../../../server/lib/storage.js', () => ({
      getStorage: () => ({} as unknown),
    }))

    const { pageData } = await import('../../../pages/@[handle]/[statusId].js')

    const event = {
      context: { params: { handle: 'u@example.test', statusId: 'f' } },
      node: { req: { url: '/@u@example.test/f' }, res: {} },
    } as unknown as Parameters<typeof pageData>[0]

    const data = await pageData(event)
    expect(data.kind).toBe('ok')
    if (data.kind !== 'ok') throw new Error('expected ok')

    // Cards present in order: ancestor → focused → descendants.
    expect(data.populatedListHtml.indexOf('data-key="a1"')).toBeLessThan(data.populatedListHtml.indexOf('data-key="f"'))
    expect(data.populatedListHtml.indexOf('data-key="f"')).toBeLessThan(data.populatedListHtml.indexOf('data-key="d1"'))

    // Variants are reflected on the cards.
    expect(data.populatedListHtml).toContain('variant="ancestor"')
    expect(data.populatedListHtml).toContain('variant="focused"')
    expect(data.populatedListHtml).toContain('variant="descendant"')

    // Descendants carry data-depth on their <li>.
    expect(data.populatedListHtml).toMatch(/<li data-key="d1"[^>]*data-depth=/)
    expect(data.populatedListHtml).toMatch(/<li data-key="d2"[^>]*data-depth=/)
  })
})
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter caribou-elena test thread-pagedata-ssr`

Expected: PASS. If the depth-map or fetch-thread API names differ from the mocks, adjust the `vi.doMock` paths to match what the thread page actually imports.

- [ ] **Step 3: Commit**

```bash
git add apps/caribou-elena/tests/integration/route-ssr/thread-pagedata-ssr.test.ts
git commit -m "test(caribou-elena): thread pageData returns variants + depths"
```

---

## Task 18: Extend hydration-parity tests

**Goal of this task:** Add cases to the existing `tests/integration/hydration-parity.test.ts` that exercise (a) cards with status data via the new `{ attrs, props }` form, and (b) the populated-list helper's byte-equality.

**Files:**
- Modify: `apps/caribou-elena/tests/integration/hydration-parity.test.ts`

- [ ] **Step 1: Read the current file**

Run: `cat apps/caribou-elena/tests/integration/hydration-parity.test.ts`

The existing `CASES` array uses the legacy form. Migrate to the explicit `{ attrs }` form for those cases (since we kept it backwards-compatible, this can be left as-is too — but migrating gives clearer intent). Decision: leave existing cases alone (the legacy form still works); add new cases that explicitly use `{ attrs, props }`.

- [ ] **Step 2: Append a new test block**

```ts
describe('§12.6 hydration parity — populated card + helper', () => {
  beforeAll(async () => {
    await import('../../pages/components/caribou-status-card.js')
  })

  const FIXTURE_STATUS = {
    id: 'fx',
    content: '<p>fixture</p>',
    account: { id: '1', acct: 'u', username: 'u', displayName: 'U', avatar: '', avatarStatic: '' },
    createdAt: '2026-05-11T07:00:00Z',
    inReplyToId: null,
  } as unknown as import('masto').mastodon.v1.Status

  it('caribou-status-card with status (via { attrs, props } form) is byte-equal', async () => {
    const { renderShadowComponentToString } =
      await import('../../server/lib/render-shadow.js')
    const a = await renderShadowComponentToString('caribou-status-card', {
      attrs: { variant: 'timeline', 'data-rendered-at': '1700000000000' },
      props: { status: FIXTURE_STATUS },
    })
    const b = await renderShadowComponentToString('caribou-status-card', {
      attrs: { variant: 'timeline', 'data-rendered-at': '1700000000000' },
      props: { status: FIXTURE_STATUS },
    })
    expect(a).toBe(b)
    expect(a).toContain('variant="timeline"')
    expect(a).toContain('data-rendered-at="1700000000000"')
    expect(a).not.toContain('status="')
  })

  it('renderPopulatedListMount is byte-equal across invocations', async () => {
    const { renderPopulatedListMount } =
      await import('../../server/lib/render-populated-list.js')
    const items = [
      { status: FIXTURE_STATUS, variant: 'timeline' as const },
      { status: { ...FIXTURE_STATUS, id: 'fy', content: '<p>two</p>' } as typeof FIXTURE_STATUS, variant: 'timeline' as const },
    ]
    const a = await renderPopulatedListMount({ items, serverNowMs: 1700000000000 })
    const b = await renderPopulatedListMount({ items, serverNowMs: 1700000000000 })
    expect(a).toBe(b)
  })
})
```

- [ ] **Step 3: Run the test**

Run: `pnpm --filter caribou-elena test hydration-parity`

Expected: all existing cases + 2 new cases pass.

- [ ] **Step 4: Commit**

```bash
git add apps/caribou-elena/tests/integration/hydration-parity.test.ts
git commit -m "test(caribou-elena): hydration parity covers populated cards + list helper

Adds two cases: a card with status data via the new { attrs, props }
form, and renderPopulatedListMount byte-equality across invocations.
Both anchor the Plan 3 §12.6 strict-parity property for the new
SSR-list pipeline."
```

---

## Task 19: Re-run the existing no-JS Playwright test

**Goal of this task:** Verify Plan 3's no-JS smoke for `/local` still passes after the SSR list changes. DSD is materialized by the parser without JS, so cards should now appear (in fact, more clearly than before).

**Files:**
- None to modify; this task verifies behavior.

- [ ] **Step 1: Run the e2e suite**

Run: `pnpm --filter caribou-elena test:e2e`

Expected: all e2e tests pass, including the no-JS smoke that exercises `/local` with `javaScriptEnabled: false`. Before this PR, the test passed by relying on DSD-rendered shell elements being visible; after, the test should additionally see the cards' rendered content (because DSD now materializes populated cards too).

If the test fails because it asserts the OLD behavior (e.g., expects an EMPTY timeline area), update the assertion to expect populated cards. The test should not have such an assertion based on current intent, but verify by reading `tests/e2e/local.spec.ts` (or wherever the no-JS test lives) first.

- [ ] **Step 2: Commit (only if a test file needed updating)**

If a test assertion required updating to match the new SSR shape:

```bash
git add apps/caribou-elena/tests/e2e/<file>.spec.ts
git commit -m "test(caribou-elena): update no-JS smoke to expect SSR-rendered cards"
```

If no changes were needed, skip this commit.

---

## Task 20: Changesets

**Goal of this task:** Add one `.changeset/*.md` per modified package.

**Files:**
- Create: `.changeset/route-ssr-list.md`
- Create: `.changeset/ui-headless-format-now.md`

- [ ] **Step 1: Inspect changeset config**

Run: `cat .changeset/config.json`

Confirm the versioning policy (independent vs lockstep) and which packages are in scope.

- [ ] **Step 2: Write the caribou-elena changeset**

```markdown
---
"caribou-elena": patch
---

SSR public-read route status lists. `/local`, `/public`, `/@user@host`, and `/@user@host/[statusId]` now pre-render their populated `<caribou-list-mount>` server-side via a new `renderPopulatedListMount` helper. Hosts paint with cards on first paint instead of an empty timeline that pops in after JS hydration — closes the cross-route flicker observed on `/home → /local`.

Plumbs `serverNowMs` through `pageData → data-rendered-at attribute → <caribou-status-card>.render()` so the first client-side render reproduces the SSR timestamp byte-for-byte. The keyed reconciler's first call after hydration finds existing `data-key` markers and reconciles in place with zero structural DOM ops.

`/home` remains lazy by design — Plan 3 §11's privacy property prevents the server from receiving the user's access token.
```

- [ ] **Step 3: Write the caribou-ui-headless changeset**

```markdown
---
"@beatzball/caribou-ui-headless": patch
---

`formatRelativeTime(date, nowMs?)` accepts an optional `nowMs` parameter for test stubbing and SSR/client hydration parity. Default behavior unchanged for callers passing a single argument.
```

- [ ] **Step 4: Verify**

Run: `pnpm changeset status`

Expected: two changesets listed.

- [ ] **Step 5: Commit**

```bash
git add .changeset/route-ssr-list.md .changeset/ui-headless-format-now.md
git commit -m "chore: changesets for public-read SSR list rendering"
```

---

## Task 21: Final verification + PR body draft

**Goal of this task:** Confirm everything is green and produce a ready-to-paste PR description.

**Files:**
- Create: `docs/pr-notes/2026-05-11-route-nav-flicker-pr-body.md`

- [ ] **Step 1: Run the full pipeline**

From the worktree root (`.claude/worktrees/route-nav-flicker`):

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: all five pass.

- [ ] **Step 2: Coverage spot-check on the new helper**

Run: `pnpm --filter caribou-elena test:coverage 2>&1 | grep -E "render-populated-list|server-now|render-shadow"`

Expected: the new files (`render-populated-list.ts`, `server-now.ts`) and the extended `render-shadow.ts` show coverage. caribou-elena's vitest config has no enforced threshold, so this is observational; aim for ≥95% on the new files.

- [ ] **Step 3: Commit log review**

```bash
git log --oneline main..HEAD
git diff --stat main..HEAD
```

Expected: commits from Tasks 1–20 in order; total diff ~1100–1350 LOC, dominated by tests.

- [ ] **Step 4: Compose PR body draft**

Write to `docs/pr-notes/2026-05-11-route-nav-flicker-pr-body.md`:

```markdown
## Summary

Closes the cross-route navigation flicker (`/home → /local`) observed after the keyed-list reconciliation PR shipped. The four public-read routes — `/local`, `/public`, `/@user@host`, `/@user@host/[statusId]` — now SSR their populated `<ul><li>` status lists so the browser paints with content on first paint, instead of an empty timeline that pops in after JS hydration.

**Architecture:** a new `renderPopulatedListMount(items, opts)` helper in `apps/caribou-elena/server/lib/render-populated-list.ts` composes the mount's declarative-shadow-DOM HTML, calling the existing `renderShadowComponentToString` once per card. Each page's `pageData()` captures `serverNowMs` and pre-renders the helper output; `render()` embeds it via `unsafeHTML(...)`. Server-now is threaded through `data-rendered-at` so cards' first client render is byte-equal to SSR — the keyed reconciler then finds the cards by `data-key` on hydration and reconciles in place with zero structural ops.

**`/home` is explicitly out of scope** — auth-required + Plan 3 §11 privacy property = SSR can't fetch the user's token-gated timeline. The home-timeline pop-in remains by design.

Spec: `docs/superpowers/specs/2026-05-11-caribou-route-nav-flicker-design.md`
Plan: `docs/superpowers/plans/2026-05-11-caribou-route-nav-flicker.md`

## Test plan

- [x] `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build` green.
- [x] New helper unit tests in `server/lib/__tests__/render-populated-list.test.ts` cover empty, N items, depth, mixed variants, byte-equality, and sanitization.
- [x] Extended hydration-parity tests cover cards with status data via the new `{ attrs, props }` form and helper byte-equality.
- [x] Per-route integration tests assert each route's `pageData()` returns HTML containing `<li data-key>` markers per status.
- [x] `<caribou-status-card>` now-resolution unit test pins first-render-uses-dataset, subsequent-render-uses-Date.now.
- [x] Existing no-JS Playwright test for `/local` still passes (DSD materialization is parser-level).
- [ ] **Manual smoke (user — required before merge):** `pnpm --filter caribou-elena dev:portless`, sign in to a real Mastodon instance, navigate `/home → /local` and `/local → /public` and `/local → /@user@host` and back. Confirm the destination pages paint with populated cards on first frame; only `/home` should still show the timeline pop-in (by design).

## Out of scope (called out so reviewers know)

- No `/home` flicker fix — privacy-property constraint.
- No Elk-style default-instance redirect for signed-out users — captured for follow-up brainstorm.
- No SPA routing — Plan 3 §10 design call stands.
- No periodic timestamp text updates on idle cards (the "5m ago" text remains static until the card's status is reassigned).
- No non-DSD-browser fallback — Plan 3 already accepted DSD-or-empty.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 5: Commit the PR body**

```bash
git add docs/pr-notes/2026-05-11-route-nav-flicker-pr-body.md
git commit -m "docs: PR body draft for public-read route SSR list rendering"
```

- [ ] **Step 6: Stop**

Do NOT push or `gh pr create`. Those are user actions per the previous PR's pattern.

---

## Self-Review (skill checklist — completed pre-handoff)

**Spec coverage:**
- §0 Goal → All tasks (PR body in Task 21).
- §1 Scope → Tasks 1 (formatRelativeTime), 2 (render-shadow), 3 (server-now), 4 (card), 5–8 (helper), 9 (types), 10–17 (per-route + tests), 18 (hydration parity).
- §2 Architecture & module boundary → Tasks 3, 5, 9, 10/12/14/16.
- §3 Server helper API + algorithm → Tasks 5, 6, 7, 8.
- §3.4 `renderShadowComponentToString` extension → Task 2.
- §4 Per-page integration → Tasks 10, 12, 14, 16.
- §4.5 serverData marshalling duplication → not a task; spec section accepts the duplication, no code needed.
- §5 Card component changes → Tasks 1, 4.
- §6 Hydration parity & testing → Tasks 5–8 (helper tests), 11/13/15/17 (route integration), 18 (hydration parity), 4 (card test).
- §6.5 No-JS Playwright re-verification → Task 19.
- §7 Out of scope → captured in PR body (Task 21).
- §8 Considered and rejected → spec captures.
- §9 Open questions → spec captures.
- §10 Diff size estimate → noted in Task 21 step 3.

**Placeholder scan:** no TBDs, no "implement later" hand-waving. Each task has concrete code blocks. Task 14 / 15 / 16 / 17 reference variant route file paths that have brackets (`@[handle].ts`) which require shell-quoting; called out inline.

**Type consistency:**
- `PopulatedListItem` defined in Task 5; used in Tasks 6, 7, 16.
- `RenderPopulatedListOptions` defined in Task 5; used in all helper tests.
- `getServerNowMs()` defined in Task 3; called in Tasks 10, 12, 14, 16.
- `renderPopulatedListMount` signature consistent across Tasks 5, 6, 7, 8, 10, 12, 14, 16, 18.
- `unsafeHTML` imported uniformly across Tasks 10, 12, 14, 16.
