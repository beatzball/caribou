---
"caribou-app": patch
---

Behind the Bluesky flag: the sign-in page has two panels, Mastodon and Bluesky, as a real tablist. The Bluesky callback at `/signin/bluesky` sends `no-store` and `no-referrer`, finishes the sign-in once and goes to `/home`. A Bluesky session that ended shows "Your Bluesky session ended. Sign in again." and keeps the page and the drafts. Sign-out of a Bluesky account revokes it at its server. With the flag off nothing changes.
