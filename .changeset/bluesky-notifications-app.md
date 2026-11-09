---
"caribou-app": patch
---

Bluesky notifications (behind the Bluesky flag). The list groups likes, reposts and follows, says "liked" and "reposted", and links each account by its handle. It sends `updateSeen` when the full list is on screen, once per new notification. A list whose first page is empty but has a cursor shows "Load older" instead of "No notifications yet".
