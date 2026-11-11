---
"@beatzball/caribou-bluesky-client": minor
---

Bluesky Home follows the reader's Following feed prefs, as bsky.app does. The client reads `feedViewPref` for `home` (hide replies, hide reposts, hide quote posts). A reply shows only when the reader follows its author and someone it answers, or when it is a self-thread. Orphan replies (a reposted one too) and muted threads never show. The reader's own posts and reposts always show, unless the reader muted the thread. Replies to the reader show unless they are orphans or in a muted thread. A reply that shows carries its root and parent as `bluesky.replyContext`, each mapped and moderated. Lists, custom feeds and profiles are unchanged.
