---
"@beatzball/caribou-bluesky-client": patch
---

`blueskyCreatePost(record, rkey, gates)`: with limits, the post, its thread gate and its post gate go in one `applyWrites` call with the same rkey, so they land together or not at all. A list rule names only a list in the reader's own repo. With no limit, it is `createRecord` as before.
