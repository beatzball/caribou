# Caribou — Public-Read Route SSR List Rendering Design Spec

**Status:** approved (brainstorm complete, awaiting implementation plan)
**Origin:** Plan 3 §11.1a keyed-list reconciliation follow-up. Closes the SSR list-rendering forward-compat hook captured in `2026-05-09-caribou-keyed-list-reconciliation-design.md` §6.
**Companion plan:** to be written by `superpowers:writing-plans` after this spec is approved.

## 0. Goal

Eliminate the cross-route navigation flicker observed on 2026-05-11 (`/home → /local`) by SSR-rendering the list contents of all four public-read routes (`/local`, `/public`, `/@user@host`, `/@user@host/[statusId]`). After this PR, navigating between these routes paints with populated status cards in the initial HTML rather than an empty timeline that pops in after JS hydration.

`/home` is explicitly out of scope: it is auth-required and Plan 3 §11's privacy property forbids the server from receiving the user's access token. The home-timeline pop-in remains by design.

## 1. Scope

In scope:

- New server-side helper `apps/caribou-elena/server/lib/render-populated-list.ts` that emits the declarative-shadow-DOM (DSD) HTML for a populated `<caribou-list-mount>`.
- New trivial helper `apps/caribou-elena/server/lib/server-now.ts` (centralized `Date.now()` for SSR + test stubbing).
- `serverNowMs: number` field on `TimelinePageData`, `ProfilePageData`, and `ThreadPageData` (page-data-types.ts).
- Adoption in all four public-read routes: `/local`, `/public`, `/@user@host`, `/@user@host/[statusId]`.
- Minor changes to `<caribou-status-card>` so the first render after upgrade uses the SSR-emitted `data-rendered-at` for "now" instead of `Date.now()`.
- A non-breaking extension of `renderShadowComponentToString(tag, props)` to support distinguishing attribute-reflected fields from property-only fields: `renderShadowComponentToString(tag, { attrs, props })`.
- Hydration-parity test coverage for the populated-list case and per-route SSR integration tests.

Out of scope (see §7):

- `/home` flicker (privacy-property constraint).
- Elk-style default-instance redirect (orthogonal UX feature).
- Per-card render caching server-side.
- SPA routing.
- Periodic timestamp updates on idle cards.

## 2. Architecture & module boundary

The page's `pageData(event)` runs server-side, fetches upstream, computes `serverNowMs`, and pre-renders the populated-list HTML via the new helper. The pre-rendered HTML is stashed on the returned data shape (e.g., `populatedListHtml: string`). The page's `render()` reads `this.serverData` synchronously and embeds the string via `unsafeHTML(data.populatedListHtml)` inside the `<caribou-timeline>` (or `<caribou-profile>`, `<caribou-thread>`) element.

The helper composes the mount's DSD HTML by:

1. Calling `renderShadowComponentToString('caribou-status-card', {...})` for each item to get the card's DSD HTML.
2. Wrapping each card in `<li data-key="${status.id}">...</li>`, with depth-dependent attributes on the `<li>` for descendants.
3. Composing the surrounding `<caribou-list-mount><template shadowrootmode="open">...</template></caribou-list-mount>` shape with the inline `<ul>` styles baked in.

Why this shape works:

- The mount's `connectedCallback` already handles "shadow root pre-attached via DSD" — it queries the existing `<ul>` instead of creating a new one. (Verified in the keyed-list reconciliation PR's Task 2 unit tests.)
- The keyed reconciler's first call (after `LocalPage.updated()` sets `tl.initial`) reads existing `data-key` attributes on the `<li>` children of `mount.mountUl`, finds them, and reconciles in place with zero structural ops. The `update` callback fires once per card, setting `card.status = s` — this triggers each card's `render()`, but since the rendered template is byte-equal to the SSR-emitted DSD content (by construction; see §5), Elena's morph is a no-op visually.
- The page is the natural owner of SSR composition: it already has the data via `pageData()`, has a single async fetch lifecycle, and avoids coupling SSR-specific logic into the timeline/profile/thread custom elements.

## 3. Server helper API & algorithm

### 3.1 API

```ts
// apps/caribou-elena/server/lib/render-populated-list.ts

import type { mastodon } from 'masto'

export interface PopulatedListItem {
  status: mastodon.v1.Status
  variant: 'timeline' | 'focused' | 'ancestor' | 'descendant'
  depth?: number | null // only meaningful for thread descendants
}

export interface RenderPopulatedListOptions {
  items: readonly PopulatedListItem[]
  serverNowMs: number
}

export async function renderPopulatedListMount(
  opts: RenderPopulatedListOptions,
): Promise<string>
```

### 3.2 Algorithm

