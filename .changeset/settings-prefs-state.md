---
"@beatzball/caribou-state": patch
---

Add per-account preference helpers over `caribou.prefs.<userKey>`: `readPrefs`, `updatePrefs`, `themeOf` and `defaultTimelineOf`. Add `storageWorks`, which says whether the browser lets the app save anything. The notifications seen marker now uses them.
