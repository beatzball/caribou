---
'@beatzball/caribou-auth': patch
---

`buildAuthorizeUrl()` now sets `force_login=true` on the Mastodon `/oauth/authorize` URL.

Without it, an active Mastodon session cookie + a previously-authorized OAuth app caused the authorize endpoint to silently auto-redirect with a token for the existing session. Consumers (such as caribou-elena) that clear local state on sign-out couldn't actually switch to a different Mastodon account on the same instance — the picker round-tripped to the OAuth flow and came back with the same account. Forcing `force_login=true` makes Mastodon always show the login/account picker.
