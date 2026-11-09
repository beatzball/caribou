---
"@beatzball/caribou-mastodon-client": patch
---

Notification pages now carry `nextCursor`: the last id for single notifications, the oldest id covered for grouped ones, and null for an empty page. `cursor` is sent as `max_id`. The client interface gains optional `getUnreadCount` and `updateSeen` (Bluesky only) and `Notification.bluesky`. Requests to Mastodon do not change.
