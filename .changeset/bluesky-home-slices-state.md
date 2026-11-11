---
"@beatzball/caribou-state": minor
---

`cacheStatus` and `mergeStatus` cache a Bluesky Home reply's context posts (`bluesky.replyContext`) under their own ids, as they do a quoted post. A like, an edit or a delete of a context post reaches its card. A later copy of the reply with no context keeps the cached context, and `forgetReaderFields` scrubs the context copies.
