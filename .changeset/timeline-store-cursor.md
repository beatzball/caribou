---
"@beatzball/caribou-state": minor
---

The timeline store pages by the `nextMaxId` a page returns, when it has one,
and keeps it across a new `activeClient`. A page with `nextMaxId: null` ends
the list at once, so no extra "older" request is made.
