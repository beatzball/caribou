---
"@beatzball/caribou-bluesky-client": patch
---

A signed-out copy of a feed, list, starter pack or labeler card whose creator has `!no-unauthenticated` is now a card with the note "This account asked to be seen only by signed-in readers." and nothing of the record (`NO_UNAUTHENTICATED_NOTE`). A new server door, `./syntax`, exports `isValidHandle`, `isValidDid` and `isValidRecordKey` from `@atproto/syntax`. Test fixtures for the app's SSR tests are in `src/__fixtures__/ssr-appview.ts`.
