---
"@beatzball/caribou-bluesky-client": patch
---

The client reads and writes the reader's curate lists: view, create, rename, delete, add and remove members, the list feed, and the lists that hold an account. Lists and members are read from the PDS. Creates use client-picked rkeys. A write in doubt is decided by a read, and `BlueskyWriteUnknown` says when that read failed. Moderation lists and starter-pack lists are left out. A delete or removal refuses when the list items could not all be read. A delete that removed some members but not the list throws `BlueskyListPartlyDeleted`. A removal checks that the list is a curate list. After a delete, a sweep removes items added meanwhile; when it fails, the error says the list is gone and some members may remain.
