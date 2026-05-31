---
"caribou-elena": patch
---

Fix the signout-state inversion bug and the post-signout UX. Before: clicking sign out cleared the `caribou.instance` cookie (server-side) but left `localStorage.caribou.activeUserKey` untouched (client-side); the page didn't refresh; the right-rail kept showing "Signed in to fosstodon.org · Sign out". Result was inverted from intent — `/local` and `/public` showed auth-required (cookie gone) while `/home` and `/@me` still rendered real content (stale localStorage swap), and the shell chrome lied about session state.

- Server (`server/routes/api/signout.post.ts`) no longer calls `clearInstance`. The `caribou.instance` cookie is a non-sensitive hostname preference and persists across sessions, so `/local` and `/public` keep working post-signout.
- New `<caribou-signout-form>` composite wrapper (light-DOM, no render, no shadow — same shape as `<litro-link>`) preventDefaults the native POST, calls `removeActiveUser()` from `@beatzball/caribou-state`, fires `/api/signout` via fetch, then `location.replace('/')` so the user lands on the landing/picker with a clean SSR render — no stale timeline or signed-in chrome left in the DOM. Wired into both nav-rail and right-rail signout forms.
- Both shell rails now subscribe to the `activeUserKey` signal on connect and reflect a `signed-out` attribute on the host. Shadow CSS gates the visible chrome: nav-rail hides `<caribou-signout-form>`; right-rail swaps "Signed in to X · Sign out" for a passive "Browsing X" label. SSR default is the signed-in chrome (the common case for users with the cookie); hydration may downgrade.
- New `base-head.ts` injects a global `litro-link { display: contents }` rule into every SSR'd page's `<head>`, removing the per-consumer footgun where light-DOM consumers (auth-required, retry, blog) silently lacked the layout-invisible declaration that shadow-DOM consumers had inline.

E2E covers the post-signout state: cookie persists, localStorage cleared, browser lands on `/`.
