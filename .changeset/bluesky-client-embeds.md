---
"@beatzball/caribou-bluesky-client": patch
---

Map Bluesky embeds to media, link cards and quotes: images, external links,
quoted posts and their not-found, blocked and detached states, feeds, lists,
starter packs, labelers, quotes with media, and video as a thumbnail card
that links to the post on bsky.app. An unknown or broken embed becomes a
"Not supported here — open on bsky.app" card and never throws. A signed-out copy leaves out a quoted post whose author has `!no-unauthenticated` (spec 8.3).
