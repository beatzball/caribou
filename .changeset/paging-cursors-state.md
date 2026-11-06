---
"@beatzball/caribou-state": patch
---

The timeline and profile stores keep the page's opaque cursor and page by it, never by the last status id. The profile store takes the server's first cursor, and both stores expose `nextCursor`. No behavior change.
