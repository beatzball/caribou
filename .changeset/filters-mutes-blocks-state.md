---
"@beatzball/caribou-state": patch
---

Add `setMute` and `setBlock`. Writes to one account's relationship, follow included, go through one queue in order: the cache changes at once, an answer cannot overwrite a newer write, and a failed write rolls back only itself. Add `loadReaderView`, which merges the reader's own copies of server-rendered posts. `mergeStatus` takes `filtered` from a fresh copy that has it, and the timeline, profile and thread stores seed with it.
