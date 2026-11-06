---
"@beatzball/caribou-state": patch
---

Status actions and relationship writes send refs. A status action commits the record ref its result carries (Bluesky's like or repost record), and a failure puts the old one back. A queued relationship write builds its ref when it starts, so an unfollow after a follow names the follow's record. No behavior change for Mastodon.
