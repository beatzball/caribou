---
title: Upstream PRD — Elena SSR adapter DSD emission for shadow-DOM components
date: 2026-05-12
status: ready to hand to upstream
target-repo: ~/w/beatzball/litro
target-file: packages/framework/src/adapter/elena/index.ts
companion-patch: ~/w/beatzball/caribou/patches/@beatzball__litro@0.9.1.patch (hunks for adapter/elena)
verified-by: ~/w/beatzball/caribou/apps/caribou-elena/tests/integration/ssr-slot-composition.test.ts
---

# Elena SSR adapter — DSD emission for shadow-DOM custom elements (upstream PRD)

## Problem

The Elena framework adapter's SSR pipeline currently does flat-replacement recursive rendering for every custom element it encounters. For shadow-DOM components (`static shadow = 'open' | 'closed'`), this:

- Emits the host's render template as the host's light-DOM children.
- Discards the page's original children (the actual slotted content).
- Leaves a literal `<slot></slot>` element in the light DOM that the browser cannot compose.

The visible result: any page that wraps content in a shadow-DOM shell component renders an empty shell pre-hydration. Post-hydration the client's morph fixes it, so the bug is invisible in JS-enabled browsers — but no-JS readers see only the shell, and cross-route navigations show a brief flicker as the wrong DOM is replaced.

Affected adapter: `packages/framework/src/adapter/elena/index.ts`, functions `expandNestedCEs` and `renderElenaPage`.

## Reproduction

Any Litro app that mounts a shadow-DOM Elena component as a wrapper exhibits this. Caribou's reproduction (smallest end-to-end):

1. Define a shadow-DOM component with a `<slot>` in its render template:

```ts
class AppShell extends Elena(HTMLElement) {
  static tagName = 'app-shell'
  static shadow = 'open' as const
  static styles = `:host { display: block; } main { padding: 1rem; }`
  render() { return html`<main><slot></slot></main>` }
}
AppShell.define()
```

2. Define a page that renders the shell with a child:

```ts
render() { return html`<app-shell><p>hello</p></app-shell>` }
```

3. Curl the route. Expected (after fix):

```html
<app-shell hydrated>
  <template shadowrootmode="open">
    <style id="caribou-dsd-style">:host { display: block; } main { padding: 1rem; }</style>
    <main><slot></slot></main>
  </template>
  <p>hello</p>
</app-shell>
```

Actual (today):

```html
<app-shell hydrated><main><slot></slot></main></app-shell>
```

## Proposed change

Branch `expandNestedCEs` and `renderElenaPage` on `ComponentClass.shadow`.

**Shadow-DOM emission** (`shadow === 'open' | 'closed'`):

```
<tag attrs hydrated>
  <template shadowrootmode="{shadow}">
    <style id="caribou-dsd-style">{flattened static styles}</style>
    {expanded render template}
  </template>
  {expanded original children}
</tag>
```

Original children are passed through recursive CE expansion and emitted as light-DOM children. `instance.innerHTML` is **not** set — slot composition is the contract; reading `this.innerHTML` from a shadow render() is incoherent.

**Light-DOM emission** (no `shadow`): unchanged from today's code path. Original children are passed as `instance.innerHTML` for wrapper components; render template replaces children in output.

**Style flattening**: `static styles` accepts `string | string[] | (string | CSSStyleSheet)[]`. Strings join with `\n`; `CSSStyleSheet` entries are dropped (no constructable-stylesheet platform server-side). Always emit `<style id="caribou-dsd-style">…</style>` even when empty — the sentinel id is the contract for downstream adoption-suppression bases.

**Sentinel constant**: `DSD_SENTINEL_STYLE_ID = 'caribou-dsd-style'`. The literal `caribou-` prefix is a contract chosen by downstream Caribou. If a different name fits Litro's neutrality posture, use `litro-dsd-style` or expose it as configurable via `FrameworkAdapter`. The Caribou patch can adjust on rebase.

## Concrete patch

See the Caribou patch hunks at `patches/@beatzball__litro@0.9.1.patch` (the `adapter/elena/index.{js,ts}` hunks). The change is ~60 lines added to `index.ts` plus the corresponding `dist/` regeneration.

## Tests Litro should add

A minimal unit test inside `packages/framework/test/` (or wherever the adapter tests live) covering:

1. **Light-DOM component**: `expandNestedCEs` of `<my-light><p>x</p></my-light>` where `MyLight` has no `static shadow` produces `<my-light hydrated>{render-output}</my-light>` (existing behavior).
2. **Shadow-DOM component, no styles**: `expandNestedCEs` of `<my-shell><p>x</p></my-shell>` where `MyShell` has `static shadow = 'open'` and no `static styles` produces `<my-shell hydrated><template shadowrootmode="open"><style id="caribou-dsd-style"></style>{render-output}</template><p>x</p></my-shell>`.
3. **Shadow-DOM component with array styles**: same as (2) but with `static styles = ['a { }', 'b { }']` produces `<style id="caribou-dsd-style">a { }\nb { }</style>`.
4. **Closed shadow**: `static shadow = 'closed'` produces `shadowrootmode="closed"`.
5. **Render throws**: shadow-DOM host still emits its tag + empty DSD template + original children (graceful degradation).
6. **Recursion guard**: deeply nested CEs stop expanding at depth 10 (existing).

## Migration notes for downstream consumers

The change is observable in the right direction. Consumers see:

- `<template shadowrootmode>` markers appear in SSR output for shadow-DOM components.
- Slotted children now compose natively pre-hydration (previously broken).
- Light-DOM components: byte-identical output to before.

No consumer code should need to change. Snapshot tests that assert on the literal pre-fix HTML shape (`<my-shell>{render-template}</my-shell>` with no children) will need updating — these tests were asserting on the bug.

## Browser compatibility

DSD is supported natively in Chromium 90+, Safari 16.4+, Firefox 123+ (all current at the time of this PRD). For consumers targeting older browsers, a small polyfill (the `<template>` walker described in the WHATWG proposal) is well-documented; Litro's `getHeadScripts` could expose an opt-in flag (`needsDSDPolyfill`) — currently set to `false` on Elena's adapter.

## Out of scope (for this upstream PR)

- The `caribou-dsd-style` literal sentinel id — adjustable per maintainer preference.
- Refactoring the adapter's internal helpers (`renderComponent`, `expandNestedCEs`) into a cleaner shape. The fix is intentionally minimal-diff for review safety.
- DSD polyfill emission. The adapter's `needsDSDPolyfill: false` flag stays as-is.
