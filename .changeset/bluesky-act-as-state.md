---
"@beatzball/caribou-state": patch
---

New `actAsAccounts`, `actAsClient`, `readAsAccount` and `actAs`: act on a Bluesky post as another signed-in Bluesky account. The write goes through that account's own client. It never changes the active account's cached post. An expired account sends nothing, and an answer that lands after expiry counts as expired. A write the server acked is kept for that account and sign-in through the AppView's read lag, so a reread does not hide it and a click never makes a second record. `deferredBlueskyClient` takes `{ splash: false }`, so another account's restore does not show the splash.
