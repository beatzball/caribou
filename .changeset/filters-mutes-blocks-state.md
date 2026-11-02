---
"@beatzball/caribou-state": patch
---

Add `setMute`, `setBlock` and `isMutedOrBlocked`. Mute and block update the relationship cache at once and roll back on failure. `mergeStatus` takes `filtered` from a fresh copy that has it.
