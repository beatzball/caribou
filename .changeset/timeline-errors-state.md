---
"@beatzball/caribou-state": patch
---

A failed older page now waits for the reader. A background check no longer replaces its error when the check fails, and no longer clears it when the check works. So infinite scroll does not start again on its own. `retry()` and `load()` now clear `failedOp` together with `error`.
