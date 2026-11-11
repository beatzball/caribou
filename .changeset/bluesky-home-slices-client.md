---
"@beatzball/caribou-bluesky-client": minor
---

Bluesky Home follows the reader's Following feed prefs, as bsky.app does. The client reads `feedViewPref` for `home` (hide replies, hide replies to people you do not follow, hide replies by like count, hide reposts, hide quote posts), with the SDK's defaults. The reader's own posts and replies to the reader always show. A reply that shows carries its root and parent as `bluesky.replyContext`, each mapped and moderated. Lists, custom feeds and profiles are unchanged.