1. For each item, build `<li>`'s attributes:
   - Always: `data-key="${status.id}"`.
   - If `variant === 'descendant'` and `depth != null`: `data-depth="${depth}"` plus `style="margin-inline-start:calc(var(--space-4)*${depth})"`.
2. For each item, render the inner card via:
   ```ts
   await renderShadowComponentToString('caribou-status-card', {
     attrs: { variant, 'data-rendered-at': String(serverNowMs) },
     props: { status },
   })
   ```
3. Compose:
   ```
   <caribou-list-mount>
     <template shadowrootmode="open">
       <style>:host { display: block }</style>
       <ul style="list-style:none;margin:0;padding:0;">
         {li chunks joined}
       </ul>
     </template>
   </caribou-list-mount>
   ```
4. Return the composed string.

### 3.3 Behavior contracts

- **Empty `items` array:** returns the mount with an empty `<ul>`. The page is responsible for choosing the empty-state branch (e.g., "No posts yet") before calling the helper; the helper does not render empty-state UI.
- **Determinism:** given the same `items` and `serverNowMs`, the function returns byte-equal output. This is the hydration-parity guarantee (§5).
- **Sanitization:** the helper does not sanitize `status.content`. That responsibility stays inside `<caribou-status-card>`'s render path, which uses DOMPurify with `PURIFY_OPTS` from `@beatzball/caribou-mastodon-client/sanitize-opts`. Both SSR and client paths share the same allowlist by construction (Plan 3 §6).

### 3.4 `renderShadowComponentToString` extension

The existing signature is `renderShadowComponentToString(tagName, props: Record<string, string | null>)` where every entry is both assigned to the instance and reflected as an attribute. The card's `status` is a complex object that should be assigned as a property but **not** reflected as an attribute (would emit `status="[object Object]"`).

Non-breaking change:

```ts
// Old (still accepted; treated as attrs only)
renderShadowComponentToString(tag, { variant: 'timeline' })

// New (explicit split)
renderShadowComponentToString(tag, {
  attrs: { variant: 'timeline' },     // assigned to instance AND reflected as host attrs
  props: { status: someStatus },      // assigned to instance only
})
```

The function detects the shape: if the second argument has neither `attrs` nor `props` as keys, treat the whole object as `attrs` (legacy form). Existing hydration-parity test cases keep working unchanged; new tests use the explicit shape.

## 4. Per-page integration

### 4.1 Shared pattern

All four routes follow the same structure:

```ts
// pageData (server-only)
const serverNowMs = getServerNowMs()
// ...fetch upstream...
const populatedListHtml = await renderPopulatedListMount({
  items: <mapped from upstream data>,
  serverNowMs,
})
return { kind: 'ok', /* ...existing fields..., */ serverNowMs, populatedListHtml }

// render()
return html`
  <caribou-app-shell instance="${inst}">
    <caribou-timeline kind="local">${unsafeHTML(data.populatedListHtml)}</caribou-timeline>
  </caribou-app-shell>
`

// updated() — unchanged from current behavior
// Sets tl.initial = { statuses, nextMaxId } so the client store is primed for poll/loadMore.
```

### 4.2 `/local` & `/public`

Identical shape. Each `items` entry: `{ status, variant: 'timeline' }`. No depth, no special variants.

### 4.3 `/@user@host` (profile)

Profile already SSRs the header + tabs via `caribou-profile-header` / `caribou-profile-tabs`. Adopt the helper for the status list inside `<caribou-profile>`. Each `items` entry: `{ status, variant: 'timeline' }`. The `tab` query param routes to the right fetch (`posts` / `replies` / `media`) but the rendering shape per status is identical.

### 4.4 `/@user@host/[statusId]` (thread)

The most structurally varied. The `items` array is built from `collectThreadItems()`'s output (already returns `{ status, depth }` post-keyed-list PR):

```ts
const focusedId = focused.id
const items: PopulatedListItem[] = [
  ...ancestors.map((s) => ({ status: s, variant: 'ancestor' as const })),
  { status: focused, variant: 'focused' as const },
  ...descendants.map((s) => ({
    status: s,
    variant: 'descendant' as const,
    depth: depthMap(focusedId, descendants).get(s.id) ?? MAX_DEPTH,
  })),
]
```

