---
title: Upstream PRD — Elena `<litro-link>` as composite click-intercept wrapper + `pages/index.ts` tag rename
date: 2026-05-25
status: ready to hand to upstream
target-repo: ~/w/beatzball/litro
target-files:
  - packages/framework/src/adapter/elena/runtime/LitroLink.ts
  - packages/framework/src/plugins/path-to-route.ts (`fileToComponentTag` special case)
companion-patch: ~/w/beatzball/caribou/patches/@beatzball__litro@0.9.1.patch (hunks for adapter/elena/runtime/LitroLink.{ts,js} and plugins/path-to-route.{ts,js})
verified-by:
  - ~/w/beatzball/caribou/apps/caribou-elena/pages/components/__tests__/litro-link.test.ts (8 unit tests)
  - ~/w/beatzball/caribou/apps/caribou-elena/tests/integration/ssr-slot-composition.test.ts (per-route `<litro-link>` SSR assertion)
supersedes:
  - docs/superpowers/specs/2026-05-12-litro-link-shadow-slot-upstream-prd.md (phase-4.2 shadow+slot; rejected after Vimium/link-hint regression surfaced)
---

# Elena `<litro-link>` as composite + `pages/index.ts` tag rename (upstream PRD)

Two coupled upstream changes, delivered together.

## Part 1: composite `<litro-link>`

### Problem

Elena's `<litro-link>` currently renders `<a href>${this.text}</a>` in light DOM. Rich children (icon + label spans, etc.) are dropped on hydration because `this.text` is only the captured pre-upgrade text content. SSR-side `this.text` is undefined, so the SSR output is an empty `<a>`.

