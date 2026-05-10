# Caribou — Keyed-List Reconciliation Design Spec

**Status:** approved (brainstorm complete, awaiting implementation plan)
**Origin:** Plan 3 spec §11.1a deferred follow-up. Lands as a focused PR after Plan 3 merges, before Plan 4 starts.
**Companion plan:** to be written by `superpowers:writing-plans` after this spec is approved.

## 0. Goal

Replace index-keyed `${items.map(...)}` rendering in three host components — `<caribou-timeline>`, `<caribou-profile>`, `<caribou-thread>` — with a keyed reconciler that diffs by `status.id`. After this PR, prepends (poll, `applyNewPosts`) only insert new nodes at the head and appends (`loadMore`) only push new ones at the tail; no card whose underlying status didn't change has its `.status` setter re-fired or its `<li>` wrapper morphed.

The work is mandated as a discrete PR by Plan 3 §11.1a: "deserves its own PR with measurable before/after numbers." This spec captures the design; an implementation plan follows.

## 1. Scope

In scope:

- New module `packages/caribou-ui-headless/src/reconcile-keyed-list.ts` exporting one pure function.
- Adoption in `<caribou-timeline>`, `<caribou-profile>`, `<caribou-thread>`.
- Op-count-based regression metric in CI (§8).
- Validation POC (§4) — must pass before any other work in this PR merges.

Out of scope (deferred or excluded — see §9 for the full list):

- `<caribou-status-list>` component extraction (Plan 4 territory per Plan 3 §8.2).
- SSR list pre-rendering of `<ul><li data-key>...</li></ul>` (timeline/profile/thread routes do not currently SSR their list contents — see §6).
- Wall-clock benchmarks (rejected; see §10).

## 2. Architecture & module boundary

One new module:

- **`packages/caribou-ui-headless/src/reconcile-keyed-list.ts`** — exports one pure function `reconcileKeyedList`. Re-exported from the package's `index.ts`. No module-level state, no class, no DOM globals. Runs unmodified in happy-dom and real browsers.

Pattern in each host component:

- `render()` emits the wrapping `<ul>` (with frame chrome — banner, sentinel anchor, header, etc., as siblings) but **no `<li>` children**.
- The host's existing reactivity hook (timeline's `effect()`, profile's `effect()`, thread's store subscription) calls `this.requestUpdate()` when the relevant store output changes.
- `updated()` stashes a reference to the `<ul>` on first run and calls `reconcileKeyedList(parent, items, …)` against it.
- The pre-existing `effect()` shallow-compare gate stays. `render()` returns four different shapes for timeline (error / loading / empty / list) — only one shape contains a `<ul>` — so the gate is the right place to short-circuit non-list state transitions; the helper only short-circuits the no-op *list* case.

Helper-owned attribute: **`data-key`** on every direct child of `parent`. Caller never writes it. Helper assumes `parent.children` only contains elements it created; any direct child without `data-key` (or with a stale one) is removed on the next reconcile (§3).

## 3. Helper API & algorithm

### 3.1 API

```ts
export interface ReconcileKeyedListOptions<T> {
  parent: Element
  items: readonly T[]
  keyOf: (item: T) => string
  create: (item: T) => HTMLElement
  update?: (el: HTMLElement, item: T) => void
}

export function reconcileKeyedList<T>(opts: ReconcileKeyedListOptions<T>): void
```

### 3.2 Caller contracts

- `keyOf(item)` MUST return a non-empty string. Empty strings are reserved as the "no key" sentinel and trigger removal.
- `update(el, item)` MUST be a no-op when `item` is reference-equal to the value that produced the current DOM state. Callers express this as `if (card.status !== s) card.status = s`. The helper invokes `update` once per item per reconcile; idempotency keeps op-count tests deterministic.
- `parent.children` MUST contain only elements created by `reconcileKeyedList` (or SSR-emitted with matching `data-key` attrs). Hand-rendered children interleaved with helper-managed children is unsupported.

