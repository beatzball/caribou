---
"@beatzball/caribou-mastodon-client": patch
---

Every page answers with an opaque `nextCursor`, null on the last page, and takes it back as `cursor`. `fetchAccountStatuses` now returns a page too. `nextMaxId` and the `maxId` input are renamed. Type-contract tests lock in the owned-type corrections. No behavior change.
