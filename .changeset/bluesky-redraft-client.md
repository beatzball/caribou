---
"@beatzball/caribou-bluesky-client": patch
---

Add `blueskyDeletePost(uri)` (deleteRecord, only for a post in the reader's own repo) and `blueskyGetBlob(cid)` (the bytes of a blob in the reader's repo). `deleteStatus` and `fetchStatusSource` now name the Bluesky methods to use.
