---
"@beatzball/caribou-mastodon-client": minor
---

`fetchTimeline` now resolves to a `TimelinePage`: the statuses, plus
`nextMaxId` where the last status id is not the next page's cursor. For
`'bookmarks'` it is the `max_id` from Mastodon's Link header (bookmarks are
ordered by bookmark id), or `null` when there is no next page. Other
timelines leave it unset. A `sinceId` on bookmarks returns an empty page.
