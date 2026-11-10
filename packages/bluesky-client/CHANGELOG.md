# @beatzball/caribou-bluesky-client

## 0.1.4

### Patch Changes

- [#244](https://github.com/beatzball/caribou/pull/244) [`4f7a387`](https://github.com/beatzball/caribou/commit/4f7a3876bc12bf489b1eba26e6b342fc9744c582) Thanks [@beatzball](https://github.com/beatzball)! - The README no longer names the Bluesky browser flag. It says when the app loads the `bsky` chunk, including a deferred public Bluesky page.

## 0.1.3

### Patch Changes

- [#236](https://github.com/beatzball/caribou/pull/236) [`ee3d0e4`](https://github.com/beatzball/caribou/commit/ee3d0e4055687c132cb0db1426f1cb3ba8ba885f) Thanks [@beatzball](https://github.com/beatzball)! - Add like, repost, bookmark, follow, mute and block, with their undos. An undo deletes only the record its ref names, in the reader repo. With no ref, it reads the reader view first. It never guesses a record. Unblock and Unmute refuse a block or mute that comes from a list. The client picks the rkey, so a lost answer never makes a second record. `mapRelationship` keeps the list URIs. A blocked profile read leaves the follow unknown, since the AppView hides it, and `blockUri` keeps only a block record URI.

- [#232](https://github.com/beatzball/caribou/pull/232) [`1b953ac`](https://github.com/beatzball/caribou/commit/1b953acbdcbf6a354230144d2aa9527d5bcc60e0) Thanks [@beatzball](https://github.com/beatzball)! - Add the compose writes: `blueskyCreatePost` with a chosen rkey, `blueskyGetOwnPost`, `blueskyUploadBlob`, `blueskyDetectFacets` and `blueskyNextRkey`, plus `countPost` from the SDK's `RichText` and `BlueskyBlobNotFound`.

- [#235](https://github.com/beatzball/caribou/pull/235) [`c8344a4`](https://github.com/beatzball/caribou/commit/c8344a4a5939ee33876feff78cd636ff5c0333f1) Thanks [@beatzball](https://github.com/beatzball)! - Every signed-in read now sets labeler coverage, so a clean post or profile is no longer stuck under "checking your moderation settings". A browser cannot read `atproto-content-labelers`. When the header is missing, coverage is the labelers the request sent in `atproto-accept-labelers`, at most 20. A result built from several answers keeps only what every answer covered.

  `restoreClient` also answers `recheckLabelers()`: it checks the label definitions again, and a labeler `getServices` no longer answers for loses them, so the cover comes back. An agent with no session counts as sending no labelers.

- [#231](https://github.com/beatzball/caribou/pull/231) [`847d947`](https://github.com/beatzball/caribou/commit/847d947229bc06343cccb3a712c54db848b2aba1) Thanks [@beatzball](https://github.com/beatzball)! - `fetchNotifications` reads `listNotifications`: like, repost, follow, mention, reply and quote map to Caribou types; every other reason, and a notification whose post is gone, is skipped and never throws. Posts come from `getPosts` with provenance and moderation. A page carries the AppView cursor and a seen hint. `sinceId` pages from the top until it meets that notification. New `getUnreadCount` and `updateSeen`. Reasons are looked up in a `Map`, so names like `constructor` are skipped. Catch-up also stops at the first notification older than `sinceAt`, so a deleted anchor is not read past. The seen hint also names the raw top's URI (`newestUri`). Notification authors and posts carry the labeler coverage their own answer named (`atproto-content-labelers`), so the reader veil can settle for them. The signed-in moderation source is now `readerModerationSource` (in `./moderation`), and `BlueskyModerationSource` takes an optional `coverage`.

- [#237](https://github.com/beatzball/caribou/pull/237) [`1ce053d`](https://github.com/beatzball/caribou/commit/1ce053d1d3d9bf7deb1e279e5319dacfc64838fc) Thanks [@beatzball](https://github.com/beatzball)! - Add `blueskyDeletePost(uri)` (deleteRecord, only for a post in the reader's own repo; a delete with no clear answer is decided by `getRecord`, and `BlueskyDeleteUnknown` is thrown when that check fails too) and `blueskyGetBlob(cid)`. `deleteStatus` and `fetchStatusSource` now name the Bluesky methods to use.

- Updated dependencies [[`ee3d0e4`](https://github.com/beatzball/caribou/commit/ee3d0e4055687c132cb0db1426f1cb3ba8ba885f), [`1b953ac`](https://github.com/beatzball/caribou/commit/1b953acbdcbf6a354230144d2aa9527d5bcc60e0), [`847d947`](https://github.com/beatzball/caribou/commit/847d947229bc06343cccb3a712c54db848b2aba1), [`1ce053d`](https://github.com/beatzball/caribou/commit/1ce053d1d3d9bf7deb1e279e5319dacfc64838fc)]:
  - @beatzball/caribou-mastodon-client@0.4.7

## 0.1.2

### Patch Changes

- [#230](https://github.com/beatzball/caribou/pull/230) [`e70b6d7`](https://github.com/beatzball/caribou/commit/e70b6d7c2b3f2d40edf62820cb8ee15bba75847d) Thanks [@beatzball](https://github.com/beatzball)! - The signed-out page code moved into the package (`src/signed-out.ts`, exported from `./moderation`): `signedOutProfilePage`, `signedOutThread`, `signedOutLabelDefs` and the guards, with the caller's fetch and HTML cleaner. The app's server and its browser fallback now share one copy. `./moderation` also exports `isProvenVisible`. A source can name errors that must reach the caller (`mustPropagate`); the app passes its rate-limit check, so a 429 on the label definitions is never read as "no definitions".

- [#228](https://github.com/beatzball/caribou/pull/228) [`a9931de`](https://github.com/beatzball/caribou/commit/a9931deafacaa9aa23e75b0e362abcc1bb0be52b) Thanks [@beatzball](https://github.com/beatzball)! - The signed-out allow-list (spec 8.3): `isProvenVisible(actor)` is true only for an author object with a DID, a handle and a `labels` array with no `!no-unauthenticated`. In a signed-out copy, a quoted post whose author is not proven visible is the hidden quote, and a feed, list, starter pack or labeler card whose creator is not (the label, or a missing or partial creator) is a card with the note "This account asked to be seen only by signed-in readers." and nothing of the record. A new server door, `./syntax`, exports `isValidHandle`, `isValidDid` and `isValidRecordKey` from `@atproto/syntax`. SSR test fixtures are in `src/__fixtures__/ssr-appview.ts`.

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
