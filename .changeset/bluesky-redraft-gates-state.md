---
"@beatzball/caribou-state": patch
---

A Bluesky redraft keeps the post's reply and quote limits. `readBlueskyRedraft` reads them with the post. `redraftGatesOf` gives the limits the draft can send: none for a reply, and no list from another repo or unknown rule. `redraftDropsGates` is true when the draft keeps less than the post had, so the confirm can say so before the delete. A failed read throws `BlueskyRedraftGatesUnread`, so nothing is deleted.
