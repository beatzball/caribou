---
"@beatzball/caribou-state": patch
---

Bluesky delete and redraft. `deleteOwnStatusOutcome` answers deleted, failed or unknown (`deleteOwnStatus` keeps its shape). `readBlueskyRedraft`, `storeBlueskyRedraft`, `settleBlueskyRedraft` and `discardBlueskyRedraft` read the post, stage the redraft in a hidden `staged:` slot before the delete, then move or remove it by the outcome. A redraft keeps its source post, replaces an older redraft of the same post, and is checked when its delete was in doubt. `forgetDeletedStatus` drops a post found already deleted. `draft-files.ts` keeps a stored redraft's image bytes in IndexedDB. The label menu adds `sexual` (Suggestive), and a redraft carries any other self-label.
