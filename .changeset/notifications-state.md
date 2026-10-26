---
"@beatzball/caribou-state": minor
---

Add `createNotificationsStore` (load, load older, poll, filter by type) and an app-wide unread count: `startUnreadNotifications` polls once a minute while the tab is visible, `unreadNotificationCount` holds the count, and `markNotificationsSeen` moves the per-account seen marker, stored as `lastSeenNotificationId` in `caribou.prefs.<userKey>`.
