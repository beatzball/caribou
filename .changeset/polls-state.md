---
"@beatzball/caribou-state": patch
---

New `votePoll`, `refreshPoll`, `cachedPoll` and `optimisticVote`. A vote shows at once in the post and every boost of it, takes the server's poll on success, and rolls back with a toast on failure. A result for an earlier account writes nothing. `mergeStatus` keeps the reader's vote (`voted`, `ownVotes`) over a copy without a token, and an account change drops it. Drafts can carry a `poll`; `postDraft` sends its filled options, trimmed.
