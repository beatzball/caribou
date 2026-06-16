---
"caribou-elena": patch
---

The profile route (`/@handle`) now SSR-paints the header and status cards instead of flashing "Loading…". `<caribou-profile>` falls back to its `initial` data at SSR (when `connectedCallback` is skipped), seeds `<caribou-list-mount>` with pre-rendered `<li data-key>` children carrying `variant="timeline"` + `data-status-id` (matching the keyed reconciler's `create()` output, so hydration rebinds in place rather than rebuilding), and hands the account to `<caribou-profile-header>` via a string `account` attribute the header parses itself.

`<caribou-profile-header>` gates `DOMPurify.sanitize` behind `typeof window !== 'undefined'` (the SSR shim has no `window`); `pages/@[handle].ts` pre-sanitizes both `status.content` and `account.note` at the data boundary via the jsdom-backed server sanitizer. The header's `account` prop is now string-typed (it parses the JSON itself, mirroring `<caribou-list-mount>`'s `items`) so Elena doesn't auto-`JSON.parse` an attribute slot that momentarily holds a template marker.

`_render-status-li.ts` is generalized with `{ variant, statusId }` options; the default (no options) output is byte-identical, so `<caribou-timeline>` is unchanged. Follows the PR #25 playbook; thread (`/@handle/[statusId]`) SSR-paint remains a follow-up.
