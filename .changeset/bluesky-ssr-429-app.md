---
"caribou-app": patch
---

Bluesky SSR has a named 30 s TTL for each page call (profile, author feed, thread); errors and 429s are never cached. When the public AppView answers 429, the page is a loading shell with no account data, the server makes no Bluesky fetch until `Retry-After` has passed (at most 60 s, 30 s when missing), and the browser reads the page from the AppView itself through the same signed-out guard as the server, or as the active Bluesky account. A Mastodon post link that leaves Caribou now says in its name that it opens the post on its own server in a new tab.
