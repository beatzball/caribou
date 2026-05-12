---
"caribou-elena": patch
---

Patch `@beatzball/litro@0.9.1` so the Elena SSR adapter emits Declarative Shadow DOM for shadow-DOM custom elements and preserves the host's original light-DOM children for native `<slot>` composition. Previously the adapter emitted the host's render template as light-DOM children and dropped the page's slotted content, leaving a literal `<slot></slot>` in the response and an empty pre-hydration shell on every cross-route navigation. The patch lives in `patches/@beatzball__litro@0.9.1.patch`; the same fix is queued for upstream submission (see `docs/superpowers/specs/2026-05-12-elena-ssr-dsd-emission-upstream-prd.md`).

User-visible: pre-hydration HTML for `/local`, `/public`, `/home`, `/@me`, profile, and thread routes now shows the route's actual content (or `<caribou-auth-required>` placeholder) instead of a bare shell. Plan 3 §12.6's byte-equal hydration parity guarantee becomes operative in production rather than just in the isolated helper.
