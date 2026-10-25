---
'@beatzball/caribou-state': minor
---

Add `relationships.ts`: a `relationshipCache` signal keyed by signed-in user and account, `loadRelationship(accountId)`, and `toggleFollow(account)`. `toggleFollow` changes the cache at once, puts the old state back and dispatches a `caribou:toast` error when the request fails, sends a follow request to a locked account (`requested`), withdraws a pending request with an unfollow, and allows one write in flight per account.
