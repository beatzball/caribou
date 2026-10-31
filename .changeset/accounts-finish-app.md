---
"caribou-app": minor
---

Finish multi-account (#58, part 4).

- Sign-in is now bound to the browser that started it. `/api/signin/start` sets a short-lived `caribou.signin` cookie (HttpOnly, SameSite=Lax, path `/api/signin`, Secure on https) with a random nonce, and the OAuth state keeps only its hash. The callback checks it before any token exchange. A sign-in link opened in another browser goes to `/?error=state_mismatch` and changes nothing, so nobody can slip their own account into your browser. Only one sign-in at a time per browser: starting a second one makes the first one's link fail.
- A sign-in now finishes in the callback's own response: the session is in that page, never in a URL. `/signin/done#token=…` no longer signs anyone in (it only offers "Return to start"), so a link from someone else cannot switch you to their account. The page is `no-store`, `no-referrer`, and has a strict CSP.
- `/api/signin/start` refuses a request from another site (`403`).
- A callback with no sign-in cookie at all now says "Finish sign-in in the same browser you started it in, with cookies allowed." (`?error=no_cookie`).
- "Add account" in the account menu now opens the add form without a full page load, and the server field gets the focus in Safari too.
- `/?add` with no account signed in (an old link) shows the plain sign-in page.
- A long handle in "You are signed in as …" wraps to a second line instead of being cut; the full text is also in its tooltip.
