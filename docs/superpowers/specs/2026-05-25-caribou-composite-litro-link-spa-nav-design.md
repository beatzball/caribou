---
title: Caribou shell SPA nav via composite `<litro-link>`
date: 2026-05-25
status: approved, ready for implementation planning
parent-spec: docs/superpowers/specs/2026-04-24-caribou-plan-03-read-only-completeness-design.md
supersedes: docs/superpowers/specs/2026-05-12-litro-link-shadow-slot-nav-fix-design.md (phase-4.2; never merged)
prereq: PR #22 (DSD-emission Elena SSR adapter fix; on `main`)
companion-prd-target: ~/w/beatzball/litro/packages/framework/src/adapter/elena/runtime/LitroLink.ts
---

# Caribou shell SPA nav via composite `<litro-link>`

## 0. Goal

Every shell-link click in Caribou (nav-rail Home/Local/Public/Profile, right-rail Privacy/About, auth-required Sign-in, per-route Retry, blog links) navigates via `LitroRouter.go(href)` instead of triggering a full document reload. Anchors stay plain `<a href>` so browser-native affordances (Vimium-style link hinting, screen-reader link enumeration, tab focus, right-click "Open in new tab") all work without surprises.

## 1. Why a fresh approach

Phase-4.2 (branch `phase-4.2`, unmerged) attempted to swap `<a>` for shadow-DOM `<litro-link>` with `<slot>` inside `<a>` — matching the FAST adapter. End-to-end tests passed but two real issues showed up during manual validation:

1. **Vimium and similar link enumeration tools can't see the nav-rail anchors.** The `<a>` was two shadow boundaries deep — inside `<litro-link>`'s shadow, which is itself inside `<caribou-nav-rail>`'s shadow. The signout `<button>` works (one boundary, in nav-rail's shadow directly); the auth-required Sign-in works (one boundary, since `<caribou-auth-required>` is light-DOM). Nav-rail and right-rail anchors are blind to tools that walk a single shadow boundary. This is structural — Lit's `<litro-link>` and FAST's `<litro-link>` have the same shape, so switching adapters wouldn't help.
2. **SPA nav from `/home` to `/` blanks the outlet.** Pre-existing `home.ts` / `index.ts` collision on `static tagName = 'page-home'`; Elena's `defineElement` is first-define-wins (`reg.get(tagName) || reg.define(tagName, Element)`). Initial page loads work because the client's first-imported page module wins per route, but SPA nav across routes that share a colliding tagName breaks. PR #22 + phase-4.2 made this visible by completing SSR; pre-fix the SSR was broken enough that the symptom was masked.

The Composite shape solves (1) by keeping `<a>` in light DOM at the call site — same scope as the `<button>` Vimium already finds — while still giving us a per-link SPA-nav opt-in marker. (2) is fixed by giving `pages/index.ts` a distinct tagName.

## 2. Scope

In scope:

