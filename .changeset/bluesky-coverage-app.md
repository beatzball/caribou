---
"caribou-app": patch
---

The Bluesky e2e fixture server no longer exposes `atproto-content-labelers` unless a test asks, as on the real servers. A new e2e test checks that a clean post in Following shows with no moderation cover.
