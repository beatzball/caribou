---
"@beatzball/caribou-state": patch
---

Bluesky delete and redraft. `deleteOwnStatusOutcome` answers deleted, failed or unknown (`deleteOwnStatus` keeps its shape). `readBlueskyRedraft`, `storeBlueskyRedraft` and `discardBlueskyRedraft` read the post and store the redraft before the delete. `draft-files.ts` keeps a stored redraft's image bytes in IndexedDB. The label menu adds `sexual` (Suggestive), and a redraft carries any other self-label.
