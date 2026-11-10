---
"@beatzball/caribou-bluesky-client": patch
---

Read the reader's saved feeds (`blueskySavedFeeds`, from `savedFeedsPrefV2`) and a custom feed's posts (`fetchTimeline({ type: 'feed', uri })`, through `getFeed`). A gone feed is `not_found`; `UnknownFeed` is now `not_found` too. Saved feeds are read for at most 200 feeds, with one `getFeedGenerators` request at a time. A feed's catch-up reads one page. `FEED_GONE` and `FEED_FAILED` are exported.
