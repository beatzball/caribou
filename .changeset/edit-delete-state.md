---
"@beatzball/caribou-state": patch
---

New `editOwnStatus` and `deleteOwnStatus`. An edit updates the post and every boost of it in the cache. A delete removes them at once, marks the id in `deletedStatusIds`, and puts everything back if the server refuses. An account change drops the cached copies of deleted posts. Every cache write (`cacheStatus` and `mergeStatus`) keeps the newest edit of a post over an older copy. New `EDIT_FIELDS`, `olderEdit` and `newestKnownStatus`. Drafts can carry `sensitive` and `language`. A redraft that must not overwrite a stored draft is kept in its own `redraft:<key>` slot; `findRedraftSlot` finds it.
