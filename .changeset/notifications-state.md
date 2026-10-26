---
"@beatzball/caribou-state": minor
---

Add `createNotificationsStore` (load, load older, poll, filter by type). A poll pages forward with `min_id` until it has caught up, so a burst of new notifications leaves no hole in the list; a failed poll or load older keeps the rows and an app-wide unread count: `startUnreadNotifications` polls once a minute while the tab is visible, `unreadNotificationCount` holds the count, and `markNotificationsSeen` moves the per-account seen marker, stored as `lastSeenNotificationId` in `caribou.prefs.<userKey>`.
