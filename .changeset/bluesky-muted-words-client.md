---
"@beatzball/caribou-bluesky-client": patch
---

Add `editMutedWords` to the restored Bluesky client: add or remove one muted word. It reads the prefs again under the prefs lock, changes only the muted-words pref, keeps every other pref, and runs in the moderation queue so two quick edits both land.
