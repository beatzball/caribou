---
'@beatzball/caribou-mastodon-client': minor
---

Add `fetchRelationships(ids)`, `follow(id)` and `unfollow(id)` to `CaribouClient`, and export the `Relationship` type. A follow and an unfollow of the same account never share a request.
