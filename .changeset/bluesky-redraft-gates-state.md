---
"@beatzball/caribou-state": patch
---

A Bluesky redraft keeps the post's reply and quote limits. `readBlueskyRedraft` reads them with the post, and the draft of a top-level post gets them. A failed read throws `BlueskyRedraftGatesUnread`, so nothing is deleted. `redraftDropsGates` says when a reply had limits that a reply cannot keep.
