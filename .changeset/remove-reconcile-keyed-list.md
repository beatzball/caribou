---
"@beatzball/caribou-ui-headless": patch
---

Remove `reconcileKeyedList` and its tests. Nothing calls it since the app moved to Lit, whose `repeat` directive keys list children itself.
