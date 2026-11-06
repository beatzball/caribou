---
"@beatzball/caribou-mastodon-client": patch
---

Client write methods take a ref, not an id: `favourite`, `unfavourite`, `reblog`, `unreblog`, `bookmark` and `unbookmark` take a `StatusRef`; `follow`, `unfollow`, `mute`, `unmute`, `block` and `unblock` take an `AccountRef`. A ref has room for Bluesky's record URIs. `statusRef()` and `accountRef()` build them. Mastodon sends the same requests as before.
