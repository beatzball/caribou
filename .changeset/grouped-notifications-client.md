---
"@beatzball/caribou-mastodon-client": patch
---

Add `fetchGroupedNotifications`: grouped notifications from `GET /api/v2/notifications` (Mastodon 4.3+). Favourites, boosts and follows are grouped. An older server answers `not_found`. `fetchNotificationGroupAccounts` loads everyone in a group. A `CaribouError` now keeps the HTTP `status`.
