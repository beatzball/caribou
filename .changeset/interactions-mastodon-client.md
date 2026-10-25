---
"@beatzball/caribou-mastodon-client": minor
---

`CaribouClient` can now favourite, boost and bookmark a status, and undo each:
`favourite` / `unfavourite`, `reblog` / `unreblog`, `bookmark` / `unbookmark`.
Each returns the post as the server now has it; `reblog` returns the boosted
post, not the wrapper Mastodon creates. These writes skip the request
de-duplication that reads use, so two clicks are two requests.