### 3.3 Algorithm (cursor walk, O(n) time)

1. Build `existing: Map<string, Element>` by reading `data-key` off each direct child of `parent`. Children with missing or empty `data-key` are skipped here (and removed in step 3 because they are absent from `wantedKeys`).
2. Build `wantedKeys = new Set(items.map(keyOf))`.
3. For each `[key, el]` in `existing` not in `wantedKeys`: `el.remove()`; drop from `existing`. Children with missing/empty `data-key` from step 1 are also removed via this path.
4. Walk `items` in order with `cursor = parent.firstChild`:
   - `key = keyOf(item)`
   - If `existing.has(key)`:
     - `el = existing.get(key)`
     - If `el === cursor`: `cursor = cursor.nextSibling` (already in place)
     - Else: `parent.insertBefore(el, cursor)`. Cursor is unchanged because the moved node is now *before* cursor — the load-bearing invariant of the walk.
   - Else (new item):
     - `el = create(item); el.dataset.key = key; parent.insertBefore(el, cursor)`. Cursor unchanged for the same reason.
   - If `update` is provided: `update(el, item)`.

### 3.4 Op-count contract

For the regression-guard tests in §8.1, op counts are asserted as exact numbers under the following definitions:

- **create**: one `create(item)` invocation.
- **insert**: one `parent.insertBefore` invocation **for a freshly-created element**.
- **move**: one `parent.insertBefore` invocation **for an existing element** AND `el !== cursor` AND `el !== cursor.previousSibling` (the latter excludes the no-DOM-effect self-move case).
- **remove**: one `el.remove()` invocation.
- **update**: one `update(el, item)` invocation.

Under the algorithm:

| Scenario | creates | inserts | moves | removes | updates |
|--|--|--|--|--|--|
| Empty → N | N | N | 0 | 0 | N |
| N → identical N (same refs) | 0 | 0 | 0 | 0 | N |
| Prepend K (`[A,B,C]` → `[X,Y,A,B,C]`) | K | K | 0 | 0 | N+K |
| Append K (`[A,B,C]` → `[A,B,C,Y,Z]`) | K | K | 0 | 0 | N+K |
| Remove middle (`[A,B,C,D]` → `[A,C,D]`) | 0 | 0 | 0 | 1 | 3 |
| Swap adjacent (`[A,B,C]` → `[B,A,C]`) | 0 | 0 | 1 | 0 | 3 |
| Full reverse (`[A,B,C,D]` → `[D,C,B,A]`) | 0 | 0 | 3 (n−1) | 0 | 4 |

These exact numbers are the regression-test assertions in §8.1.

### 3.5 Dev-mode invariants

In dev mode only, the helper:

- Throws on duplicate keys: `items.length !== wantedKeys.size`.
- Asserts the post-condition `[...parent.children].map(c => c.dataset.key)` equals `items.map(keyOf)` element-for-element.

Detection: `typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV`. The hardened guard handles Vite (defines `import.meta.env`), Vitest (defines `import.meta.env.DEV = true`), and Nitro server (does not define `import.meta.env`; the guard returns false and the dev block is skipped). Plain Node ESM is also tolerated.

The duplicate-key throw is a contract assertion, not a meaningful production gate — `keyOf(s) = s.id` and Mastodon API guarantees unique IDs per page; the `statusCache` Map in `@beatzball/caribou-state` already de-dupes. The throw fires only on store-side bugs that nothing else exercises in dev. We keep it because it's cheap and makes the contract explicit; we do not pretend it adds defense in depth.

## 4. Validation POC (must pass before other work merges)

The single largest unverified assumption in this design: when a host's render template emits an empty `<ul></ul>` but the live DOM has a populated `<ul>` with helper-managed children, what does Elena's `morphContent` do? The morph spec at `packages/elena-morph-spec/src/__tests__/morph-custom-elements.test.ts` covers custom-element children but not native-element parents whose template-side appears empty. If morph wipes live children to match the empty template, the entire design fails.

