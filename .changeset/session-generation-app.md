---
"caribou-app": patch
---

A 401 no longer deletes the account's drafts and settings; signing in again finds them. Sign-in stores a new `generation` for each sign-in. A new `caribou:session-expired` handler marks the session expired and keeps the page.
