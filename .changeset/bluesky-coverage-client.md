---
"@beatzball/caribou-bluesky-client": patch
---

Every signed-in read now sets labeler coverage, so a clean post or profile is no longer stuck under "checking your moderation settings". A browser cannot read `atproto-content-labelers`. When the header is missing, coverage is the labelers the request sent in `atproto-accept-labelers`, at most 20. A result built from several answers keeps only what every answer covered.
