---
"@beatzball/caribou-state": patch
---

New `editOwnStatus` and `deleteOwnStatus`. An edit updates the post and every boost of it in the cache. A delete removes them at once, marks the id in `deletedStatusIds`, and puts everything back if the server refuses. A merge keeps a newer edit over an older copy. Drafts can carry `sensitive` and `language`.
