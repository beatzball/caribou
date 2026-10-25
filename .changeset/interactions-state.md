---
"@beatzball/caribou-state": minor
---

New `toggleFavourite`, `toggleReblog` and `toggleBookmark`. Each changes the
flag and count in the status cache at once, then calls the client. On success
it takes that flag and count from the server's answer; on failure it undoes its
own change and dispatches an error `caribou:toast`. Either way it leaves every
other field as the cache holds it, so a poll or another action that lands
during the request is kept. The change reaches the post and every boost wrapper of it.
A second click while a write for the same post and action is in flight is
ignored.
