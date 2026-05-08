---
'caribou-elena': patch
---

Fix `/@me` to render the signed-in user's own profile.

The route was running `fetchAccountByHandle('me', …)` server-side against
the public Mastodon lookup endpoint, which 404s — landing the page in the
catch branch's "Couldn't load profile @me." stub. `/@me` is auth-required
per the Plan 3 design (§8.8): the access token lives only in localStorage,
so the server must never resolve it. Treat `handle === 'me'` as
auth-required server-side (no public lookup), then on client mount swap
the placeholder for `<caribou-profile handle="<userKey>">` using the
active userKey from localStorage. Mirrors `HomePage.maybeSwapToTimeline`.

Test: `handle.test.ts` asserts `/@me` returns auth-required and never
calls the public lookup, even when the instance cookie is set.
