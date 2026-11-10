---
"@beatzball/caribou-state": patch
---

Bluesky drafts keep reply and quote limits (`bluesky.gates`). A send freezes them with the record and passes them to `blueskyCreatePost`. A reply never sends limits. With no limit, the send and its draft input are as before.
