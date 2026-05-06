---
'@beatzball/caribou-mastodon-client': minor
---

Add read-only fetchers `fetchStatus`, `fetchThread`, `lookupAccount`, and
`fetchAccountStatuses` on `CaribouClient`. Re-export `Status` and `Account`
types from the package barrel. Add `./sanitize-opts` subpath export sharing
`PURIFY_OPTS` between the client and the server-side sanitizer.
