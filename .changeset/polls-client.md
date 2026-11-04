---
"@beatzball/caribou-mastodon-client": patch
---

New poll calls: `votePoll` (`POST /api/v1/polls/:id/votes`) and `fetchPoll` (`GET /api/v1/polls/:id`). `createStatus` takes a `poll` (options, duration, several choices, hidden totals). It never sends a poll beside media.
