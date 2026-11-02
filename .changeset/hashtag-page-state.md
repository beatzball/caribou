---
"@beatzball/caribou-state": patch
---

Add `tagCache`, `loadTag`, `toggleTagFollow`, `tagFollowing`, `tagKey` and `normalizeTagName` for hashtag follow state. `normalizeTagName` copies Mastodon's normalizer, so `#Café` and `#cafe` are one tag. A follow shows at once and rolls back with a toast when it fails. A read that fails with anything but 404 keeps the known state. A read that overlaps a write is dropped, and so is any result after the account changes.