- Replace the Elena `LitroLink` upstream with a composite (no-render / no-shadow) click-intercepting wrapper. Delivered via `pnpm patch @beatzball/litro@0.9.1` (extending the same `patches/@beatzball__litro@0.9.1.patch` that already carries PR #22's DSD-emission hunks and the pre-existing path-to-route hunks).
- Wrap nine plain `<a href>` in five Caribou shell files + ~5 blog-page anchors with `<litro-link>`. CSS keeps targeting `<a>` (no retargeting); add a single `litro-link { display: contents }` rule per consumer's shadow CSS so the wrapper is layout-invisible.
- Rename `pages/index.ts`'s tagName from `page-home` to `page-index` to fix the SPA-nav collision.
- New unit test for composite `LitroLink` behavior. Update existing component tests to query inner `<a>` (essentially reverting to pre-phase-4.2 shape with `<litro-link>` wrapper). Update PR #22's SSR integration test assertion to match the new shape.
- One-page upstream PRD describing the Composite rewrite. The phase-4.2 PRD (which described shadow+slot) is superseded.

Out of scope:

- Reverting PR #22's adapter changes. Those are correct and remain in place — shadow-DOM components (`caribou-app-shell`, etc.) still DSD-emit correctly.
- Migrating away from web components entirely.
- Auto-prefetch / route preloading / scroll restoration polish beyond what `LitroRouter` already does.

## 3. The Composite `<litro-link>`

### 3.1 Upstream shape

`packages/framework/src/adapter/elena/runtime/LitroLink.{ts,js}` becomes:

```ts
import { Elena } from '@elenajs/core';

export class LitroLink extends Elena(HTMLElement) {
  static tagName = 'litro-link';
  // No shadow, no styles, no props, no render() — this element wraps an
  // author-supplied <a> and intercepts clicks. Children pass through.

  private _clickHandler = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.defaultPrevented) return;

    const path = e.composedPath();
    let anchor: HTMLAnchorElement | undefined;
    for (const node of path) {
      if (node === this) break;
      if (node instanceof HTMLAnchorElement) { anchor = node; break; }
    }
    if (!anchor) return;
    if (anchor.target) return;
    const href = anchor.getAttribute('href');
    if (!href || !href.startsWith('/')) return;

    e.preventDefault();
    void import('@beatzball/litro-router').then(({ LitroRouter }) =>
      LitroRouter.go(href),
    );
  };

  override connectedCallback(): void {
    this.addEventListener('click', this._clickHandler, true);
    if (typeof super.connectedCallback === 'function') super.connectedCallback();
  }
  override disconnectedCallback(): void {
    this.removeEventListener('click', this._clickHandler, true);
    if (typeof super.disconnectedCallback === 'function') super.disconnectedCallback();
  }
}
LitroLink.define();
```

Elena's `_applyRender` no-ops when `render()` returns undefined (it checks for a TemplateResult shape — see `@elenajs/core/dist/elena.js` and the `LitroOutlet` precedent which is also a composite-no-render Elena component).

### 3.2 Click-handler semantics

- **Button check** — only intercept main-button clicks (`button === 0`). Middle-click for new-tab, right-click for context menu both pass through.
- **Modifier check** — Cmd/Ctrl/Shift/Alt clicks pass through so the browser's native "open in new tab/window" gestures work.
- **`defaultPrevented` check** — any prior listener that already handled the click is respected.
- **composedPath search** — finds the first `<a>` between the actual click target and the `<litro-link>` host, regardless of how deep in shadow DOM the click landed. Anchors *outside* the host (above it in the ancestor chain) are ignored.
- **`target` attribute check** — links with `target="_blank"`, `target="_self"`, etc. pass through. External-target intent is respected.
- **`href` shape** — only intercepts when href starts with `/`. Skips `http://`, `https://`, `mailto:`, `#fragment`, `javascript:`, protocol-relative `//host`, and bare relative paths.

### 3.3 Server-side: pass-through

The SSR adapter (post-PR-#22) handles unregistered custom-element tags by returning them verbatim. We deliberately *do not* register `LitroLink` server-side — the composite shape has nothing to render, so pass-through is the correct behavior. SSR output for `<litro-link><a href="/foo">Foo</a></litro-link>` is the exact same string, unchanged.

**No `manifestPreamble` change is needed** (this differs from phase-4.2, which needed it to register the shadow-DOM `<litro-link>` for DSD wrapping). Drop the phase-4.2 manifestPreamble runtime-registration concept entirely.

## 4. Caribou shell adoption

### 4.1 Markup

Wrap each existing `<a href>` with `<litro-link>`. Concrete shapes per file:

**`apps/caribou-elena/pages/components/caribou-nav-rail.ts`** (4 anchors, lines ~68-72 of current source):

```ts
return isActive
  ? html`<litro-link><a href="${it.href}" aria-current="page"><span class="icon">${it.icon}</span><span class="label">${it.label}</span></a></litro-link>`
  : html`<litro-link><a href="${it.href}"><span class="icon">${it.icon}</span><span class="label">${it.label}</span></a></litro-link>`
```

**`apps/caribou-elena/pages/components/caribou-right-rail.ts`** (2 anchors — Privacy/About; GitHub external stays plain):

```ts
<li><litro-link><a href="/privacy">Privacy</a></litro-link></li>
<li><litro-link><a href="/about">About</a></litro-link></li>
```

**`apps/caribou-elena/pages/components/caribou-auth-required.ts`** (1 anchor):

```ts
<litro-link><a href="/" class="text-accent underline">Sign in</a></litro-link>
```

**`apps/caribou-elena/pages/local.ts`** + **`apps/caribou-elena/pages/public.ts`** (1 anchor each):

```ts
<litro-link><a href="/local" class="text-accent underline">Retry</a></litro-link>
```

**`apps/caribou-elena/pages/blog/index.ts`** + **`pages/blog/[slug].ts`**: update existing text-only `<litro-link href="…">text</litro-link>` to `<litro-link><a href="…">text</a></litro-link>`. ~5 places total.

Signout `<form action="/api/signout" method="post">` and the GitHub external link `<a href="${REPO_URL}" target="_blank" rel="noopener">` are unchanged.

### 4.2 CSS

Selectors keep targeting `<a>` (no retargeting from phase-4.2). One rule per consuming shadow component:

```css
litro-link { display: contents; }
```

This makes the wrapper layout-invisible — the inner `<a>` flows in the parent's tree as if `<litro-link>` weren't there. Existing `a { … }`, `a:hover`, `a[aria-current="page"]` rules all apply unchanged. No `.row` wrapper, no responsive media-query retargeting.

For light-DOM consumers (`caribou-auth-required`, retry links): no CSS change needed. `<litro-link>` defaults to inline display; `<a>` is inline; both flow inline. Adding `display: contents` via a global rule would be belt-and-braces but not required for the visual to be correct.

## 5. tagName collision fix

`apps/caribou-elena/pages/index.ts` (one-line edit):

```ts
static override tagName = 'page-index'  // was 'page-home'
```

Litro's page scanner reads `static tagName` from the source file (see `routes.generated.ts` and `server/stubs/page-manifest.ts` for how `componentTag` flows through). On next build:

- `routes.generated.ts` `/` route → `component: "page-index"` (was `"page-home"`)
- `server/stubs/page-manifest.ts` regenerates accordingly

Now `/` and `/home` use distinct component tags. Each page module's class registers under its own tagName. SPA nav between them creates the right element class for each route. Both `/` (landing) and `/home` (shell + auth-required) work in SSR and via SPA nav, server-side and client-side, consistently.

The `pages/home.ts` `static override tagName = 'page-home'` is unchanged.

### 5.1 Why `page-index` for `/`

`page-index` describes what the route actually renders (`<caribou-landing>`). `page-home` is reserved for the authenticated-home shell at `/home`. Naming the route-element after its semantic content rather than its URL avoids future collisions if `/home` and `/landing` ever diverge further.

## 6. Patch surface

`patches/@beatzball__litro@0.9.1.patch` after this work contains exactly 6 hunks:

```
dist/adapter/elena/index.js              (from PR #22 — DSD emission; unchanged)
dist/adapter/elena/runtime/LitroLink.js  (new — composite rewrite)
dist/plugins/path-to-route.js            (pre-existing — Mastodon URL routing)
src/adapter/elena/index.ts               (from PR #22 — DSD emission; unchanged)
src/adapter/elena/runtime/LitroLink.ts   (new — composite rewrite)
src/plugins/path-to-route.ts             (pre-existing — Mastodon URL routing)
```

Notable absence: no `manifestPreamble` extension. The phase-4.2 attempt needed it because shadow-DOM `<litro-link>` had to be registered server-side for DSD wrapping. Composite `<litro-link>` doesn't need server-side registration.

## 7. Testing

### 7.1 New unit test — `apps/caribou-elena/pages/components/__tests__/litro-link.test.ts`

Programmatic click dispatch against `<litro-link><a href="/foo">x</a></litro-link>`:

1. Click on the inner `<a>` → asserts `LitroRouter.go` was called with `/foo`.
2. Click on the `<litro-link>` host but outside any `<a>` → asserts `LitroRouter.go` was NOT called.
3. Click with `metaKey: true` → not called.
4. Click on inner `<a target="_blank">` → not called.
5. Click on inner `<a href="https://external.example/">` → not called.
6. Click on inner `<a href="#fragment">` → not called.
7. Click with `event.preventDefault()` already called by prior listener → not called.

Mock `import('@beatzball/litro-router')` to capture the call without hitting actual router state.

### 7.2 Component tests — revert to pre-phase-4.2 shape

`caribou-nav-rail.test.ts`, `caribou-right-rail.test.ts`, `caribou-auth-required.test.ts`:

Queries target inner `<a href="…">` (same as `main` pre-phase-4.2). Add one assertion per test that the `<a>` is enclosed in a `<litro-link>` parent — verifies SPA-nav opt-in is in place. Sign-out POST form, light-DOM-no-shadowRoot tests stay unchanged.

### 7.3 SSR integration test — `ssr-slot-composition.test.ts` from PR #22

Update the new "emits `<litro-link hydrated>` with DSD shape" assertion (added in phase-4.2) to instead assert that every internal-link `<a>` inside the shell sits within a `<litro-link>` wrapper. Specifically per route:

```ts
it('every shell <a href="/…"> is wrapped in <litro-link>', () => {
  // Strip DSD templates (shell components' shadow content).
  const lightDOM = stripDSDTemplates(body)
  const anchors = [...lightDOM.matchAll(/<a\s[^>]*href="\/[^"#][^"]*"[^>]*>/g)]
  expect(anchors.length).toBeGreaterThan(0)
  for (const m of anchors) {
    // Walk back from the anchor's position to confirm a <litro-link> opener
    // appears within the immediately surrounding ~200 chars without an
    // intervening close-tag.
    const before = lightDOM.slice(Math.max(0, m.index - 200), m.index)
    expect(before).toMatch(/<litro-link\b[^>]*>(?:(?!<\/litro-link>)[\s\S])*$/)
  }
})
```

The other 4 assertions per route (DSD presence, slotted child, no leaked `<slot>`, `__litro_data__.kind`) are kept verbatim — they validate PR #22's invariants that are still in force.

### 7.4 Full matrix

`pnpm -r test`, `pnpm -r typecheck`, `pnpm -r build`, `pnpm --filter caribou-elena exec playwright test --project=chromium`. The Playwright suite passes against `main` already and isn't affected by the markup change beyond exercising the SPA nav passively.

### 7.5 Manual verification

- Click each shell link in a real browser; confirm no `unload`/`load` event sequence (DevTools Network panel), URL updates, content swaps in place, no scroll jump.
- Open Vimium (or browser-native link-hint extension) on each route; confirm nav-rail, right-rail, and auth-required anchors get hints, same as the signout button.
- Click sign-in on `/home`; confirm `/` renders `<caribou-landing>` (the picker), NOT the auth-required placeholder.
- Tab through `/local` page; confirm focus visits each shell link.

## 8. Risks and non-issues

- **`<litro-link>` flows inline in unstyled consumers.** With no `display: contents` rule, the wrapper is `display: inline` (custom element default). Inside an inline-flow context (text-only links in auth-required, retry blurbs, blog body) that's correct. Inside flex/grid contexts (nav-rail's `nav` flex column, right-rail's `.links` list) the wrapper would become a flex/grid item itself, which is wrong — hence the per-consumer `display: contents` rule.
- **`composedPath` ordering.** The path runs from event target outward. We search for the first `<a>` *before* hitting `<litro-link>` so we only intercept anchors strictly inside our subtree. An `<a>` ancestor that contains `<litro-link>` would be a malformed DOM (anchors can't nest), so the guard handles malformation safely.
- **`download` attribute.** A `<a href="/file" download>` would currently be intercepted (we don't check `download`). Caribou doesn't ship download links in shell components today; adding `if (anchor.hasAttribute('download')) return;` to the handler is trivial if a future link needs it. Not needed for this PR.
- **`<litro-link>` inside an external-target `<a>`.** Malformed (`<a>` can't contain another link wrapper meaningfully); composedPath would find the outer `<a>` first. Same defensive guard as malformed nesting — handler bails on `target` attribute.

## 9. Upstream PRD

After Caribou validates the patch, a short PRD at `docs/superpowers/specs/2026-05-25-litro-link-composite-upstream-prd.md` describes the same Composite rewrite for upstream submission. The PRD covers:

- Bug shape (deep-shadow `<a>` invisible to link enumeration tools).
- Composite alternative — code and rationale.
- Migration note for downstream consumers using text-only `<litro-link href="…">text</litro-link>`: they must wrap text in `<a>` (`<litro-link><a href="…">text</a></litro-link>`).
- One-paragraph footnote on the phase-4.2 shadow+slot attempt and why it was reverted (Vimium / link-hint blindness).

Once Litro publishes a release with the Composite shape, Caribou bumps the dep and drops the LitroLink hunks from `patches/@beatzball__litro@0.9.1.patch`.

## 10. What this supersedes

This spec supersedes `docs/superpowers/specs/2026-05-12-litro-link-shadow-slot-nav-fix-design.md` (phase-4.2). The phase-4.2 branch is parked unmerged for reference; the lessons are folded into §1 above. No part of phase-4.2 is reused.
