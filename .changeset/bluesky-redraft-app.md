---
"caribou-app": patch
---

Bluesky: Delete and "Delete & redraft" on your own post. Delete removes the post record. Redraft reads the record and its images first, deletes the post, and opens a new draft with the text, reply and quote, images with alt text, labels and language. The new post gets a new record key. Nothing is deleted when the read fails, and the composer does not open when the delete fails. Mastodon delete and redraft do not change.
