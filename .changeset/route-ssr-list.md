---
"caribou-elena": patch
---

SSR public-read route status lists. `/local`, `/public`, `/@user@host`, and `/@user@host/[statusId]` now pre-render their populated `<caribou-list-mount>` server-side via a new `renderPopulatedListMount` helper. Hosts paint with cards on first paint instead of an empty timeline that pops in after JS hydration — closes the cross-route flicker observed on `/home → /local`.

Plumbs `serverNowMs` through `pageData → data-rendered-at attribute → <caribou-status-card>.render()` so the first client-side render reproduces the SSR timestamp byte-for-byte. The keyed reconciler's first call after hydration finds existing `data-key` markers and reconciles in place with zero structural DOM ops.

`/home` remains lazy by design — Plan 3 §11's privacy property prevents the server from receiving the user's access token.
