---
"@beatzball/caribou-state": patch
---

Sessions get a `generation`, one per sign-in, and an `expired` state. A failure changes a session only while it has the same `generation`. `markExpired` keeps the session, its prefs and its drafts. `removeSession` (a 401) now keeps the drafts and prefs; only a sign-out deletes them. The failure events carry `{ userKey, generation }`, and `caribou:session-expired` is split from `caribou:unauthorized`. The rules are in the README.
