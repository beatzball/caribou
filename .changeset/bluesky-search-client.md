---
"@beatzball/caribou-bluesky-client": patch
---

The Bluesky client can search: `search` reads `searchActors` and `searchPosts` with a cursor for each kind, and the hashtag timeline reads `searchPosts` with `#<tag>`, newest first. A rate limit or no answer from these reads carries a message a screen can show.
