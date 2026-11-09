---
"@beatzball/caribou-bluesky-client": patch
---

Add `blueskyDeletePost(uri)` (deleteRecord, only for a post in the reader's own repo; a delete with no clear answer is decided by `getRecord`, and `BlueskyDeleteUnknown` is thrown when that check fails too) and `blueskyGetBlob(cid)`. `deleteStatus` and `fetchStatusSource` now name the Bluesky methods to use.
