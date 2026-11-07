---
"@beatzball/caribou-mastodon-client": patch
---

`StatusBluesky` gains an optional `recordCard`: the feed, list, starter pack or labeler a Bluesky post embeds, as a card. It is apart from `card`, which comes from the media, so a post can show both. `Quote` gains an optional `bluesky.hidden` for a Bluesky quote left out by spec 8.3 (`no-unauthenticated`).
