# Keyed-list reconciliation — Before / After numbers

These numbers compare the index-keyed Plan-3 render path against the
keyed-reconciler post-Task-18 path. "Before" numbers are derived
analytically from the Plan-3 code structure (`git show main:apps/caribou-elena/pages/components/caribou-timeline.ts`);
"After" numbers come from `packages/caribou-ui-headless/src/__tests__/reconcile-keyed-list.bench-counts.test.ts`,
which asserts them as exact-count CI gates.

## Methodology

- **Before path (Plan 3 head):** `render()` emits `${this.statuses.map((s, i) => html\`<li>...</li>\`)}` — Elena's `morphContent` walks every `<li>` in the template fragment against the live `<ul>`'s children, patching attributes and recursing into each subtree. Then `updated()` runs `cards.forEach(card => { if (status && card.status !== status) card.status = status })` for every card with a `data-index`. The identity guard (`card.status !== status`) prevents redundant setter fires when the Status object reference is unchanged; however, it cannot prevent the morph walk, which visits every `<li>` on every render that touches the statuses array.

- **After path (this PR):** `render()` emits `<caribou-list-mount></caribou-list-mount>` — morph leaves this single shadow-DOM host alone (shadow DOM is morph-opaque; morph does not recurse into it). `updated()` calls `reconcileKeyedList(...)` which only touches DOM for new/removed/moved items and only fires `card.status = s` when `card.status !== s` (same identity guard, applied per-card in `update`).

- **"Before" morph walks** counts the number of `<li>` children Elena's `morphContent` recurses into during a render call. Each walk visits the `<li>` itself and the `<caribou-status-card>` inside it (attribute patching + child diffing).

- **Wasted setter fires** counts `card.status` reassignments on cards whose underlying Status reference is unchanged. Because the Plan-3 `updated()` includes an identity guard, this number is 0 in all stable scenarios — the difference between the paths is the morph walk, not superfluous setter calls.

## Scenario table

| Scenario | Before (morph walks + setter fires) | After (reconciler ops + setter fires) |
|--|--|--|
| Poll prepends K=3 onto N=10-status timeline | 13 `<li>` morph walks + 3 setter fires (new cards only; identity guard suppresses the 10 stable cards) | 0 morph walks + 3 creates + 3 inserts + 0 moves + 3 setter fires (in `create`) |
| `loadMore()` appends K=20 onto N=20-status timeline | 40 `<li>` morph walks + 20 setter fires (new cards only; 20 stable cards suppressed by identity guard) | 0 morph walks + 20 creates + 20 inserts + 0 moves + 20 setter fires (in `create`) |
| Poll, no new posts | 0 morph walks + 0 setter fires (gated by the effect's shallow-compare — `requestUpdate()` not called) | 0 morph walks + 0 setter fires (same gate preserved; `reconcileKeyedList` not called) |
| Tab swap on 20-status profile (entirely new list) | 20 `<li>` morph walks + 20 setter fires (every Status reference changed; identity guard fires on all) | 0 morph walks + 20 creates + 20 inserts + 20 removes + 20 setter fires (in `create`; old elements removed) |

### Correction from draft vs. actual Plan-3 code

The draft framed the "before" cost as "wasted setter fires." The actual Plan-3 `updated()` already has an identity guard (`if (status && card.status !== status) card.status = status`) — so setter fires are not wasted in the index-keyed path either. The real structural cost eliminated by this PR is the **morph walk**: Plan-3 passes N `<li>` elements through Elena's `morphContent` on every render; the after path passes one opaque `<caribou-list-mount>` shadow-DOM host that morph does not recurse into. On a 20-card timeline that is 40 subtree walks (20 `<li>` + 20 `<caribou-status-card>`) eliminated per poll tick.

## What this PR delivers

- The two scroll-jank-and-flicker scenarios users actually hit (timeline polls, infinite scroll) drop from O(N) Elena morph-subtree walks to O(0). Elena never touches the card list DOM; only the reconciler does, and only for the K new/removed/moved items.
- Card shadow-DOM identity is preserved on every prepend/append/move. In Plan-3, Elena's morph can reassign `data-index` on existing `<li>` elements and structurally patch their subtrees; morph does not know these subtrees contain shadow-DOM elements with internal state. The after path never moves a card's `<li>` unless the key truly moved in the list.
- The exact op counts for the reconciler algorithm are locked into CI by `reconcile-keyed-list.bench-counts.test.ts`. A future refactor that introduces unnecessary moves or creates will fail loudly.

## Caveats

- Numbers are analytical, not from a real-browser timer. Wall-clock benchmarks were rejected by the design (spec §10.5 — happy-dom-as-perf-harness antipattern).
- "Before" morph walk counts are structural estimates based on Elena's `morphContent` recursion model (one pass per child + one recursive pass per subtree). The actual cost in a real browser is dominated by the avatar `<img>` flicker / scroll position loss / focus loss that morph-induced DOM mutations can cascade into — those qualitative wins are why the PR exists, even though they don't show up in op counts.
- The bench-counts test uses N=5 and K=3 as representative sizes. The table above uses N=10/20 to match realistic timeline sizes; the scaling is linear in both paths.
