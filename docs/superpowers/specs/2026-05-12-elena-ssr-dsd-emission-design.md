---
title: Elena SSR adapter — DSD emission for shadow-DOM custom elements
date: 2026-05-12
status: approved, ready for implementation planning
parent-spec: docs/superpowers/specs/2026-04-24-caribou-plan-03-read-only-completeness-design.md
upstream-target: ~/w/beatzball/litro/packages/framework/src/adapter/elena/index.ts
---

# Elena SSR adapter — DSD emission for shadow-DOM custom elements

## 0. Goal

Fix the Litro Elena SSR adapter so it composes slotted children correctly. Today the adapter does flat-replacement recursive rendering for every custom element: it instantiates the host class, calls `render()`, and emits the rendered template as the host's light-DOM children — discarding the page's actual children and leaving a literal `<slot></slot>` that never composes anything. This breaks no-JS reads (`/local`, `/public`, `/home`, `/@me`, profile and thread routes) and produces a visible pre-hydration gap on every cross-route navigation.

After this work, shadow-DOM components are emitted as Declarative Shadow DOM (`<template shadowrootmode="open">`) with the host's original light-DOM children preserved, so the browser composes `<slot>` natively. Plan 3 §12.6's byte-equal hydration parity claim becomes operative in production, not just in the isolated `renderShadowComponentToString` helper.

## 1. Scope

In scope:

- Patch `packages/framework/src/adapter/elena/index.ts` in `@beatzball/litro@0.9.1` via `pnpm patch`, extending the existing `patches/@beatzball__litro@0.9.1.patch`.
- Add a Caribou integration test that boots the built production server and asserts the fixed SSR output shape on a representative set of routes.
- Brief upstream PRD captured in this repo (one short markdown file) describing the same change to land in Litro proper, so Caribou can drop the patch once Litro publishes.

Out of scope:

- Upstreaming the change into `@beatzball/litro` itself. Tracked as a follow-up; the PRD this work produces is the input to that upstream PR. Caribou bumps the dep and removes the patch when that lands.
- Refactoring or consolidating the adapter (Approach B in the brainstorm). The fix is intentionally minimal-diff for review safety and verbatim portability.
- Removing or restructuring `apps/caribou-elena/server/lib/render-shadow.ts`. The helper continues to serve byte-equal hydration parity tests; revisiting it is a separate decision after the upstream PRD lands.
- DSD polyfill or fallback for browsers that lack support. All Caribou-supported browsers (current Chromium, Firefox, Safari) implement DSD natively.

## 2. The bug, verified

Curling `http://localhost:4123/local` against `apps/caribou-elena/dist/server/server/index.mjs` (built from this worktree on 2026-05-12) returns:

```html
<page-local hydrated>
  <caribou-app-shell instance="" hydrated>
    <div class="shell-grid">
      <caribou-nav-rail hydrated><nav …>…</nav></caribou-nav-rail>
      <main><slot></slot></main>
      <caribou-right-rail hydrated><div class="card">…</div></caribou-right-rail>
    </div>
  </caribou-app-shell>
</page-local>
```

Failures:

