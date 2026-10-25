---
"caribou-app": minor
---

Add the compose dialog. Open it with the New post button in the nav rail,
the `n` key, or a `caribou:compose` event (reply mode shows the post,
prefills the mentions and keeps its visibility). It starts from the
account's default visibility, counts characters the way Mastodon does
(grapheme clusters, 23 per link) against the instance limit, has a content warning,
visibility, and media with alt text, posts with Ctrl/Cmd+Enter, saves all alt
text before it posts, and keeps the draft on Esc or on an error. A draft
stays with the account it was started for.
