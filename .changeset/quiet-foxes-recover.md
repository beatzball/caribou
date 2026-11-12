---
"@beatzball/caribou-bluesky-client": patch
---

Keep Bluesky sessions after a temporary token refresh failure. Check stored credentials before expiring an account on a 401, and record safe session-end reasons locally.
