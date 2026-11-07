---
"@beatzball/caribou-state": patch
---

The timeline and profile stores end a list only when the client says so, with a null cursor. An empty page that names a next cursor no longer ends it. Mastodon gives an empty page a null cursor, so nothing changes there.
