---
"@beatzball/caribou-mastodon-client": patch
---

Define Caribou's own data types (`Status`, `Account`, `Relationship`, `List`, `Notification`, and the types they hold). They keep Mastodon's field names and are recursive. `Status` and `Relationship` get an optional `bluesky` field. Client method signatures name these types. A compile-time check maps masto's types into them, and a test stops other code from naming masto's types. No behavior change.
