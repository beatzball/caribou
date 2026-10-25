---
"@beatzball/caribou-state": minor
---

New `toggleFavourite`, `toggleReblog` and `toggleBookmark`. Each changes the
flag and count in the status cache at once, then calls the client. On success
it stores the server's copy; on failure it rolls back and dispatches an error
`caribou:toast`. The change reaches the post and every boost wrapper of it.
A second click while a write for the same post and action is in flight is
ignored.
