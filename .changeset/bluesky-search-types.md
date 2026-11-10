---
"@beatzball/caribou-mastodon-client": patch
---

`Search` has an optional `bluesky` field with the next-page cursor of each kind, and `SearchInput` has an optional `cursor`. Mastodon ignores both.
