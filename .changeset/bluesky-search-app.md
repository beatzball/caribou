---
"caribou-app": patch
---

Bluesky search and hashtag page. With a Bluesky account active, Search is in the nav. It finds people and posts, with "More people" and "More posts" buttons, and plain messages for no results, errors and rate limits. Each person row follows the reader's moderation settings. `/tags/<tag>?net=bsky` shows the tag's newest posts to a reader with a Bluesky account active; anyone else sees a sign-in note and a link to the tag on bsky.app. A tag in a Bluesky post opens this page in the app. The hashtag page hides Follow when the account's network cannot follow tags.
