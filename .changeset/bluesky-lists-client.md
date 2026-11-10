---
"@beatzball/caribou-bluesky-client": patch
---

The client reads and writes the reader's curate lists: view, create, rename, delete, add and remove members, the list feed, and the lists that hold an account. Lists and members are read from the PDS. Creates use client-picked rkeys. A write in doubt is decided by a read, and `BlueskyWriteUnknown` says when that read failed. Moderation lists and starter-pack lists are left out.
