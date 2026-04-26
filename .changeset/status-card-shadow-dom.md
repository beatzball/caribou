---
'caribou-elena': patch
---

Move `caribou-status-card` to shadow DOM and harden avatar loading.

`static shadow = 'open'` walls the rendered article off from the parent timeline's morph engine. The bug we fixed by hand in PR #13 (parent re-render → Elena's `morphContent` recurses into the card's light DOM → wipes the rendered tree → avatars re-fetch and flicker) becomes structurally impossible — `parent.childNodes` only sees light DOM, and the platform's tree model never crosses a shadow boundary. CSS custom properties (`var(--bg-0)` etc.) inherit through shadow boundaries, so the design tokens still apply.

Three companion improvements while we're touching the `<img>`:

- `loading="lazy" decoding="async"` so off-screen avatars don't fetch on initial render — long timelines feel materially faster.
- One-shot `error` listener that retries the avatar twice (300ms / 600ms backoff) when a transient `ERR_CONNECTION_CLOSED` truncates the response, then dims the slot if it still fails. Resets the retry budget when the URL changes.
- The `.status-content` wrap rules that used to live in `tokens.css` are now adopted onto the shadow root via Elena's `static styles`, since global CSS no longer reaches inside.

Side effects in `caribou-home-timeline`: dropped the `card.children.length === 0` recovery branch from `updated()`. With shadow DOM the card never has light-DOM children, so that branch was always-true and would have triggered an unnecessary re-render every time the timeline updated. Banner fallback retained — the banner is still a light-DOM component.

The `landing.spec.ts` "submitting the picker" test gained a `waitForFunction(() => mains === 1)` guard before the form interaction, matching what the banner test already had — the Litro double-mount race surfaces much more readily on Firefox than Chromium.
