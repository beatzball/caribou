---
"caribou-app": minor
---

Sign-out with more than one account signed in now signs out of the current
account only. The next account becomes active and the page reloads as that
account, on the same page when it means the same for any account (home,
notifications, bookmarks, the public feeds), else on home. The last sign-out
goes to `/` as before. A new `POST /api/instance` sets the instance cookie to
a server this deployment has an app for, from a same-origin page only; the
app uses it to point SSR of the public feeds and profiles at the new account's
server. Sign-out still never clears the cookie.
