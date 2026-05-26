---
"caribou-elena": patch
---

Wrap every shell `<a href>` (nav-rail Home/Local/Public/Profile, right-rail Privacy/About, auth-required Sign-in, per-route Retry, blog navigation) in a composite `<litro-link>`. Clicks now SPA-navigate via `LitroRouter.go(href)` instead of triggering full document reloads. The `<a>` stays in light DOM at each call site so link-hint extensions, screen readers, and keyboard focus traversal see anchors normally.

Also fixes a pre-existing tagName collision between `/` (landing) and `/home` (auth shell): Litro's path-to-route conversion used to map both `pages/index.ts` and `pages/home.ts` to `componentTag: 'page-home'` (via a special case `index → home`). Elena's `defineElement` is first-define-wins, so the silent collision bound both routes to whichever page module imported first. The Litro patch changes the special case to `index → index` so `pages/index.ts` derives `page-index` while `pages/home.ts` keeps `page-home`. `/` and `/home` now SSR distinct components and SPA-nav between them works.

Depends on a `pnpm patch` of `@beatzball/litro@0.9.1` that rewrites Elena's `LitroLink` to a composite (no-render / no-shadow) shape and tweaks `fileToComponentTag`. Upstream PRD at `docs/superpowers/specs/2026-05-25-litro-link-composite-upstream-prd.md`.

GitHub external link, signout POST form, and shadow-DOM component DSD emission from PR #22 are unchanged.
