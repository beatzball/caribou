---
"@beatzball/caribou-bluesky-client": patch
---

Deleting a Bluesky post now deletes its reply and quote limits too. The client reads the thread gate and post gate first. A post with no gate is one `deleteRecord`, as before. A post with a gate is one `applyWrites` that deletes the post and only the gates found. A failed gate read fails the delete, with nothing written.
