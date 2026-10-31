---
"caribou-app": minor
---

Sign-out with more than one account signed in now signs out of the current
account only. The next account becomes active and the page reloads as that
account, on the same page when it means the same for any account (home,
notifications, bookmarks, your profile, the public feeds), else on home. The
last sign-out goes to `/` as before. A second click while sign-out is still
running does nothing, so it can no longer sign out of the next account too.
An expired session (a 401) with another account still signed in now moves to
that account instead of signing out completely. Sign-out and 401s that happen
together end in one reload, as the account that is left, with the cookie set
to its server. When the server changes, a public feed keeps its filters but
not its page position (`max_id`, `min_id`, `since_id`). A sign-out or a 401
that comes after that reload started, but before the new page shows, reloads
again as the account that is left. A page brought back with the browser's
Back button can sign out again.

A new `POST /api/instance` sets the instance cookie to a server this
deployment has an app for, from a same-origin page only; the app uses it to
point SSR of the public feeds and profiles at the new account's server. When
that fails twice, the reload goes to home rather than to a public feed of the
old server. On a full page load, a cookie that names another server than the
current account's is set to that account's server, so the next load of a
public feed shows the right server. Sign-out still never clears the cookie. Sign-in now saves the
server name in lower case.
