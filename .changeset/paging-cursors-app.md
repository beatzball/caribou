---
"caribou-app": patch
---

Page data carries `nextCursor`. Timelines and profiles hand the server's first cursor to the client, and the "Older posts" link carries the cursor. On `/bookmarks` that link now carries the bookmark id from the Link header, not a status id; this is more correct, and `/bookmarks` does not read `?max_id=`. No other behavior change.
