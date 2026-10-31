---
"caribou-app": minor
---

Finish multi-account (#58, part 4).

- Sign-in is now bound to the browser that started it. `/api/signin/start` sets a short-lived `caribou.signin` cookie (HttpOnly, SameSite=Lax, path `/api/signin`, Secure on https) with a random nonce, and the OAuth state keeps only its hash. The callback checks it before any token exchange. A sign-in link opened in another browser goes to `/?error=state_mismatch` and changes nothing, so nobody can slip their own account into your browser. Only one sign-in at a time per browser: starting a second one makes the first one's link fail.
- "Add account" in the account menu now opens the add form without a full page load, and the server field gets the focus in Safari too.
- `/?add` with no account signed in (an old link) shows the plain sign-in page.
- A long handle in "You are signed in as …" wraps to a second line instead of being cut; the full text is also in its tooltip.
