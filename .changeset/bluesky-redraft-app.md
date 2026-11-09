---
"caribou-app": patch
---

Bluesky: Delete and "Delete & redraft" on your own post. Redraft reads the post, asks, then re-encodes and uploads the images and stores the draft (with the image bytes) before it deletes the post, so nothing can be lost after the delete. The new post gets a new record key. A post with nothing that can be kept is not deleted. A post already deleted leaves the list. A second redraft of a post opens the stored one instead. Post waits while a reply or quote target is checked. The label menu adds Suggestive. Mastodon delete and redraft do not change.
