---
"@beatzball/caribou-bluesky-client": patch
---

`fetchNotifications` reads `listNotifications`: like, repost, follow, mention, reply and quote map to Caribou types; every other reason, and a notification whose post is gone, is skipped and never throws. Posts come from `getPosts` with provenance and moderation. A page carries the AppView cursor and a seen hint. `sinceId` pages from the top until it meets that notification. New `getUnreadCount` and `updateSeen`.
