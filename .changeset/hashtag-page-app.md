---
"caribou-app": patch
---

New hashtag page at `/tags/<tag>`. It shows the tag's posts with the same timeline as Local and Public. The server paints the first page, so it works without JavaScript. A hashtag in a post now opens this page inside Caribou. The link keeps its real address, so a new-tab click still goes to the instance. A signed-in reader can follow and unfollow the tag. The button changes at once and goes back if the server fails. The tab title is "#tag · Caribou". Case and non-ASCII names work, and a name that cannot be a hashtag says so.