The helper handles variant + depth uniformly. The thread's `<ul>` lives inside the thread's own shadow root (thread is shadow-DOM; mount nests inside it — same as the keyed-list PR's Task 18 setup).

### 4.5 `serverData` JSON marshalling

`populatedListHtml` is a string field on `serverData`. Litro marshals `serverData` to JSON for client hydration, so the HTML appears twice on the wire (rendered into the SSR body **and** inside the marshalled JSON). For a 50-card timeline this is ~20–40 KB of duplication uncompressed. **Accepted** because gzip compresses the duplication efficiently; the simplicity of treating `serverData` as authoritative is worth the wire-bytes cost. Revisit if real-traffic measurements show the overhead matters.

## 5. Card component changes

### 5.1 `now`-resolution on first render

```ts
private _firstRenderDone = false
private _initialNowMs: number | null = null

override connectedCallback() {
  super.connectedCallback?.()
  const renderedAt = this.dataset.renderedAt
  if (renderedAt) this._initialNowMs = Number(renderedAt)
}

override render() {
  const nowMs = !this._firstRenderDone && this._initialNowMs != null
    ? this._initialNowMs
    : Date.now()
  this._firstRenderDone = true
  // ...existing render, threading nowMs into formatRelativeTime calls
}
```

Net behavior:

- Cards rendered by SSR have `data-rendered-at="${serverNowMs}"` set as a host attribute.
- On client first render (after DSD materializes the card's shadow and Elena upgrades the host), the card's `render()` reads `_initialNowMs` and produces timestamps relative to `serverNowMs` — byte-equal to SSR.
- Subsequent renders (poll, status reassignment) use `Date.now()` so timestamps stay live.
- Cards created client-side post-hydration (`loadMore` results, etc.) have no `data-rendered-at`, fall through to `Date.now()` immediately, no special-case needed.

### 5.2 `formatRelativeTime` signature extension

Currently `formatRelativeTime(date: Date | string): string` in `@beatzball/caribou-ui-headless`. Extend to `formatRelativeTime(date, nowMs?: number): string`; default `nowMs = Date.now()`. Non-breaking; existing call sites unaffected.

### 5.3 Pre-connect `status` property write

`renderShadowComponentToString` sets `instance.status = status` before calling `instance.render()`, while the element is not yet connected to any document. The card's render path must tolerate this. Elena's `_captureClassFieldDefaults` mechanism captures pre-connect property writes and reapplies them through the prop setter on connect — already proven working in the keyed-list PR (Task 11). A focused regression test (§6.4) pins the behavior.

## 6. Hydration parity & testing

### 6.1 Helper unit tests (`server/lib/__tests__/render-populated-list.test.ts`)

Required scenarios:

1. Empty `items` array → mount with empty `<ul>`.
2. N timeline items → N `<li data-key>` chunks in declared order, each wrapping a DSD-emitted card.
3. Descendants with depth → `<li data-depth="2" style="margin-inline-start:calc(var(--space-4)*2)">`.
4. Mixed variants (ancestors + focused + descendants) in a single call → variants assigned correctly.
5. `data-rendered-at` propagates to every host card attribute.
6. Byte-equal across two invocations with the same inputs.
7. Status content is sanitized in the output (no script tags, no on* attributes).

Coverage target: aim for the same 95% lines/functions/statements and 90% branches the headless package enforces. caribou-elena's vitest config currently has no enforced threshold, so this is aspirational rather than a CI gate — sized for parity with the keyed-list reconciliation PR's standard.

### 6.2 Extended hydration-parity tests (`tests/integration/hydration-parity.test.ts`)

Add cases for cards with status data, exercising the new `{ attrs, props }` form of `renderShadowComponentToString`. Add a populated-list case that runs the helper twice and asserts byte-equality.

### 6.3 Per-route integration tests

One per page (`tests/integration/route-ssr/`):

- Mock upstream to return N fixture statuses.
- Drive `pageData(event)` with a fake H3 event.
- Assert the returned `populatedListHtml` contains the expected `<li data-key>` markers and recognizable substrings from each card's content.
- Assert the absence of the empty-mount shape (regression guard).

For thread, additionally assert variants are assigned correctly and descendants carry depth attrs.

### 6.4 Card component test

Focused unit test for the `now`-resolution change:

- Create card element, set `dataset.renderedAt = '1700000000000'`, set `card.status = fixture`, capture rendered timestamp text, assert it reflects "5m ago" relative to the data-rendered-at value (not `Date.now()`).
- Trigger a second render (re-assign `card.status`), assert the timestamp now uses `Date.now()` (or a different fixed value via Vitest's clock mock).

### 6.5 No-JS Playwright re-verification

Plan 3 already has a Playwright test for `/local` with JavaScript disabled. Re-run it after the change and confirm the test still passes — DSD is materialized by the browser parser without JS, so cards should remain visible. No new Playwright test required for this PR; the existing one provides the regression guard.

### 6.6 Tests intentionally NOT added

- Wall-clock timing comparison ("flicker is shorter"). Hard to measure reliably; structural proof (SSR HTML contains cards) is the right proxy. Aligns with the keyed-list PR's spec §10.5 rejection of happy-dom timing benchmarks.
- E2E cross-route navigation timing. The flicker is observable in production but not deterministically reproducible at CI speeds; any threshold-based assertion would be flaky.

## 7. Out of scope

- **`/home` flicker.** Auth-required + Plan 3 §11 privacy property = SSR can't fetch the user's home timeline. Inherent design constraint.
- **Elk-style default-instance redirect for signed-out users.** Captured for future brainstorm (`feedback`/`project` memory entry).
- **Per-card render caching server-side.** Premature; bench first if SSR cost ever dominates request throughput. LRU cache keyed by `(status.id, status.editedAt, variant)` is the obvious mitigation when needed.
- **SPA routing** (LitroRouter / `<litro-link>`). Plan 3 §10 explicitly rejected. Even with SSR list rendering, the full-page navigation tear-down moment persists — but it's a deliberate architecture choice, not a fix target.
- **Periodic timestamp text updates** on idle cards. The "5m ago" text remains static after first paint until the card's `status` property is reassigned. A future `<caribou-relative-time>` web component or global ticker would address it; not blocking this PR.
- **Non-DSD browser fallback for no-JS.** Browsers that don't materialize `<template shadowrootmode>` see empty cards. Plan 3 already accepted this baseline.

## 8. Considered and rejected

### 8.1 Render-shadow learns about list mounts

Generic context-passing pipeline where `render-shadow.ts` recognizes a marker on `<caribou-list-mount>` and injects populated cards via a server-side data map. Rejected: tight coupling of the generic SSR primitive to specific component types; introduces a request-scoped context registry; complex for a one-off use case.

### 8.2 Timeline owns SSR via a serialized `initial` attribute

Page emits `<caribou-timeline kind="local" initial='${JSON}'>` and the component's own render parses + emits the populated mount. Rejected: JSON-in-attribute is verbose (30–50 KB per page); the attribute persists in client DOM after hydration (harmless but ugly); duplicates Litro's `serverData` marshalling mechanism that already exists.

### 8.3 Hide timestamps on SSR, render client-side only

Avoids the SSR↔client mismatch by emitting cards without timestamps server-side. Rejected: the text-pop-in is visible (defeats the flicker fix for the timestamp text specifically), and the `now`-plumbing approach (§5) is cheap.

### 8.4 Emit absolute `<time>` tags, format post-hydration

SSR emits `<time datetime="...">2026-05-11T07:34:00Z</time>`; client formats to relative on hydration. Rejected because of the visible ISO-string → "5m ago" swap on first hydration. The chosen approach gives strict parity with the same plumbing cost.

### 8.5 Accept the 1-unit-off mismatch

SSR emits "5m ago"; client renders "6m ago" if hydration takes a minute. Elena's morph patches the text node. Rejected: minor character flicker is visible, and the fix is cheap.

## 9. Open questions / follow-ups

None blocking. Captured for context:

- **`<caribou-relative-time>` web component.** If multiple components end up emitting relative-time text, extract a shared component that handles both first-render-uses-SSR-now and periodic ticking. Out of scope for this PR.
- **`<caribou-list-mount>` `<style>` block presence on DSD.** The mount's client-side `connectedCallback` injects `<style>:host { display: block }</style>` plus the styled `<ul>`. The helper emits the same shape verbatim. Confirm the `<style>` block's exact text (single space inside `{ display: block }` vs `{display:block}`) matches between the two paths to keep byte-equality strict. The hydration-parity test for the mount itself (added in keyed-list PR Task 2) covers this; extending it for the populated case is straightforward.
- **Per-route cache headers.** Currently the `[...].ts` catch-all sets `content-type` but no `Cache-Control`. SSR-rendered HTML for public-read routes could be cached at the CDN layer with short TTLs (~10s) for anonymous requests. Separate concern, not part of this PR.

## 10. Diff size estimate

- New helpers (`render-populated-list.ts` + `server-now.ts`): ~120–160 LOC.
- `renderShadowComponentToString` `{ attrs, props }` extension: ~30 LOC + a couple of legacy-form-tolerance branches.
- `<caribou-status-card>` `now`-resolution + `data-rendered-at` plumbing: ~20–30 LOC.
- `formatRelativeTime` extension: ~5 LOC.
- Page changes × 4 routes: ~30–60 LOC each (~180 LOC total).
- Helper unit tests: ~250–350 LOC.
- Per-route integration tests: ~100–150 LOC each (~500 LOC total).
- Hydration-parity test additions: ~80–120 LOC.
- Card component test additions: ~40–60 LOC.

Total: ~1100–1350 LOC, dominated by tests. Production code is ~350–450 LOC.
