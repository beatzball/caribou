---
"@beatzball/caribou-state": patch
---

The notifications list ends only on a null `nextCursor`, for both networks: an empty page with a cursor keeps "Load older". Bluesky lists group on the client (type, post, UTC day), order by `indexedAt`, and poll by catch-up. The unread badge reads `getUnreadCount` for a Bluesky account, and `markBlueskyNotificationsSeen` sends `updateSeen` once, only for the active sign-in. Mastodon is unchanged.
