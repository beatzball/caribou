---
'caribou-elena': patch
'@beatzball/caribou-auth': patch
---

Fix two regressions in the feed experience:

1. **Timeline wiped to "N new posts" button on poll** — when `poll()` surfaced new statuses via `home?since_id=...`, the timeline re-render ran Elena's `morphContent` over each `<caribou-status-card>`'s light-DOM children, stripping the rendered `<article>` because the parent's template treats the card tag as empty. The card instance's `status` prop was still the same cached reference, so Elena's setter short-circuited on `===` and never re-rendered to restore the DOM. `caribou-home-timeline` now calls `requestUpdate()` on each child whose light DOM was emptied by the parent morph. Same treatment for `caribou-new-posts-banner`.

2. **Can't switch accounts on the same Mastodon instance** — `buildAuthorizeUrl` didn't set `force_login`, so signing out of Caribou (which correctly clears local state) and then re-entering the same domain sent the user to a Mastodon `/oauth/authorize` that silently auto-redirected back with a token for the already-active Mastodon session. Now sets `force_login=true` so Mastodon always shows the login/account picker.
