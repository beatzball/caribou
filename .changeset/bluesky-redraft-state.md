---
"@beatzball/caribou-state": patch
---

Bluesky delete and redraft. `deleteOwnStatusOutcome` answers deleted, failed or unknown (`deleteOwnStatus` keeps its shape). `readBlueskyRedraft`, `storeBlueskyRedraft`, `settleBlueskyRedraft` and `discardBlueskyRedraft` read the post, stage the redraft in a hidden `staged:` slot before the delete, then move or remove it by the outcome. The move after the delete renames the slot in place, so it needs no more storage. A redraft keeps its source post; a stored redraft of the same post wins over a new one, so no edit is lost. A redraft whose delete was in doubt is checked when it opens. A staged draft of a post that is still up goes after a day, or when plain Delete deletes the post. `forgetDeletedStatus` drops a post found already deleted. `draft-files.ts` keeps a stored redraft's image bytes in IndexedDB. The label menu adds `sexual` (Suggestive), and a redraft carries any other self-label.
