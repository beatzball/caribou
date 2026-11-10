---
"@beatzball/caribou-state": patch
---

Add `savedFeedsCache` and `loadSavedFeeds`: a Bluesky reader's saved feeds, kept per account. Read only. A copy under 5 minutes old is used with no request; an older one is answered at once and read again in the background. `force: true` reads again.
