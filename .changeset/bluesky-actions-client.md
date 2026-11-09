---
"@beatzball/caribou-bluesky-client": patch
---

Add like, repost, bookmark, follow, mute and block, with their undos. An undo deletes only the record its ref names, in the reader repo. With no ref, it reads the reader view first. It never guesses a record. Unblock and Unmute refuse a block or mute that comes from a list. The client picks the rkey, so a lost answer never makes a second record. `mapRelationship` keeps the list URIs. A blocked profile read leaves the follow unknown, since the AppView hides it, and `blockUri` keeps only a block record URI.
