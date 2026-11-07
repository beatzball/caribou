---
"@beatzball/caribou-bluesky-client": minor
---

The Bluesky client can read. `createBlueskyClient` reads the Following feed, bookmarks, posts, threads, profiles, an author's posts, relationships, mutes and blocks. Mappers turn posts, profiles and feed entries into Caribou's own types. Polling catches up without `since_id`, at most 3 pages, and calls the rest a gap. A repost entry has its own id, with a fallback when the AppView leaves out the repost's URI.
