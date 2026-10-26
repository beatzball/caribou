---
"@beatzball/caribou-mastodon-client": minor
---

`fetchTimeline('bookmarks')` now pages with the cursor from Mastodon's Link
header. Bookmarks are ordered by bookmark id, so the last status id is not a
valid `max_id`. The client remembers which cursor follows each page's last
status, so a caller can still pass that status id. A page with no next link
ends the list, and `sinceId` returns an empty page.
