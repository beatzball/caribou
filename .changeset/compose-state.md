---
"@beatzball/caribou-state": minor
---

Add compose drafts: `loadDraft`, `saveDraft` and `clearDraft` keep one
draft per user under `caribou.drafts.<userKey>`, with a separate slot for a
new post and for each reply. `postDraft` posts a draft, clears it, caches
the new status and dispatches `caribou:posted`.
