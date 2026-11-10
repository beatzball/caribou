---
"@beatzball/caribou-bluesky-client": patch
---

Read the reader's saved feeds (`blueskySavedFeeds`, from `savedFeedsPrefV2`) and a custom feed's posts (`fetchTimeline({ type: 'feed', uri })`, through `getFeed`). A gone feed is `not_found`; `UnknownFeed` is now `not_found` too.
