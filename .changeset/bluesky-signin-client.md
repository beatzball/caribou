---
"@beatzball/caribou-bluesky-client": patch
---

Add Bluesky sign-in over the browser SDK (`./browser`): start a sign-in from a handle, a DID or a PDS address; finish it with one `initCallback()` and a check that the account is the one the handle named (a mismatch never removes another account's session); restore a session by DID and build its client with the reader's moderation prefs and label definitions (`reloadModeration()` loads them again); any 401, also while loading those, ends the session. Sign-out deletes the stored tokens first; from then on the SDK's session store refuses every write for that DID until a new sign-in for it starts, so a refresh that lands later cannot put tokens back. The server revoke is best effort and not waited for. The package root also exports `BLUESKY_CAPABILITIES`. The rules are in the README ("Sign-in and sessions").
