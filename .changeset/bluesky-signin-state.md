---
"@beatzball/caribou-state": patch
---

A session is now a Mastodon session or a Bluesky session (`did`, `handle`, `pds`, user key `<did>@bsky`, no token). For a Bluesky session `activeClient` still answers at once: it restores the OAuth session once, through a driver the app sets, and every method waits for that. `blueskyRestore` says how the restore is going. A session the SDK calls gone sends `caribou:session-expired`; a network error changes nothing and the next call tries again. `signOutBluesky` revokes, then drops the session only while it has the same `generation`. The rules (8 to 12) are in the README. One restore per sign-in. Any 401 ends a Bluesky session. Sign-out always deletes the stored tokens and waits at most 8 s. `renewSession` keeps an existing account's new session after a mismatched sign-in. A Bluesky account reloads its handle on each page load.
