---
"@beatzball/caribou-state": patch
---

`deleteOwnStatus` deletes a Bluesky post with `blueskyDeletePost`. New `readBlueskyRedraft` and `finishBlueskyRedraft` build a Bluesky redraft from the post record: read before the delete, images uploaded again after it.
