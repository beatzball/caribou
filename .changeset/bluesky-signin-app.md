---
"caribou-app": patch
---

Behind the Bluesky flag: the sign-in page has two panels, Mastodon and Bluesky, as a real tablist. The Bluesky callback at `/signin/bluesky` sends `no-store` and `no-referrer`, finishes the sign-in once and goes to `/home`. A Bluesky session that ended shows "Your Bluesky session ended. Sign in again." and keeps the page and the drafts. Sign-out of a Bluesky account revokes it at its server. With the flag off nothing changes. Account names in the rail and on /settings are `@handle` for a Bluesky account and say "Bluesky" to assistive technology; Mastodon names do not change. A switch or sign-out that lands on a Bluesky account sends `/local` and `/public` to `/home`, and Bluesky profile and post paths are kept.
