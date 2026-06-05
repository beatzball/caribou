---
"caribou-elena": patch
---

`<caribou-list-mount>` moves into caribou-elena as an Elena component (`shadow: 'open'`, DSD-aware). It accepts an `items` attribute that `unsafeHTML`-injects pre-rendered `<li data-key>` children into the shadow `<ul>`. The previous behavior (empty shadow UL populated only by the imperative reconciler) is preserved on the client; the new SSR path emits the full populated list so first paint of `/local` and `/public` shows cards instead of an empty structural shell.

`<caribou-timeline>` now serializes its SSR-known statuses via a new `_render-status-li.ts` helper and passes the result through `items`. The keyed reconciler's existing SSR-emitted-children contract picks up the `<li data-key>` children on hydration and rebinds `card.status` per item (one reassignment per card on first paint; steady-state polls remain no-ops, preserving the avatar-no-refetch invariant).

`<caribou-status-card>`'s render path now gates `DOMPurify.sanitize` behind `typeof window !== 'undefined'` — the SSR shim has no `window`, so the card trusts content the server pre-sanitized at the boundary (in `pages/local.ts` and `pages/public.ts`'s pageData fetchers, via a jsdom-backed sanitize). Client-side re-sanitizes as defense-in-depth for poll-fetched content that arrives via the browser-side masto.js, not the server.

`<caribou-profile>` and `<caribou-thread>` still render an empty `<caribou-list-mount>` and populate it imperatively via the reconciler on client hydration. Their SSR-paint flash fix lands in follow-up PRs (richer `<li>` shapes — profile carries variant/data-status-id; thread carries data-depth + tree ordering — need their own serializers).

Plan 3 Exit Criterion #8 (no-JS smoke test sees cards on `/local`) now passes in the spirit, not just the letter. Verified via a new `tests/e2e/no-js-public-timeline.spec.ts` (skipped in CI per the upstream-network policy).
