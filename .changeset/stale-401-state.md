---
'@beatzball/caribou-state': patch
---

`caribou:unauthorized` is now a `CustomEvent` whose detail names the session of the client that got the 401 (`{ userKey, token }`). New `removeSession(userKey, token)` removes that session, with its prefs and drafts, only while it is still stored with the same token, and clears `activeUserKey` only if it was active. It returns `'active'`, `'inactive'` or `'stale'`.