**Validation POC** — implemented and passing before any host adoption work merges:

A vitest test in `packages/elena-morph-spec/src/__tests__/morph-empty-native-parent.test.ts` (lifted into Elena upstream when ready, per the package's stated purpose):

1. Define a minimal Elena element whose render emits `<div><ul></ul></div>`.
2. Mount it; populate the `<ul>` with three `<li>` children imperatively.
3. Trigger a re-render.
4. Assert the three `<li>` children survive (`Object.is` on captured node refs) and the `<ul>` still has length 3.

If the assertion holds, design proceeds as written. If it fails, the design pivots — most likely to wrapping each list in its own light-DOM child custom element with `static shadow = 'open'`, which morph respects (per spec §1) — and the spec is revised before any host adoption.

This mirrors Plan 3 §6.6's validation-POC pattern.

## 5. Integration in three call sites

### 5.1 `<caribou-timeline>` (light DOM)

Changes:

- `render()` emits the empty `<ul data-status-list></ul>` plus existing siblings (banner, sentinel anchor). The four-shape early-return branches (error / loading / empty / list) are preserved.
- The `effect()` shallow-compare gate is preserved.
- `updated()` stashes `this.listEl ??= this.querySelector('ul[data-status-list]')`, then calls `this.reconcile()`. Banner imperative wire and IO-sentinel logic are unchanged.
- The existing `data-index`-keyed `card.status =` loop in `updated()` (currently lines 109–116) is **deleted**. Its responsibility moves to the helper's `update` callback.
- `data-status-id` on the card stays as a debug attribute. The helper's `data-key` lives on the `<li>` parent — no collision.

Sketch:

```ts
private listEl: HTMLUListElement | null = null

override updated() {
  this.listEl ??= this.querySelector<HTMLUListElement>('ul[data-status-list]')
  // … existing banner imperative wire …
  // … existing IO-sentinel first-run setup …
  this.reconcile()
}

private reconcile() {
  if (!this.listEl) return
  reconcileKeyedList({
    parent: this.listEl,
    items: this.statuses,
    keyOf: (s) => s.id,
    create: (s) => {
      const li = document.createElement('li')
      const card = document.createElement('caribou-status-card')
      ;(card as any).status = s
      li.appendChild(card)
      return li
    },
    update: (li, s) => {
      const card = li.firstElementChild as HTMLElement & { status?: Status }
      if (card.status !== s) card.status = s
    },
  })
}
```

### 5.2 `<caribou-profile>` (light DOM)

Identical shape to 5.1. The card gets `variant="timeline"` set imperatively in `create`. Header imperative wire (`header.account = …`) and sentinel logic are unchanged. The current `data-index`-keyed `card.status =` loop in `updated()` (lines 84–91) is **deleted**.

### 5.3 `<caribou-thread>` (shadow DOM)

`<ul data-thread-list>` lives inside the shadow root and mixes three sources of children: ancestors → focused → descendants.

- `collectStatuses()` is renamed and extended to `collectThreadItems()`, returning a flat array of `{ status, depth: number | null }`. Ancestors and the focused status get `depth: null`. Descendants get a numeric depth.
- `keyOf({ status }) = status.id`.
- `create({ status, depth })` constructs `<li><caribou-status-card variant="…" /></li>`. Variant is `"focused"` for the focused item, `"ancestor"` for `depth === null` non-focused items, `"descendant"` otherwise. When `depth !== null`: `li.dataset.depth = String(depth)`, `li.style.marginInlineStart = \`calc(var(--space-4)*\${depth})\``, and `card.dataset.depth = String(depth)` (the inner-card `data-depth` is preserved per current behavior at `caribou-thread.ts:134`; remove only if confirmed dead code).
- `update(li, { status, depth })` re-syncs `card.status`, `li.dataset.depth`, `li.style.marginInlineStart`, and `card.dataset.depth` when depth shifts (e.g., when a previously-orphaned descendant's parent arrives and reparents it to a smaller depth).
- Helper operates on shadow children identically to light children — `parent.children` / `insertBefore` / `remove` are inherited Element APIs. No special-casing required.

## 6. SSR / hydration impact

**Today's reality:** timeline / profile / thread routes do not currently SSR their `<ul><li>` list contents. The Litro Elena adapter SSR pipeline runs each component's `render()` with `statuses.length === 0` (the page sets `tl.initial` only client-side after hydration). The SSR'd HTML for these routes contains `<caribou-timeline kind="local"></caribou-timeline>` and the host's "Loading…" branch — *not* a populated `<ul>`. Plan 3 §12.6's byte-equal hydration parity test does not currently cover list-shaped components.

**Implication for this PR:** the helper's hydration story (read SSR-emitted `data-key` attrs, reconcile in place with zero churn) applies *if and when* SSR list pre-rendering lands. This PR does not require it and does not add it. The first hydration call on each host today finds an empty `<ul>` and creates `<li>` children from scratch — identical to the post-Plan-3 behavior, no regression.

**Forward-compatibility:** the helper's `data-key`-driven matching means future SSR list emission lands as a pure additive change. The SSR emitter writes `data-key={status.id}` on each `<li>` and the helper's first reconcile sees `existing` populated, drives zero `create`/`insert`/`remove` ops, and only fires `update` (which is a no-op on reference-equal items). This is captured as a one-liner in the future SSR emitter's contract; no code in this PR depends on it.

**Non-goal call-out:** if a future PR ever creates `<li>` children imperatively on the client without going through the helper (e.g., a hand-tuned compose-reply flow), the helper's "`parent.children` only contains helper-managed elements" contract is what guards against drift — hand-written children without `data-key` get removed on the next reconcile (§3.3 step 3). That's the right failure mode for an unsupported pattern.

## 7. Testing plan

### 7.1 Helper unit tests (`packages/caribou-ui-headless/src/__tests__/reconcile-keyed-list.test.ts`)

Pure happy-dom tests. Each scenario builds a parent `<ul>`, runs `reconcileKeyedList` against deterministic `items`, asserts both DOM state and op counts. Op spies wrap `parent.insertBefore` / `Element.prototype.remove`; `create` and `update` call counts are tracked via the closure.

Required scenarios:

1. Empty → N (initial mount).
2. N → identical N (same refs) — zero `insertBefore`/`remove`, N `update` invocations.
3. Prepend K — K `create` + K `insert`, 0 `move`, 0 `remove`.
4. Append K — same op profile at the tail.
5. Remove middle — 1 `remove`, no other ops.
6. Swap adjacent — 1 `move`.
7. Full reverse — (n−1) `move`s.
8. Mixed (`[A,B,C,D]` → `[X,B,D,Y]`) — 2 `create` + 2 `insert` + 2 `remove`, plus moves needed to land D before Y.
9. Stable identity — after every scenario, surviving elements are `Object.is` to the captured pre-call refs.
10. Duplicate-key throw — dev-mode only; production-mode tolerates silently.
11. Missing-`data-key` direct child → removed on next reconcile (§3.3).
12. Negative test for the §3.5 post-condition assertion (validates the dev-mode assertion code itself runs, by passing a buggy synthetic `keyOf` that returns the wrong key for one item; assertion should fire).

Coverage target: the package's vitest threshold is **95% lines / 95% functions / 95% statements / 90% branches** (per `packages/caribou-ui-headless/vitest.config.ts`). The new module meets all four.

### 7.2 Component integration tests

Each host gets one new test exercising the realistic store-driven path:

- **Timeline (`apps/caribou-elena/pages/components/__tests__/caribou-timeline.test.ts`):** mount with seeded `initial` (20 statuses), capture all 20 `<li>` refs, drive `store.applyNewPosts()` with 3 prepended statuses, assert (a) `<li>[3..22]` are `Object.is` to the captured refs, (b) `<li>[0..2]` are new, (c) no card's `.status` setter fired for surviving cards (instrument via `Object.defineProperty` on `caribou-status-card.prototype.status`'s setter, count). Then call `store.loadMore()` and assert identity for the head plus a clean append at the tail.
- **Profile (`apps/caribou-elena/pages/components/__tests__/caribou-profile.test.ts`):** mount, drive a tab-change that swaps the entire status list, assert (a) DOM matches the new statuses, (b) `header.account` was *not* re-set (account didn't change across tabs — instrument the setter).
- **Thread (`apps/caribou-elena/pages/components/__tests__/caribou-thread.test.ts`):** mount with focused + 5 descendants, simulate a new descendant arriving that reparents one existing leaf to a smaller depth, assert (a) the existing 5 cards keep identity, (b) the reparented `<li>`'s `data-depth` and `style.marginInlineStart` were updated by the helper's `update` callback, (c) the card's `data-depth` matches.

### 7.3 Scroll-preservation test

A dedicated component test in the timeline test file:

- Mount with seeded `initial` of 50 statuses inside a scrollable container.
- Set `container.scrollTop = 800` (scroll past the first ~20 items).
- Fire `apply-new-posts` with 5 prepended statuses.
- Assert `container.scrollTop === 800` (browser preserves scroll across DOM mutations of preceding siblings; not preserved when nodes are recreated rather than moved).
- Assert the originally-rendered `<li>[0]` is now at `container.children[5]` by `Object.is`.

This is the user-perceived property the whole PR is delivering. happy-dom does not paint, but it does maintain `scrollTop` on a programmatically-set offset and respects DOM-mutation invariants.

### 7.4 Image-element identity test

Repurposed from `morph-custom-elements.test.ts §1c`'s flicker-repro pattern: render a card with `<img src="...">`, prepend new statuses, assert the original `<img>` element is `Object.is` to the post-prepend `<img>`. Lives in the timeline component test file.

### 7.5 Validation POC (§4)

Standalone test file in `packages/elena-morph-spec/src/__tests__/morph-empty-native-parent.test.ts`. Lifts into Elena upstream alongside the existing `morph-custom-elements.test.ts` — the package's stated boundary.

### 7.6 Out of scope for tests

- Playwright E2E. Visual identity is already covered by Plan 3's no-JS smoke; this PR is a pure refactor of the JS render path.
- Real-browser parity for the helper. The algorithm uses only `parent.children`, `dataset`, `insertBefore`, `remove` — universal DOM primitives. If parity ever breaks here, every other component breaks first.
- SSR `data-key` emission test in `render-shadow.test.ts`. Out of scope because §6 documents that SSR list pre-rendering is not part of this PR.

## 8. Measurement strategy

### 8.1 Op-count regression metric (CI-locked)

A dedicated test file `packages/caribou-ui-headless/src/__tests__/reconcile-keyed-list.bench-counts.test.ts`. The same scenarios as §7.1.3–7.1.7, but **op counts asserted as exact numbers** per the §3.4 contract. This is the algorithmic perf contract: if a future refactor accidentally reintroduces `O(n)` moves on prepend, this test fails with a clear delta.

### 8.2 Render-avoidance metric (CI-locked)

In each component integration test (§7.2), a counter is wired around `caribou-status-card.prototype`'s `status` setter via `Object.defineProperty`. The test asserts the setter fires only for items whose status reference changed. This captures the user-perceived metric — re-renders avoided — directly, rather than relying on DOM-op proxies.

### 8.3 "Before / After" numbers in the PR description

Captured once, by hand, before and after the swap:

- The "before" baseline runs the same component test instrumentation (status-setter spy + DOM-op spy) against the **current Plan 3 head** of `<caribou-timeline>` for the prepend-3-onto-20 and append-20-onto-20 scenarios. Numbers are recorded in the PR description.
- The "after" numbers come from §8.1 + §8.2 in the new code.

The headline table measures **wasted work on surviving cards** — i.e., setter fires on cards whose underlying status reference did not change. New cards' setters fire exactly once during `create` regardless of approach; that's not the avoidable cost.

| Scenario | Before (Plan 3 head) | After |
|--|--|--|
| Poll prepends 3 onto 20-status timeline | 20 wasted setter fires on surviving cards + 23 `<li>` morph walks | 0 wasted setter fires + 3 inserts + 0 moves (new cards' setters still fire once in `create`) |
| `loadMore()` appends 20 onto 20 | 20 wasted setter fires + 40 morph walks | 0 wasted setter fires + 20 inserts + 0 moves |
| Poll, no new posts | 0 (gated by shallow-compare) | 0 (gated by shallow-compare) |

(Numbers above illustrative; real ones captured in PR.)

## 9. Out of scope

Stated explicitly so this PR doesn't drift:

- **No `<caribou-status-list>` component extraction.** Plan 3 §8.2 defers the *component* until Plan 4 introduces a third real call site (bookmarks/notifications). This PR ships the *algorithm* only. The component, when it lands, will consume `reconcileKeyedList` internally.
- **No store-layer changes.** `createTimelineStore`, `createProfileStore`, `createThreadStore`, and their signals are untouched. Only the render path between store output and DOM changes.
- **No changes to card identity strategy.** Cards stay shadow-DOM and self-render; `data-status-id` remains as a debug attribute. The helper's `data-key` lives on the `<li>` parent.
- **No banner / sentinel refactor.** The imperative wiring for `<caribou-new-posts-banner>` and the IO sentinel on the "Older posts" anchor stays exactly as-is.
- **No SSR list pre-rendering.** §6 covers the rationale and the forward-compatibility hook.
- **No keyboard-shortcut / focus-management work.** Plan 4 territory.
- **No Plan 4 list views** (bookmarks, notifications, lists, hashtag timelines).

## 10. Considered and rejected

### 10.1 LIS-based optimal moves

A longest-increasing-subsequence algorithm minimizes moves at the cost of ~50 LOC of unfamiliar bookkeeping. At our list sizes (≤200 statuses on screen) the difference between naive cursor-walk move counts and LIS move counts is identical for the two scenarios that matter — prepend-K and append-K both produce zero moves under either algorithm. The pathological scrambled-list case where LIS wins does not occur in any Mastodon timeline read pattern. Naive cursor walk is the right algorithm at this scale.

### 10.2 WeakMap-backed cache inside the helper

An earlier iteration considered an internal `WeakMap<Element, Map<string, Element>>` keyed on `parent`, removing the need for callers to manage state. Rejected: it creates two state-of-the-world copies (the WeakMap and the DOM) that have to stay in sync; if a future bug ever mutates one without the other, things drift silently. Reading `data-key` off `parent.children` makes the DOM the single source of truth — identity claims are self-verifying. The cost (one short loop over `parent.children` per reconcile) is unmeasurable at our list sizes.

### 10.3 Caller-owned `Map<key, Element>` cache parameter

An alternative to 10.2: have the caller pass a `Map` field that the helper mutates. Rejected for the same reason: two sources of truth, drift potential. Strictly smaller API (4 parameters instead of 5) is the secondary win.

### 10.4 Per-host shadow-DOM list rendering

Each host could wrap its `<ul>` in its own shadow root, isolating list children from morph entirely. Rejected: three new shadow roots, three new style-inheritance considerations, and three new tests for shadow-DOM hydration parity for a problem the helper solves with no shadow-root changes.

### 10.5 Wall-clock benchmarks

Earlier discussion proposed pairing the op-count regression test with a `vitest bench` run producing wall-clock numbers (ms per reconcile, 1000 iterations, prepend / append / no-op scenarios on a 200-item list). The intent was to surface a human-readable "X ms before, Y ms after" comparison in the PR description.

**Rejected.** Wall-clock numbers from happy-dom — the only environment our headless-package test suite runs in — are theatre dressed as measurement:

- **happy-dom does not paint.** The actual cost of card re-renders that the change avoids includes layout, style recalculation, and paint. None of these run in happy-dom. A "5× faster" reading is a 5× speedup in JS-only DOM mutation throughput; it tells the reader nothing about what their browser will feel like.
- **happy-dom does not run a real GC profile.** Object churn under polling is one of the contributors to jank in real Mastodon clients (the masto status type is allocation-heavy). happy-dom's GC pressure profile differs enough from V8 that microbenchmarked allocation patterns translate poorly.
- **happy-dom skips IntersectionObserver scheduling.** The `<ul>`'s sentinel `<a data-sentinel>` is observed by `createIntersectionObserver` (`@beatzball/caribou-ui-headless`). Real-browser IO callbacks ride the same task queue as paint — wall-clock numbers that don't exercise that queue cannot reproduce the contention pattern that produces user-perceived jank.
- **vitest bench's reporter is variance-noisy across machines.** Even if every other concern were addressed, the resulting numbers would be useful only in side-by-side runs on the same host. CI machines and laptops produce numbers that differ by ≥3×, with no robust way to normalize.

The op-count metric (§8.1) plus the render-avoidance metric (§8.2) — counting the `card.status` setter invocations directly — is a stronger proxy for the user-perceived improvement than any wall-clock number from happy-dom. Op-counts are deterministic, machine-independent, and CI-enforceable. Setter invocations directly map to the cost users feel: every status setter fire causes a card-internal `_safeRender`, which traverses the card's shadow DOM template, which is what produces avatar flicker, scroll jank, and lost selection state in the polled timeline.

If a future case calls for real-browser numbers — e.g., a perf-regression investigation, a marketing piece, or an Elena upstream contribution arguing for keyed reconciliation as a framework primitive — the right tool is a Playwright `page.evaluate()` harness measuring `performance.now()` deltas against a real page. That work is non-blocking for this PR and is captured here only so future readers know why happy-dom benchmarks are absent. (This rationale is also a candidate for a future technical-details blog post — happy-dom-as-perf-harness is a common antipattern that's worth a public write-up.)

### 10.6 Dropping the `effect()` shallow-compare gate

Earlier iteration claimed the helper's `parent.children` attribute-read scan was cheap enough to replace the host's pre-existing shallow-compare gate. Wrong: the host's `render()` returns four different DOM shapes for timeline (error / loading / empty / list), and only the list shape contains a `<ul>`. Without the gate, every `cacheStatus()` write — which mints a new `statusCache` Map reference on every poll tick, including ticks that don't add statuses to the displayed timeline — would re-run the host's full `render()` and replace whatever shape was there. The helper does not help with non-list shapes; it only short-circuits the no-op case *within* the list shape. The gate stays.

## 11. Open questions / follow-ups

None blocking. Captured for context:

- **Inner-card `data-depth` on `<caribou-status-card>` (`caribou-thread.ts:134`).** Currently set on both the `<li>` and the inner card. This spec preserves the dual write pending confirmation that the inner attribute is consumed somewhere (CSS selector, JS query). If confirmed dead code, a follow-up PR removes it. Not in scope for this PR.
- **Imperative `document.createElement('caribou-status-card')` bypasses the DSD path.** No regression versus today (lists are already client-painted), but worth noting: when SSR list pre-rendering eventually lands, the helper's `create` callback will need adapting so freshly-created cards on the client (post-hydration `loadMore` results) match the DSD-painted cards from SSR. Captured here so that future SSR work doesn't rediscover it.

## 12. Diff size estimate

- New module (`reconcile-keyed-list.ts`): ~80 LOC.
- Helper unit tests + bench-counts test: ~250 LOC.
- Validation POC test: ~40 LOC.
- Three component modifications (timeline, profile, thread): ~30 / 20 / 40 LOC modified each.
- Three component test additions (integration + scroll + image-identity): ~150 LOC total across the three test files.
- Changesets: one per modified package (caribou-ui-headless, caribou-elena, elena-morph-spec).

Total: ~600 LOC added/modified, dominated by tests. The production-code change is ~150 LOC.