An earlier attempt (Caribou's `phase-4.2`, unmerged) made Elena's `<litro-link>` shadow+slot to match the Lit and FAST adapters: `<template shadowrootmode><a><slot></slot></a></template>`. That solved rich-children but introduced a separate accessibility / tooling regression: when consumers wrap `<litro-link>` inside another shadow-DOM component (e.g., a navigation shell), the inner `<a>` is two shadow boundaries deep. Link-hint extensions (Vimium, Tridactyl, browser-native link enumeration) only walk one shadow boundary and don't find the `<a>`. The same shape exists in Lit and FAST today; consumers nesting `<litro-link>` inside a custom-element shell hit the same wall.

### Proposed change

Replace `packages/framework/src/adapter/elena/runtime/LitroLink.ts` with a composite wrapper — no render, no shadow, no styles, no props. The author writes the semantic `<a>` directly inside the wrapper:

```html
<litro-link><a href="/path">Label</a></litro-link>
```

`<litro-link>` listens for click events via a capture-phase handler on its host. The handler walks `composedPath` to find the nearest `<a>` ancestor of the click target (bounded by the host itself). If the anchor is an internal same-origin path with no `target` attribute and the click has no modifier keys, the default is prevented and the URL is routed via `LitroRouter.go(href)`. Otherwise the click passes through (Cmd-click for new tab, middle-click, external links, fragments all behave like a plain `<a>`).

Full source: see the Caribou patch hunks at `patches/@beatzball__litro@0.9.1.patch` (entries for `src/adapter/elena/runtime/LitroLink.ts` and `dist/adapter/elena/runtime/LitroLink.js`). Predicate order matches the spec: `button !== 0` → modifier keys → `defaultPrevented` → composedPath search → `target` attribute → `href` shape (must start with `/`).

### Why composite, not shadow+slot

| Shape | Rich children? | Link tools see the `<a>`? | Author markup |
|---|---|---|---|
| Light-DOM + `${this.text}` (today) | No — dropped on hydration | Yes (no shadow involved) | `<litro-link href="…">text</litro-link>` |
| Shadow+slot (Lit/FAST/phase-4.2) | Yes | No when nested in another shadow-DOM component | `<litro-link href="…">…children…</litro-link>` |
| Composite (this PRD) | Yes | Yes — `<a>` stays in author's tree | `<litro-link><a href="…">…children…</a></litro-link>` |

Composite is the only shape that satisfies both columns. The trade-off is markup verbosity (one extra wrapper element) for unambiguous behavior across nesting depth.

### Migration notes for downstream consumers

- **Text-only consumers** (currently `<litro-link href="/blog">Back</litro-link>`) must wrap the text in an explicit `<a>`: `<litro-link><a href="/blog">Back</a></litro-link>`. One-line change per call site.
- **Rich-children consumers** that worked around the upstream bug with `text` props can drop those workarounds and put the structure inside `<a>`.
- **Snapshot tests** asserting on the old `<litro-link href><a></a></litro-link>` shape (auto-rendered inner anchor) need updating to expect the author-supplied `<a>` instead.
- **Server-side registration:** the composite shape doesn't need server-side registration in `__litro_elena_ce_map__`. The SSR adapter's unregistered-tag pass-through is the correct behavior — `<litro-link>` flows through unchanged with its children intact.

### Tests Litro should add

A minimal unit test inside `packages/framework/test/` (or wherever the Elena adapter tests live) covering:

1. **Click on inner `<a>` routes via LitroRouter**: dispatching a `click` event on the inner `<a>` calls `LitroRouter.go(href)` once with the anchor's `href`.
2. **Modifier-click pass-through**: clicks with `metaKey` / `ctrlKey` / `shiftKey` / `altKey` set DO NOT call `LitroRouter.go`.
3. **Middle-click pass-through**: `button !== 0` clicks DO NOT call `LitroRouter.go`.
4. **`target="_blank"` pass-through**: clicks on an anchor with any non-empty `target` attribute DO NOT call `LitroRouter.go`.
5. **External-href pass-through**: clicks on `<a href="https://…">`, `<a href="mailto:…">`, `<a href="#fragment">` DO NOT call `LitroRouter.go`.
6. **No-anchor pass-through**: clicks on the host outside any `<a>` (e.g., a `<span>` direct child) DO NOT call `LitroRouter.go`.
7. **`defaultPrevented` pass-through**: a prior capture-phase listener (on `document.body` or another ancestor) calling `event.preventDefault()` causes the LitroLink handler to bail without routing.
8. **No render**: a fresh `<litro-link>` instance keeps its author-supplied children — `instance.innerHTML` is not replaced on connect.

**Test infrastructure note:** Vitest's `vi.mock` does NOT intercept dynamic imports made from inside `node_modules` by default (the transformer skips node_modules). For routes-via-dynamic-import handlers like LitroLink's, mock the router with `vi.spyOn(LitroRouter, 'go')` against the real class, not via `vi.mock` of the module specifier. This is documented in the Caribou test file.

## Part 2: `pages/index.ts` → `'page-index'` (route-tag collision fix)

### Problem

`packages/framework/src/plugins/path-to-route.ts` `fileToComponentTag` special-cases `pages/index.ts` → `'page-home'`. This collides with `pages/home.ts` → `'page-home'` (path-derived). When a consumer has BOTH files (e.g., a separate landing page at `/` and an authenticated-home page at `/home`), Elena's `defineElement` is first-define-wins:

```js
// @elenajs/core: defineElement
reg?.get(tagName) || reg?.define(tagName, Element);
```

Whichever page module's class is imported FIRST claims `'page-home'`; the second `.define()` is a silent no-op. SSR and client-side hydration then bind both routes to the same class, producing wrong content on one of the two routes. The collision is invisible until you try to SPA-navigate between them, at which point the route resolution short-circuits unexpectedly.

### Proposed change

Change the special case from `'index' → 'home'` to `'index' → 'index'`:

```ts
// path-to-route.ts (fileToComponentTag)
if (cleaned.length === 1 && cleaned[0] === 'index') {
  return 'page-index'  // was 'page-home'
}
```

After this change:
- `pages/index.ts` → `'page-index'` (URL `/`)
- `pages/home.ts` → `'page-home'` (URL `/home`)

No collision. Consumers with only `pages/index.ts` and no separate `pages/home.ts` get the same effective behavior (their landing page now binds to `'page-index'` instead of `'page-home'`); they must update their page class's `static tagName` to match. Consumers with only `pages/home.ts` are unaffected.

### Migration notes for downstream consumers

- Apps with `pages/index.ts` and a `static override tagName = 'page-home'` declaration need to change the tagName to `'page-index'`. One-line change.
- Snapshot tests asserting on `<page-home>` for `/` need updating to `<page-index>`.
- Apps with both `pages/index.ts` AND `pages/home.ts` benefit automatically — the collision they didn't know they had is fixed.

### Tests Litro should add

In `packages/framework/test/path-to-route.test.ts` (or equivalent):

1. **`fileToComponentTag('pages/index.ts', 'pages')` returns `'page-index'`** (was `'page-home'`).
2. **`fileToComponentTag('pages/home.ts', 'pages')` returns `'page-home'`** (unchanged).
3. **No-collision invariant: `fileToComponentTag(a) === fileToComponentTag(b) ⟹ a === b`** across the standard fixture set (index, home, about, blog/index, blog/[slug], …).

## Companion patch hunks (deliverable shape)

The Caribou patch at `patches/@beatzball__litro@0.9.1.patch` ships both halves together as 6 `diff --git` hunks (4 new from this work + 2 pre-existing path-to-route Mastodon-URL hunks merged with the new index→index hunk):

```
src/adapter/elena/runtime/LitroLink.ts    — composite rewrite (Part 1)
dist/adapter/elena/runtime/LitroLink.js   — composite rewrite (Part 1)
src/plugins/path-to-route.ts              — fileToComponentTag special case (Part 2) + pre-existing Mastodon-URL fix
dist/plugins/path-to-route.js             — same
src/adapter/elena/index.ts                — DSD-emission (from PR #22; unchanged here)
dist/adapter/elena/index.js               — same
```

## Out of scope

- Polyfill for browsers that lack `composedPath` (well-supported in all browsers Litro targets).
- Auto-prefetch on hover. Composable later; keeps the wrapper simple for now.
- Adding the composite `<litro-link>` shape to Lit and FAST adapters as well. Their existing shadow+slot shape works for downstream consumers who don't nest links inside other shadow-DOM components; whether to migrate is a Litro maintainer call.
- Migrating the special case to read `static tagName` from the source class via TypeScript parsing — too complex for the value. The path-derivation rename gives 95% of the benefit at 5% of the cost.
