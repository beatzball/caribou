---
"@beatzball/caribou-bluesky-client": patch
---

The signed-out allow-list (spec 8.3): `isProvenVisible(actor)` is true only for an author object with a DID, a handle and a `labels` array with no `!no-unauthenticated`. In a signed-out copy, a quoted post whose author is not proven visible is the hidden quote, and a feed, list, starter pack or labeler card whose creator is not (the label, or a missing or partial creator) is a card with the note "This account asked to be seen only by signed-in readers." and nothing of the record. A new server door, `./syntax`, exports `isValidHandle`, `isValidDid` and `isValidRecordKey` from `@atproto/syntax`. SSR test fixtures are in `src/__fixtures__/ssr-appview.ts`.
