# Caribou `<caribou-list-mount>` SSR DSD adoption — design

**Date:** 2026-06-03
**Status:** draft (awaiting user review)
**Follow-up to:** [phase-4.3.1 signout + public-route feed restoration](2026-05-27-caribou-signout-state-fix-design.md) (PR #24)
**Related memory:** `caribou-public-route-feed-restoration` · `elena-ssr-lifecycle-skips-connectedcallback` · `elena-ssr-object-attr-json-parse`

## Problem

`/local`, `/public`, `/@handle`, and `/@handle/[statusId]` render their status cards client-side only. SSR produces the structural shell — header / `<caribou-list-mount>` empty / "Older posts →" anchor — but **no post cards are present in the SSR'd HTML**. Cards appear only after JS executes and the keyed reconciler populates the shadow `<ul>` imperatively.

The user-visible symptom is a brief structural-only flash on first paint:
- T = 0 ms: SSR'd HTML in browser. Shell visible, "Older posts" anchor visible, no cards.
- T = ~150–500 ms (depending on network): JS executes, hydration runs the reconciler, cards appear.

For signed-out-with-cookie users on `/local` and `/public`, this is the entire pre-hydration paint experience — they came to read public timelines and the first thing they see is an empty page that fills in.

It also breaks **Plan 3 Exit Criterion #8** in spirit, even though the technicality (byte-equal SSR == client pre-hydration render) is satisfied (both render an empty `<caribou-list-mount>`). The criterion's intent is "the no-JS smoke test sees the same content the JS-enabled user does," and right now no-JS sees an empty timeline.

## Root cause

`packages/caribou-ui-headless/src/list-mount.ts` is a **plain `HTMLElement`** (no Elena, no render(), no SSR participation). When Litro's Elena adapter walks the parent's rendered template and encounters `<caribou-list-mount>`, it calls `installPropGetters` + `new ComponentClass()` + `render()` — but `CaribouListMount` has no `render()`, so the adapter emits the empty element. The shadow UL only materializes in the browser via `connectedCallback`, which Elena SSR also doesn't fire (see [[elena-ssr-lifecycle-skips-connectedcallback]]).

The reconciler in `packages/caribou-ui-headless/src/reconcile-keyed-list.ts` is already SSR-friendly: its contract permits SSR-emitted `<li data-key>` children and the helper reuses them rather than recreating (line 80-91, `existing.get(key)` short-circuit). The blocker is that no one produces those SSR-emitted children today.

## Goals

1. SSR'd HTML for `/local` and `/public` includes the actual status cards inside the list-mount's shadow root (via Declarative Shadow DOM).
2. Post-hydration paint matches SSR paint without a full repaint of the list (the reconciler reuses the SSR'd `<li>` children).
3. Avatar-no-refetch invariant from Plan 3's e2e holds: subsequent polls do not refetch avatars. (One-time hydration reassignment of `card.status` is acceptable; the existing `if (card.status !== s) card.status = s` short-circuit handles steady-state correctly.)
4. No new patch hunks against `@beatzball/litro` or `@elenajs/core`. Caribou-only changes.

## Non-goals

- **`/home`** doesn't benefit from this. Auth-required for signed-out users; `maybeSwapToTimeline` swaps the placeholder for `<caribou-timeline>` only after hydration when signed in — SSR has no statuses to render. Out of scope.
- **`/@handle` and `/@handle/[statusId]`** (profile + thread) also have the SSR-paint flash, but their `<li>` shapes are richer than the timeline's (profile carries `variant`/`data-status-id`; thread carries `data-depth` + inline-margin styling + a tree ordering across ancestors → focused → descendants). They reuse the same `<caribou-list-mount>` and reconciler contract but need their own SSR `<li>` serializers. **Deferred to separate follow-up PRs** so the pattern can land cleanly on the highest-impact route first.
- **Polished hydration matching without ANY reassignment.** Reaching zero hydration-time `card.status` reassignment would require sharing object identity across the SSR↔client boundary, which is impossible without a runtime hydration protocol. One reassignment per card on initial hydration is acceptable.
- **Generic `caribou-ui-headless` SSR.** The package's "DOM-framework-agnostic" claim doesn't survive the Elena DSD dependency. The plain `HTMLElement` list-mount in `caribou-ui-headless` was speculative scaffolding for caribou-lit / caribou-fast adapters that don't exist; if/when those adapters are built they'd need their own list-mount because Lit's `ReactiveElement` and FAST's `FASTElement` reactivity differ from Elena's. **Just replace** — move the class into `apps/caribou-elena/pages/components/`, keep the canonical `caribou-list-mount` tag, delete the plain version, leave an inline comment in the new file documenting the adapter-specific framing.

## Design

### Replace `<caribou-list-mount>` with an Elena component

Move `packages/caribou-ui-headless/src/list-mount.ts` into `apps/caribou-elena/pages/components/caribou-list-mount.ts` as an Elena component, delete the original, and drop the export from `caribou-ui-headless`'s barrel. The tag name stays `caribou-list-mount`. All current consumers (timeline / profile / thread) live in caribou-elena and update their type imports to the new path.

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

Behaviorally identical to the old version on the client (open shadow + `<ul>` + `mountUl` getter); strictly additive for SSR (`<template shadowrootmode="open">` with pre-populated `<li>` children when `initial-items-html` is set).

### Caller responsibility: pre-render `<li>` children for SSR

The list-mount stays generic — it doesn't know about statuses. Each caller (timeline, profile, thread) is responsible for serializing its items to the same `<li data-key="${key}"><{inner-tag} {inner-prop}="${json}"></{inner-tag}></li>` shape that the reconciler would have produced imperatively.

For `<caribou-timeline>`:

```ts
override render() {
  // ... existing error/loading/empty checks using initial.statuses fallback
  const fallback = this.initial?.statuses ?? []
  const statuses = this.statuses.length > 0 ? this.statuses : fallback
  const itemsHtml = statuses.map((s) =>
    `<li data-key="${escapeHtmlAttr(s.id)}">` +
      `<caribou-status-card status="${escapeHtmlAttr(JSON.stringify(s))}"></caribou-status-card>` +
    `</li>`,
  ).join('')
  return html`
    <div>
      <caribou-new-posts-banner></caribou-new-posts-banner>
      <caribou-list-mount initial-items-html="${itemsHtml}"></caribou-list-mount>
      ${nextHref ? html`<a ...>...</a>` : html``}
    </div>
  `
}
```

`escapeHtmlAttr` handles `&`, `<`, `>`, `"`, and `'` since both `data-key` and the JSON `status` attribute go through attribute serialization. Elena's `html` tag already escapes attribute slots, but we're constructing the HTML by string concatenation outside the tagged template, so manual escaping is required for the inner content. The OUTER `initial-items-html="${itemsHtml}"` slot is escaped by Elena's tag because we use the tagged template for that level.

### Reconciler post-hydration walk

After the SSR-emitted `<li data-key>` children land in the shadow UL via DSD, the reconciler's first reconcile pass:

1. Walks `parent.children` (the SSR'd li's), reads `data-key`, builds `existing` map.
2. For each item in `items`, finds the matching existing li (no `create` call).
3. Calls `update(li, item)` — the timeline's update is:
   ```ts
   const card = li.firstElementChild as ... & { status?: Status }
   if (card.status !== item) card.status = item
   ```
4. `card.status` was JSON-parsed from the SSR attribute during element upgrade — different reference from `item` (which comes from `this.statuses`, sourced from the store seeded with `initial.statuses`). So one reassignment happens.

The reassignment triggers a single `<caribou-status-card>` render. Subsequent polls (after this hydration moment) see steady-state references from the store and the `!==` short-circuit makes them no-ops — preserving the avatar-no-refetch invariant.

To reach **zero** hydration-time reassignment, the timeline would need to seed `this.statuses` from the SAME object identity that the SSR'd `<caribou-status-card>` parsed. That's not possible without a hydration protocol that re-shares references across the SSR boundary, which neither Elena nor Litro provides. **Acceptable trade-off.**

### Hydration parity test

`apps/caribou-elena/tests/integration/ssr-hydration-parity-shell.test.ts` (existing) byte-compares SSR output to client `render()` output. After this change, SSR for a timeline-bearing route includes the populated `<li>` children. The client's pre-hydration render() (before the effect populates `this.statuses`) uses the `initial.statuses` fallback (already done in PR #24's render-fallback), so it produces the same children HTML.

Whitespace normalization in the parity helper (`packages/elena-morph-spec/`'s `normalizeWhitespace` or similar) needs to handle the new structure. If the test fails on whitespace, adjust the helper to be more aggressive; do not adjust the production output to match the helper.

## Affected files

**Create:**
- `apps/caribou-elena/pages/components/caribou-list-mount.ts` — Elena replacement
- `apps/caribou-elena/pages/components/__tests__/caribou-list-mount.test.ts`
- `apps/caribou-elena/pages/components/_render-status-li.ts` — SSR `<li>` serializer (timeline-only consumer; intentionally narrow API. Profile and thread follow-up PRs reuse or generalize as needed.)
- `apps/caribou-elena/pages/components/__tests__/_render-status-li.test.ts`
- `apps/caribou-elena/tests/integration/ssr-list-paint.test.ts` — vitest assertion that SSR'd `/local` HTML contains `<caribou-status-card>` cards
- `apps/caribou-elena/tests/e2e/no-js-public-timeline.spec.ts` — Playwright with `javaScriptEnabled: false` confirming `/local` shows cards

**Modify:**
- `apps/caribou-elena/pages/components/caribou-timeline.ts` — emit `initial-items-html` on list-mount; update type import path for `CaribouListMount` from the package barrel to the new local module
- `apps/caribou-elena/pages/components/caribou-profile.ts` — type import path only (functionality unchanged in this PR; SSR-paint flash deferred to follow-up)
- `apps/caribou-elena/pages/components/caribou-thread.ts` — type import path only (functionality unchanged in this PR; SSR-paint flash deferred to follow-up)
- `packages/caribou-ui-headless/src/index.ts` — drop the `list-mount` export
- `.changeset/list-mount-ssr-dsd.md` — patch bump for `caribou-elena`
- `.changeset/list-mount-removed.md` — patch bump for `@beatzball/caribou-ui-headless` (export removed from public surface)

**Delete:**
- `packages/caribou-ui-headless/src/list-mount.ts`
- `packages/caribou-ui-headless/src/__tests__/list-mount.test.ts` (if it exists)

**Untouched:**
- `packages/caribou-ui-headless/src/reconcile-keyed-list.ts` — contract already supports SSR-emitted children
- `@beatzball/litro` patches — none needed

## Risks

| Risk | Mitigation |
|---|---|
| Existing avatar-no-refetch e2e flakes harder under the new SSR-then-hydrate path. | One acknowledged reassignment per card on hydration. The e2e measures poll-time refetches, not hydration-time. If it does flake, adjust the test setup to wait for hydration to settle before snapshotting initial avatar fetches. |
| `unsafeHTML` is a code-injection vector if the items aren't escaped properly. | The shared `_render-status-li.ts` helper does all attribute escaping. Its test covers: `&`, `<`, `>`, `"`, `'`, unicode, and a status with HTML in its content. |
| Hydration parity test's whitespace normalizer doesn't handle the new shape. | Adjust the normalizer, not the production output. The byte-equal contract is a tool, not a goal. |
| `caribou-list-mount` tag collision if some path still imports the deleted plain version. | Plain version is deleted from `caribou-ui-headless` in this PR. CI grep guard: `git grep "from '@beatzball/caribou-ui-headless'" apps/caribou-elena | grep -i list-mount` must return empty. Build error catches stale type imports. |
| Status JSON in attribute can be large (~2-4 KB per card × 20 cards = ~60-80 KB per page). | Attribute-size cost is the same as the current `<page-local>` SSR data embed; we're moving where the bytes live, not adding more. Acceptable. |

## Verification

1. `pnpm --filter caribou-elena typecheck` — clean.
2. `pnpm --filter caribou-elena test` — all green, new tests included.
3. `pnpm --filter caribou-elena build && PORT=4321 STORAGE_DIR=./.data node dist/server/server/index.mjs` then `curl -s "http://localhost:4321/local" -H "Cookie: caribou.instance=fosstodon.org" | grep -c '<caribou-status-card '` — returns `≥ 1` (actually 20 for a fresh fosstodon.org load).
4. `pnpm --filter caribou-elena exec playwright test tests/e2e/no-js-public-timeline.spec.ts --project=chromium` — green.
5. Existing parity test still green: `pnpm --filter caribou-elena exec vitest run tests/integration/ssr-hydration-parity-shell.test.ts`.
6. Existing avatar-no-refetch e2e: `pnpm --filter caribou-elena exec playwright test tests/e2e/home.spec.ts --project=chromium -g "avatar"` — green (in isolation; the parallel-flakiness pre-existed).
7. Manual: load `/local` over a throttled connection with cache disabled. Confirm cards visible on first paint, no flash from empty to populated.

## Resolved (user, 2026-06-03)

1. **Plain `<caribou-list-mount>`:** delete from `caribou-ui-headless`. Inline comment in the new Elena file documents the adapter framing for future Lit/FAST adapters. No "keep just in case" scaffolding.
2. **Scope:** timeline only in this PR. Profile + thread inherit the type-import path change (mechanical) but their render() and SSR-paint flash fix land in follow-up PRs once the Elena `<caribou-list-mount>` + helper pattern is proven.
