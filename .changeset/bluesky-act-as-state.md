---
"@beatzball/caribou-state": patch
---

New `actAsAccounts`, `actAsClient`, `readAsAccount` and `actAs`: act on a Bluesky post as another signed-in Bluesky account. The write goes through that account's own client. It never changes the active account's cached post. An expired account sends nothing. `deferredBlueskyClient` takes `{ splash: false }`, so another account's restore does not show the splash.
