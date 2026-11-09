---
"caribou-app": patch
---

The Bluesky e2e fixture server no longer exposes `atproto-content-labelers` unless a test asks, as on the real servers. A new e2e test checks that a clean post in Following shows with no moderation cover.

The active Bluesky reader's label definitions are checked again every 10 minutes while the page is visible, and when the app comes back to the foreground.