- Zero `<template shadowrootmode>` markers anywhere in the response.
- Literal `<slot></slot>` element in the light DOM — never composes anything; nothing falls into it on first paint.
- `<caribou-auth-required>` (the page's slotted child for the unauthenticated `/local`) is absent. The `__litro_data__` JSON block correctly shows `kind: "auth-required"` so server-side `pageData()` ran; the loss happens in adapter HTML emission.
- The shell's render template (`<div class="shell-grid">…</div>`) is emitted as the host's light-DOM children rather than into a shadow root.

The same shape repeats for `/public`, `/home`, `/@me`, and profile routes — every page that wraps content in `<caribou-app-shell>`.

The behavior is produced by `expandNestedCEs` at `packages/framework/src/adapter/elena/index.ts:168-186`: it renders the host's template and returns `<${tag}${attrStr} hydrated>${expanded}</${tag}>` where `expanded` is the *render template*, dropping the original `childContent` and ignoring whether the component declared `static shadow`.

## 3. Architecture

One decision point: `expandNestedCEs` (and the symmetric page-entry path in `renderElenaPage`) branches on `ComponentClass.shadow`. Elena components signal shadow-DOM by setting `static shadow = 'open' | 'closed'`. Components without that field are light-DOM and keep their current emission shape unchanged.

### 3.1 Shadow-DOM emission

For a custom element whose registered class has `static shadow === 'open' | 'closed'`:

```html
<tag …attrs hydrated>
  <template shadowrootmode="{shadow}">
    <style id="caribou-dsd-style">{flattened static styles}</style>
    {expanded render-template}
  </template>
  {expanded original children}
</tag>
```

The render template is recursively expanded (nested custom elements inside the shadow get their own treatment) before being wrapped in the DSD `<template>`. The original children — what the page actually put between the host's opening and closing tags — are also recursively expanded and emitted verbatim as light-DOM children, where the browser composes them through whatever `<slot>` elements exist inside the DSD template.

`instance.innerHTML` is **not** set on shadow-DOM components. Slot composition is the contract; relying on `this.innerHTML` from a shadow-DOM render() is incoherent (the host's light-DOM children are slotted, not consumed as a string).

### 3.2 Light-DOM emission

Unchanged from today's adapter:

```html
<tag …attrs hydrated>{expanded render-template}</tag>
```

Original children are passed to the instance as `instance.innerHTML` before `render()` runs, so wrapper components that read `this.innerHTML` (e.g., `litro-card-grid`-style patterns) keep working. The render template replaces the original children in the emitted output, consistent with light-DOM components owning their own contents.

### 3.3 Style flattening

`static styles` is normalized via a small helper that mirrors the existing `apps/caribou-elena/server/lib/render-shadow.ts:74-81`:

- `null` / `undefined` → empty string
- `string` → as-is
- `(string | CSSStyleSheet)[]` → join string entries with `\n`, skip `CSSStyleSheet` entries (no constructable-stylesheet platform on the SSR side; Caribou authors styles as strings for exactly this reason)

The flattened result is always emitted inside `<style id="caribou-dsd-style">…</style>` as the first child of the `<template shadowrootmode>`, even when empty. The sentinel element is the contract checked by `apps/caribou-elena/pages/components/elena-shadow.ts:43-50` to suppress upstream's `adoptedStyleSheets` adoption path. Without the sentinel, Elena would adopt on top of the inline DSD styles and double-apply rules (and briefly run unstyled during the adoption window).

### 3.4 Recursion and re-entry

The existing `hydrated` attribute sentinel and the `depth > 10` guard are preserved. The shadow-DOM emission path still emits `hydrated` on the host so a subsequent pass won't try to re-expand it.

## 4. Files touched

- `~/w/beatzball/litro/packages/framework/src/adapter/elena/index.ts` (and its compiled `dist/adapter/elena/index.js`) — patched via `pnpm patch @beatzball/litro@0.9.1`. The patch extends the existing `patches/@beatzball__litro@0.9.1.patch` (currently containing only the `path-to-route` Mastodon URL fix).
- `patches/@beatzball__litro@0.9.1.patch` — regenerated by `pnpm patch-commit` after the in-place edit.
- `pnpm-workspace.yaml` — no change. The `patchedDependencies` entry already covers `@beatzball/litro@0.9.1`.
- `apps/caribou-elena/tests/integration/ssr-slot-composition.test.ts` — new integration test (see §6).

Files **not** touched:

- `apps/caribou-elena/server/lib/render-shadow.ts` — unchanged. Continues to serve byte-equal hydration parity tests.
- `apps/caribou-elena/pages/components/elena-shadow.ts` — unchanged. The sentinel contract it checks for is now the one the adapter emits, which is the same shape the helper already emits, so the runtime guard works against both code paths identically.
- Existing component sources. Shadow-DOM components keep `static shadow = 'open'`; light-DOM components keep omitting it.

## 5. Error handling and edge cases

- **`static shadow = 'closed'`** — emit `<template shadowrootmode="closed">`. Elena supports both modes; Caribou doesn't currently use `closed`, but the branch is trivial and keeping it general avoids a future trap.
- **No `static styles`** — still emit `<style id="caribou-dsd-style"></style>`. The sentinel's presence (not its content) is what `elena-shadow.ts` checks. Empty content is correct: there's nothing to adopt.
- **`render()` throws** — caught by the existing `try/catch` in `renderComponent`. For shadow-DOM hosts, emit `<tag …attrs hydrated><template shadowrootmode="…"><style id="caribou-dsd-style">{styles}</style></template>{children}</tag>` — host and children remain reachable; the shadow root is empty so the page degrades to slot-composed light DOM instead of going blank. The existing `console.warn` log line is preserved.
- **Unregistered tag** — left as-is (existing behavior). The page author sees the literal `<my-thing>…</my-thing>` in output; expected outcome for a missing registry entry.
- **Recursion depth > 10** — existing guard returns the html unchanged. Unaffected by this change.
- **Page-level entry (`renderElenaPage`)** — also branches on `static shadow`. Litro pages are conventionally light-DOM (the render template *is* the page body), so this is symmetry rather than a hot path, but the branch keeps the two emission sites consistent.

## 6. Testing

### 6.1 New: integration test against the production server

`apps/caribou-elena/tests/integration/ssr-slot-composition.test.ts` — Vitest integration test. Build via `pnpm --filter caribou-elena build` in `beforeAll` (or rely on a precondition that `dist/server/server/index.mjs` exists, with a clear error if not), spawn the server on a free port, curl a representative set of routes, kill the server in `afterAll`.

Per route assertions:

| Route            | Auth state         | Expected slotted child                       |
|---|---|---|
| `/local`         | unauthenticated    | `<caribou-auth-required>` inside the shell   |
| `/public`        | unauthenticated    | `<caribou-auth-required>` inside the shell   |
| `/home`          | unauthenticated    | `<caribou-auth-required>` inside the shell   |
| `/@me`           | unauthenticated    | `<caribou-auth-required>` inside the shell   |

For every route in the matrix:

1. The response contains at least one `<template shadowrootmode="open">` (the shell's DSD wrapper at minimum).
2. The response contains the route's expected slotted child element, structurally a light-DOM child of `<caribou-app-shell>`.
3. The response does **not** contain a literal `<slot></slot>` outside of a `<template shadowrootmode>`. (A `<slot>` inside the DSD template is correct and expected.)
4. The `__litro_data__` JSON block parses and has the expected `kind` for the route's auth state.

The matrix is intentionally focused on the unauthenticated paths — those have stable, deterministic SSR output (no Mastodon API roundtrip). Authenticated routes (`/home` with a signed-in cookie, `/local` with an active session, profile and thread routes resolving real handles) need fixture data or mocking and are deferred to a separate test pass.

### 6.2 Existing tests that should remain green

- `tests/integration/hydration-parity.test.ts` — exercises `renderShadowComponentToString` directly. Unaffected by this patch (different code path).
- `apps/caribou-elena/server/lib/__tests__/render-shadow.test.ts` — unit tests for the standalone helper. Unaffected.
- The full `pnpm test` and `pnpm -r build` matrix.

### 6.3 Manual smoke recipe

Documented inline in the implementation plan, not duplicated here:

```bash
pnpm --filter caribou-elena build
PORT=4123 node apps/caribou-elena/dist/server/server/index.mjs &
sleep 4
curl -s http://localhost:4123/local | grep -c 'shadowrootmode'     # > 0
curl -s http://localhost:4123/local | grep -oE '<slot[^>]*></slot>'  # only inside <template>
curl -s http://localhost:4123/local | grep -c 'caribou-auth-required'  # > 0
kill %1
```

## 7. Risks and mitigations

- **Other consumers of `@beatzball/litro` see different SSR output.** The patch lives in Caribou's `patches/`, so only Caribou is affected. Other Litro consumers continue to get the pre-fix adapter until the upstream PR lands.
- **Elena's hydration upgrade path mis-handles the new DSD shape.** Plan 3 §12.6 step 1 references `@elenajs/core/src/elena.js:267-275`, which checks `this.shadowRoot != null` and reuses the DSD-attached root rather than re-attaching. The adoption-suppression path is already wired in `elena-shadow.ts`. The shape this patch emits matches the shape `renderShadowComponentToString` emits, so the existing hydration-parity tests (which exercise the latter) cover the runtime contract.
- **Style flattening drops `CSSStyleSheet` entries.** Caribou's components author styles as strings, so this is a no-op in practice. If a future component uses constructable stylesheets in its `static styles`, the patch would silently drop them on SSR. Mitigation: the new integration test would surface this as a missing style in the rendered output. Long-term, the upstream PRD can either serialize `CSSStyleSheet.cssRules` or document the constraint.
- **Patch drift on Litro version bumps.** Bumping `@beatzball/litro` past `0.9.1` requires regenerating the patch against the new version. Mitigation: the upstream PRD is the exit. Once Litro publishes the fix, Caribou bumps the dep and drops the patch in one PR.

## 8. Upstream PRD (out of scope, but the deliverable)

After this patch validates in Caribou's production build, the same fix lands in `@beatzball/litro` upstream. A brief PRD captured at `docs/superpowers/specs/2026-05-12-elena-ssr-dsd-emission-upstream-prd.md` (drafted alongside the implementation plan, not part of this design) describes:

- The bug, in framework-agnostic terms (any Litro consumer using Elena's shadow-DOM mode has this).
- The proposed change to `packages/framework/src/adapter/elena/index.ts`.
- A standalone test (one to add inside Litro's own test suite) that exercises a minimal shadow-DOM custom element and asserts DSD + slot composition.
- A migration note for downstream consumers (none expected; the change is observable behavior in the right direction).

Once the upstream PR merges and a new Litro release is published, Caribou bumps the dep, removes the relevant hunk from `patches/@beatzball__litro@*.patch`, and updates `pnpm-workspace.yaml` if no patch hunks remain.
