---
"@beatzball/caribou-state": patch
---

The timeline store takes its order from the client instead of always sorting by Mastodon id. A sorted timeline merges new posts as before. A timeline in feed order takes new posts only from checks: each check's answer replaces the new-posts buffer, and an answer that does not reach the list is a gap that replaces the list when applied. Bookmarks take the feed-order path, but a bookmarks check answers with an empty page, so they never fill the new-posts banner. One check runs at a time. No visible change for Mastodon.
