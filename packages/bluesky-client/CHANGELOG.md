# @beatzball/caribou-bluesky-client

## 0.1.1

### Patch Changes

- [#226](https://github.com/beatzball/caribou/pull/226) [`2aaa752`](https://github.com/beatzball/caribou/commit/2aaa752f68a197a7ca1f6a5e73dda7af32f91496) Thanks [@beatzball](https://github.com/beatzball)! - Add Bluesky sign-in over the browser SDK (`./browser`): start a sign-in from a handle, a DID or a PDS address; finish it with one `initCallback()` and a check that the account is the one the handle named (a mismatch never removes another account's session); restore a session by DID and build its client with the reader's moderation prefs and label definitions (`reloadModeration()` loads them again); any 401, also while loading those, ends the session. Sign-out deletes the stored tokens first; from then on the SDK's session store refuses every write for that DID until a new sign-in for it starts, so a refresh that lands later cannot put tokens back. The server revoke is best effort and not waited for. The package root also exports `BLUESKY_CAPABILITIES`. The rules are in the README ("Sign-in and sessions").

## 0.1.0

### Minor Changes

- [#222](https://github.com/beatzball/caribou/pull/222) [`8bd7867`](https://github.com/beatzball/caribou/commit/8bd7867f1b6179379259278a263ae4e30180fcf9) Thanks [@beatzball](https://github.com/beatzball)! - The Bluesky client can read. `createBlueskyClient` reads the Following feed, bookmarks, posts, threads, profiles, an author's posts, relationships, mutes and blocks. Mappers turn posts, profiles and feed entries into Caribou's own types. Polling catches up without `since_id`, at most 3 pages, and calls the rest a gap. A repost entry has its own id, with a fallback when the AppView leaves out the repost's URI.

- [#217](https://github.com/beatzball/caribou/pull/217) [`33f4f1e`](https://github.com/beatzball/caribou/commit/33f4f1eaf98d28970411ca2bef5c54462a236426) Thanks [@beatzball](https://github.com/beatzball)! - New package for Bluesky. This first version fixes its shape: the module map (mappers, facets, embeds, moderation), the server-safe surface at the package root, and the SDK doors `./browser` and `./moderation`. The function bodies come in later changes.

### Patch Changes

- [#220](https://github.com/beatzball/caribou/pull/220) [`ed5753a`](https://github.com/beatzball/caribou/commit/ed5753ad296d6901607cc59576624bfcfe3a645c) Thanks [@beatzball](https://github.com/beatzball)! - Map Bluesky embeds to media, link cards and quotes: images, external links,
  quoted posts and their not-found, blocked and detached states, feeds, lists,
  starter packs, labelers, quotes with media, and video as a thumbnail card
  that links to the post on bsky.app. An unknown or broken embed becomes a
  "Not supported here — open on bsky.app" card and never throws. A signed-out copy leaves out a quoted post whose author has `!no-unauthenticated` (spec 8.3). `mapPost` passes the post URI to `mapEmbed` and fills `bluesky.recordCard`. `isNoUnauthenticated` moves to a server-safe module; `./moderation` re-exports it.

- [#219](https://github.com/beatzball/caribou/pull/219) [`ca653e1`](https://github.com/beatzball/caribou/commit/ca653e14ca39e4586095e94b2e4c11b9fda40338) Thanks [@beatzball](https://github.com/beatzball)! - `renderFacets(text, facets)` now turns a Bluesky post's text and facets into HTML. It cuts by UTF-8 byte ranges, drops bad or overlapping facets without throwing, keeps only http and https links, shows the real URI when link text names another host, links mentions by DID, and links tags to `/tags/<tag>?net=bsky`. The output passes the shared DOMPurify config unchanged.

- [#221](https://github.com/beatzball/caribou/pull/221) [`fc22415`](https://github.com/beatzball/caribou/commit/fc2241503a9ba90152367ac592e23387bd22062e) Thanks [@beatzball](https://github.com/beatzball)! - Add Bluesky moderation. `moderate()` runs the SDK's `moderatePost` and
  `moderateProfile` with the reader's prefs and label definitions and returns
  plain data for each context. It fails closed and never throws: negated
  labels are dropped, a label the SDK cannot define gets a cover with no Show
  button, missing prefs lock every cover, and an SDK error covers everything.
  Bluesky's own labeler is always subscribed and needs its definitions too.
  Also adds `labelDefsFromServices`, `LOGGED_OUT_PREFS`, `isNoUnauthenticated`
  and `blueskyCheckSettled`, the reader veil check.
- Updated dependencies [[`33f4f1e`](https://github.com/beatzball/caribou/commit/33f4f1eaf98d28970411ca2bef5c54462a236426), [`ed5753a`](https://github.com/beatzball/caribou/commit/ed5753ad296d6901607cc59576624bfcfe3a645c)]:
  - @beatzball/caribou-mastodon-client@0.4.6
