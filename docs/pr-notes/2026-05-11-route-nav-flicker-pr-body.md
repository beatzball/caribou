## Summary

Closes the cross-route navigation flicker (`/home → /local`) observed after the keyed-list reconciliation PR shipped. The four public-read routes — `/local`, `/public`, `/@user@host`, `/@user@host/[statusId]` — now SSR their populated `<ul><li>` status lists so the browser paints with content on first paint, instead of an empty timeline that pops in after JS hydration.

**Architecture:** a new `renderPopulatedListMount(items, opts)` helper in `apps/caribou-elena/server/lib/render-populated-list.ts` composes the mount's declarative-shadow-DOM HTML, calling the existing `renderShadowComponentToString` once per card. Each page's `pageData()` captures `serverNowMs` and pre-renders the helper output; `render()` embeds it via `unsafeHTML(...)`. Server-now is threaded through `data-rendered-at` so cards' first client render is byte-equal to SSR — the keyed reconciler then finds the cards by `data-key` on hydration and reconciles in place with zero structural ops.

**`/home` is explicitly out of scope** — auth-required + Plan 3 §11 privacy property = SSR can't fetch the user's token-gated timeline. The home-timeline pop-in remains by design.

Spec: `docs/superpowers/specs/2026-05-11-caribou-route-nav-flicker-design.md`
Plan: `docs/superpowers/plans/2026-05-11-caribou-route-nav-flicker.md`

## Test plan

- [x] `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build` green.
- [x] New helper unit tests in `server/lib/__tests__/render-populated-list.test.ts` cover empty, N items, depth, mixed variants, byte-equality, and sanitization.
- [x] Extended hydration-parity tests cover cards with status data via the new `{ attrs, props }` form and helper byte-equality.
- [x] Per-route SSR integration tests assert each route's `pageData()` returns HTML containing `<li data-key>` markers per status.
- [x] `<caribou-status-card>` now-resolution unit test pins first-render-uses-dataset, subsequent-render-uses-Date.now.
- [ ] **Manual smoke (user — required before merge):** `pnpm --filter caribou-elena dev:portless`, sign in to a real Mastodon instance, navigate `/home → /local` and `/local → /public` and `/local → /@user@host` and back. Confirm the destination pages paint with populated cards on first frame; only `/home` should still show the timeline pop-in (by design).

## Out of scope (called out so reviewers know)

- No `/home` flicker fix — privacy-property constraint.
- No Elk-style default-instance redirect for signed-out users — captured for follow-up brainstorm.
- No SPA routing — Plan 3 §10 design call stands.
- No periodic timestamp text updates on idle cards (the "5m ago" text remains static until the card's status is reassigned).
- No non-DSD-browser fallback — Plan 3 already accepted DSD-or-empty.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
