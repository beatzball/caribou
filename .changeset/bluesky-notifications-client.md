---
"@beatzball/caribou-bluesky-client": patch
---

`fetchNotifications` reads `listNotifications`: like, repost, follow, mention, reply and quote map to Caribou types; every other reason, and a notification whose post is gone, is skipped and never throws. Posts come from `getPosts` with provenance and moderation. A page carries the AppView cursor and a seen hint. `sinceId` pages from the top until it meets that notification. New `getUnreadCount` and `updateSeen`. Reasons are looked up in a `Map`, so names like `constructor` are skipped. Catch-up also stops at the first notification older than `sinceAt`, so a deleted anchor is not read past. The seen hint also names the raw top's URI (`newestUri`).
