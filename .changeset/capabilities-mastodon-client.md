---
"@beatzball/caribou-mastodon-client": patch
---

Add `capabilities` and `timelineOrder(kind)` to `CaribouClient`. The Mastodon client fills them with what Mastodon supports today and its usual order: newest first by id, bookmarks in the order the server sends. No behavior change.
