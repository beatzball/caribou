---
"caribou-elena": patch
---

Fix the signout-state inversion bug. Before: clicking sign out cleared the `caribou.instance` cookie (server-side) but left `localStorage.caribou.activeUserKey` untouched (client-side). Result was inverted from intent — `/local` and `/public` showed auth-required (cookie gone) while `/home` and `/@me` still rendered real content (stale localStorage swap).

- Server (`server/routes/api/signout.post.ts`) no longer calls `clearInstance`. The `caribou.instance` cookie is a non-sensitive hostname preference and persists across sessions, so `/local` and `/public` keep working post-signout.
- New `<caribou-signout-form>` composite wrapper (light-DOM, no render, no shadow — same shape as `<litro-link>`) intercepts the form's submit event and calls `removeActiveUser()` from `@beatzball/caribou-state` before the native POST proceeds. Wired into both nav-rail and right-rail signout forms. Progressive enhancement preserved: no-JS users still get a server-side signout.
- New `base-head.ts` injects a global `litro-link { display: contents }` rule into every SSR'd page's `<head>`, removing the per-consumer footgun where light-DOM consumers (auth-required, retry, blog) silently lacked the layout-invisible declaration that shadow-DOM consumers had inline.

E2E covers the post-signout state: cookie persists, localStorage cleared.
