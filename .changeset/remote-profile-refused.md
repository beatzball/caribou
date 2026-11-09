---
"caribou-app": patch
---

A remote profile whose server refuses Caribou's server (a 401 or a 403) no longer shows "Couldn't load profile". Signed in with a Mastodon account, the profile and its posts load through your own server, which resolves the account by search when it has not seen it yet. The posts link to and act on your own server. Signed out, the page says that server does not allow it and links to the account's own page. The server waits 60 seconds before it asks a refusing server again.
