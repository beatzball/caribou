---
"@beatzball/caribou-mastodon-client": patch
---

Add `StatusWriteAck`, `RelationshipWriteAck` and `isWriteAck`. A status or relationship write may now answer an ack (Bluesky) instead of the whole post or relationship. Mastodon still answers the whole object. `RelationshipBluesky` gets `blockingByList` and `mutingByList`, and `accountRef` carries them.
