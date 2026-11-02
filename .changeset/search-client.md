---
"@beatzball/caribou-mastodon-client": patch
---

Add `search` (`GET /api/v2/search`, with `resolve` for a signed-in reader) and `searchPublic`, a search with no token that never sends `resolve`.
