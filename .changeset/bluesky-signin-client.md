---
"@beatzball/caribou-bluesky-client": patch
---

Add Bluesky sign-in over the browser SDK (`./browser`): start a sign-in from a handle, a DID or a PDS address; finish it with one `initCallback()` and a check that the account is the one the handle named; restore a session by DID and build its client with the reader's moderation prefs and label definitions; sign out with a revoke. The package root also exports `BLUESKY_CAPABILITIES`. The rules are in the README ("Sign-in and sessions"). Sign-out uses the SDK's `revoke`, so the tokens go even offline, and a hung revoke is cut off. A mismatched sign-in never removes another account's session. `restoreClient` also answers `reloadModeration()`. Sign-out deletes the stored session directly, outside the SDK's per-DID lock, then revokes at the server for at most 5 s; a 401 while loading moderation inputs also ends the session.
