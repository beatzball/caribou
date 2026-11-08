---
"@beatzball/caribou-state": patch
---

A Bluesky post's `moderation` now stays paired with its `viewerOf` through every cache merge. When the merge keeps the cached `viewerOf` (page data, another account's copy), it keeps the cached decision too. When it clears `viewerOf` (another account's copy with nothing cached, an account change), it drops the decision, so a screen covers the post until a copy for the current reader arrives.
