---
"caribou-app": patch
---

The Bluesky libraries now build into their own lazy chunk, `bsky`. A Mastodon page never requests it. A developer flag, `caribou.flag.bluesky` in localStorage, loads it; readers see no change.
