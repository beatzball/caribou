---
"@beatzball/caribou-state": patch
---

A session is now a Mastodon session or a Bluesky session (`did`, `handle`, `pds`, user key `<did>@bsky`, no token). For a Bluesky session `activeClient` still answers at once: it restores the OAuth session once per sign-in, through a driver the app sets, and every method waits for that. `blueskyRestore` says how the restore is going. A session the SDK calls gone, or any 401, sends `caribou:session-expired`; a network error changes nothing and the next call tries again. `signOutBluesky` waits for the driver to delete the stored tokens (not for the network), then drops the session only while it has the same `generation`; a failed local delete keeps the account. `renewSession` keeps an existing account's new session after a mismatched sign-in. A Bluesky account reloads its handle on each page load. The rules (8 to 12) are in the README.
