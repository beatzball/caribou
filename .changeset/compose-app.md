---
"caribou-app": minor
---

Add the compose dialog. Open it with the New post button in the nav rail,
the `n` key, or a `caribou:compose` event (reply mode shows the post,
prefills the mentions and keeps its visibility). It counts characters the
way Mastodon does against the instance limit, has a content warning,
visibility, and media with alt text, posts with Ctrl/Cmd+Enter, and keeps
the draft on Esc or on an error.
