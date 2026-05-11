## Summary

Plan 3 §11.1a deferred follow-up: replace index-keyed `${items.map(...)}` rendering in `<caribou-timeline>`, `<caribou-profile>`, and `<caribou-thread>` with a keyed-list reconciler so polls / `loadMore` / `applyNewPosts` only touch nodes whose underlying status actually changed.

**Architecture:** one pure function `reconcileKeyedList` plus one tiny custom element `<caribou-list-mount>` (shadow-DOM container, morph-opaque) — both in `@beatzball/caribou-ui-headless`. Hosts render the mount empty in their template; the helper reconciles its inner `<ul>` keyed by `status.id`. Validation POC pinned in `@beatzball/elena-morph-spec` documents *why* the mount is required (Elena's `morphContent` wipes empty-template native children).

Spec: `docs/superpowers/specs/2026-05-09-caribou-keyed-list-reconciliation-design.md`
Plan: `docs/superpowers/plans/2026-05-09-caribou-keyed-list-reconciliation.md`
Numbers: `docs/pr-notes/2026-05-11-keyed-list-reconciliation.md`

## Before / After

(Paste the contents of `docs/pr-notes/2026-05-11-keyed-list-reconciliation.md` here once finalized.)

## Test plan

- [ ] `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green from a clean clone.
- [ ] `@beatzball/caribou-ui-headless` coverage ≥ 95 / 95 / 90 / 95 (lines / functions / branches / statements).
- [ ] Op-count regression tests in `reconcile-keyed-list.bench-counts.test.ts` assert exact counts per spec §3.4 — fails loudly if a future refactor drifts.
- [ ] Validation POC (`@beatzball/elena-morph-spec/src/__tests__/morph-empty-native-parent.test.ts`) uses `it.fails` so the day Elena's morph stops wiping empty-template native children, the test fails and the workaround can be retired.
- [ ] `<caribou-timeline>` test (`caribou-timeline.test.ts`) pins:
  - Surviving card identity across `applyNewPosts` prepend.
  - Zero `caribou-status-card.status` setter fires on surviving cards under same-state poll ticks.
  - Scroll position preserved across prepend.
  - Card-internal `<img>` element identity preserved.
- [ ] `<caribou-profile>` test pins: header.account setter does not re-fire across tab swap (account unchanged).
- [ ] `<caribou-thread>` test pins: descendant arrival reparenting an existing leaf preserves `<li>` identity AND updates `data-depth`.
- [ ] **Manual smoke** (user — required before merge): `pnpm --filter caribou-elena dev:portless`, sign in to a real Mastodon instance, watch one full 30 s poll cycle on `/home` — confirm avatars don't flicker. Trigger `loadMore` by scrolling to bottom — confirm new posts append without wiping existing. Open a thread; reload to trigger fresh fetch — confirm cards render with correct depth indents.

Spec section §10.5 documents why happy-dom wall-clock benchmarks were rejected in favor of op-count regression + setter-fire counts (see the rejected-alternatives section if curious; the rationale is also a candidate for a future tech-blog post).

## Out of scope (called out so reviewers know)

- No `<caribou-status-list>` component extraction (Plan 4 territory per Plan 3 §8.2).
- No SSR list pre-rendering (timeline/profile/thread routes don't currently SSR their list contents; the helper is forward-compatible if/when that work lands later).
- No store-layer changes beyond test-only seams (`_testOnlyPrepend` on `TimelineStore`, `_testOnlySetDescendants` on `ThreadStore` — both underscore-prefixed).
