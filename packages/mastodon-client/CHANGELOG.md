# @beatzball/caribou-mastodon-client

## 0.4.5

### Patch Changes

- [#213](https://github.com/beatzball/caribou/pull/213) [`f0a9069`](https://github.com/beatzball/caribou/commit/f0a906960cfe7954928eccb86ddfe660118ac750) Thanks [@beatzball](https://github.com/beatzball)! - Add `resourceNetwork` and `canActOn`, so a screen acts only through a client on the resource's own network. Add `Account.bluesky` and `Capabilities.readLagMs` (0 for Mastodon).

## 0.4.4

### Patch Changes

- [#209](https://github.com/beatzball/caribou/pull/209) [`a789261`](https://github.com/beatzball/caribou/commit/a789261653998910ec7d5ae03cb328e4bf180f45) Thanks [@beatzball](https://github.com/beatzball)! - Add `capabilities` and `timelineOrder(kind)` to `CaribouClient`. The Mastodon client fills them with what Mastodon supports today and its usual order: newest first by id, bookmarks in the order the server sends. No behavior change.

- [#204](https://github.com/beatzball/caribou/pull/204) [`c553d3f`](https://github.com/beatzball/caribou/commit/c553d3f98db40ee718aeb0ba3df9826a1b37c796) Thanks [@beatzball](https://github.com/beatzball)! - Define Caribou's own data types (`Status`, `Account`, `Relationship`, `List`, `Notification`, and the types they hold). They keep Mastodon's field names and are recursive. `Status` and `Relationship` get an optional `bluesky` field. Client method signatures name these types. A compile-time check maps masto's types into them, and a test stops other code from naming masto's types. No behavior change.

- [#210](https://github.com/beatzball/caribou/pull/210) [`8fbb318`](https://github.com/beatzball/caribou/commit/8fbb3186037511b86f95af495e4cfe1dcf829b7a) Thanks [@beatzball](https://github.com/beatzball)! - Every page answers with an opaque `nextCursor`, null on the last page, and takes it back as `cursor`. `fetchAccountStatuses` now returns a page too. `nextMaxId` and the `maxId` input are renamed. Type-contract tests lock in the owned-type corrections. No behavior change.

- [#208](https://github.com/beatzball/caribou/pull/208) [`ba34c91`](https://github.com/beatzball/caribou/commit/ba34c911318dcd81f6484b1fd181e2878c957400) Thanks [@beatzball](https://github.com/beatzball)! - Client write methods take a ref, not an id: `favourite`, `unfavourite`, `reblog`, `unreblog`, `bookmark` and `unbookmark` take a `StatusRef`; `follow`, `unfollow`, `mute`, `unmute`, `block` and `unblock` take an `AccountRef`. A ref has room for Bluesky's record URIs. `statusRef()` and `accountRef()` build them. Mastodon sends the same requests as before.

## 0.4.3

### Patch Changes

- [#168](https://github.com/beatzball/caribou/pull/168) [`729db16`](https://github.com/beatzball/caribou/commit/729db164e22d5c7061a0bf31e3ce919382c8d9d9) Thanks [@beatzball](https://github.com/beatzball)! - New poll calls: `votePoll` (`POST /api/v1/polls/:id/votes`) and `fetchPoll` (`GET /api/v1/polls/:id`). `createStatus` takes a `poll` (options, duration, several choices, hidden totals). It never sends a poll beside media.

## 0.4.2

### Patch Changes

- [#152](https://github.com/beatzball/caribou/pull/152) [`33c430f`](https://github.com/beatzball/caribou/commit/33c430f33b6bc95e79ba80f69f5224033fdb80a8) Thanks [@beatzball](https://github.com/beatzball)! - New calls to edit and delete a post: `fetchStatusSource`, `editStatus`, `deleteStatus` and `fetchStatusHistory`.

- [#155](https://github.com/beatzball/caribou/pull/155) [`97df338`](https://github.com/beatzball/caribou/commit/97df33801f763ac23c5b7ad8d70ab2038289b5ff) Thanks [@beatzball](https://github.com/beatzball)! - Add `fetchGroupedNotifications`: grouped notifications from `GET /api/v2/notifications` (Mastodon 4.3+). Favourites, boosts and follows are grouped. An older server answers `not_found`. `fetchNotificationGroupAccounts` loads everyone in a group. A `CaribouError` now keeps the HTTP `status`.

- [#153](https://github.com/beatzball/caribou/pull/153) [`58ef9e1`](https://github.com/beatzball/caribou/commit/58ef9e13b885ada30c4b4a8b94c9cadfe9ad71dc) Thanks [@beatzball](https://github.com/beatzball)! - Add list calls: `fetchLists`, `fetchList`, `createList`, `updateList`, `deleteList`, `fetchListAccounts` (every page), `addListAccounts`, `removeListAccounts` and `fetchAccountLists`.

- [#156](https://github.com/beatzball/caribou/pull/156) [`e551dda`](https://github.com/beatzball/caribou/commit/e551dda63b62327b9fb5ccdfd10901639d4941be) Thanks [@beatzball](https://github.com/beatzball)! - Add `search` (`GET /api/v2/search`, with `resolve` for a signed-in reader) and `searchPublic`, a search with no token that never sends `resolve`.

## 0.4.1

### Patch Changes

- [#146](https://github.com/beatzball/caribou/pull/146) [`d334e96`](https://github.com/beatzball/caribou/commit/d334e96531bac7d5a864372046fa791ffa3dfdd1) Thanks [@beatzball](https://github.com/beatzball)! - Add `mute`, `unmute`, `block`, `unblock`, `fetchMutes`, `fetchBlocks` (paged by the Link header cursor), `fetchFilters` (filters v2) and `fetchStatuses` (several posts in one request).

- [#145](https://github.com/beatzball/caribou/pull/145) [`113e18e`](https://github.com/beatzball/caribou/commit/113e18e83b3d227b8dda7af0ef2c6cd05eeba1d4) Thanks [@beatzball](https://github.com/beatzball)! - Add `fetchTag`, `followTag` and `unfollowTag`. Tag names are encoded in the path, for hashtag timelines too.

## 0.4.0

### Minor Changes

- [#102](https://github.com/beatzball/caribou/pull/102) [`1bf7f0a`](https://github.com/beatzball/caribou/commit/1bf7f0ae0aaea70f1175bae84d363295a4274809) Thanks [@beatzball](https://github.com/beatzball)! - `fetchTimeline` now resolves to a `TimelinePage`: the statuses, plus
  `nextMaxId` where the last status id is not the next page's cursor. For
  `'bookmarks'` it is the `max_id` from Mastodon's Link header (bookmarks are
  ordered by bookmark id), or `null` when there is no next page. Other
  timelines leave it unset. A `sinceId` on bookmarks returns an empty page.

- [#103](https://github.com/beatzball/caribou/pull/103) [`20b0f9c`](https://github.com/beatzball/caribou/commit/20b0f9c708b9dde27c2078d611aedfb3992d2f45) Thanks [@beatzball](https://github.com/beatzball)! - Add `fetchNotifications({ types, sinceId, minId, maxId, limit })` for `GET /api/v1/notifications`.

## 0.3.0

### Minor Changes

- [#92](https://github.com/beatzball/caribou/pull/92) [`3ba56a9`](https://github.com/beatzball/caribou/commit/3ba56a9b5aa4c851d8d0a699c0ff395fa4d46fe7) Thanks [@beatzball](https://github.com/beatzball)! - Add `installPurifyHooks(purify)` to `sanitize-opts`. It adds a DOMPurify hook that puts `noopener` and `noreferrer` into the `rel` of every link that opens a new window (`target="_blank"` in any case, or a named target), keeping words already there, and installs only once per DOMPurify instance. `forceSafeTargetRel` is the hook itself.

## 0.2.1

### Patch Changes

- [#75](https://github.com/beatzball/caribou/pull/75) [`cbaf05a`](https://github.com/beatzball/caribou/commit/cbaf05ac7ec2f2ce06fa5e27bd8f1793ba48ae87) Thanks [@beatzball](https://github.com/beatzball)! - Add `verifyCredentials()` to `CaribouClient`.

## 0.2.0

### Minor Changes

- [#72](https://github.com/beatzball/caribou/pull/72) [`c5b45e3`](https://github.com/beatzball/caribou/commit/c5b45e36ad1d82e2f122d9847ca6bce0941329e3) Thanks [@beatzball](https://github.com/beatzball)! - Add the compose methods to `CaribouClient`: `createStatus` (sends an
  `Idempotency-Key` so a retry never posts twice), `uploadMedia` (v2 upload
  that waits up to five minutes for the server to finish processing),
  `waitForMedia` (resumes that wait after a `MediaProcessingTimeout`, which
  carries the media id), `fetchMedia`, `updateMedia` and `fetchInstance`.
  Writes skip the in-flight dedup.

- [#71](https://github.com/beatzball/caribou/pull/71) [`a46114c`](https://github.com/beatzball/caribou/commit/a46114c9a3177ba516911a02bc68ad2b066682ab) Thanks [@beatzball](https://github.com/beatzball)! - Add `fetchRelationships(ids)`, `follow(id)` and `unfollow(id)` to `CaribouClient`, and export the `Relationship` type. A follow and an unfollow of the same account never share a request.

- [#70](https://github.com/beatzball/caribou/pull/70) [`1541e71`](https://github.com/beatzball/caribou/commit/1541e716563a98ff0b7b685842aa9462e78d499a) Thanks [@beatzball](https://github.com/beatzball)! - `CaribouClient` can now favourite, boost and bookmark a status, and undo each:
  `favourite` / `unfavourite`, `reblog` / `unreblog`, `bookmark` / `unbookmark`.
  Each returns the post as the server now has it; `reblog` returns the boosted
  post, not the wrapper Mastodon creates. These writes skip the request
  de-duplication that reads use, so two clicks are two requests.

## 0.1.0

### Minor Changes

- [#17](https://github.com/beatzball/caribou/pull/17) [`b371f8d`](https://github.com/beatzball/caribou/commit/b371f8d14fab3d956a884fa36d469fe6bbd79478) Thanks [@beatzball](https://github.com/beatzball)! - Add read-only fetchers `fetchStatus`, `fetchThread`, `lookupAccount`, and
  `fetchAccountStatuses` on `CaribouClient`. Re-export `Status` and `Account`
  types from the package barrel. Add `./sanitize-opts` subpath export sharing
  `PURIFY_OPTS` between the client and the server-side sanitizer.

### Patch Changes

- Updated dependencies [[`8b4d3e1`](https://github.com/beatzball/caribou/commit/8b4d3e100088c798ab6a94bf36421c4b2d06197c)]:
  - @beatzball/caribou-auth@0.0.2

## 0.0.1

### Patch Changes

- [#3](https://github.com/beatzball/caribou/pull/3) [`becf5d0`](https://github.com/beatzball/caribou/commit/becf5d0c55b79af4915e00f022d7a6073f950bdf) Thanks [@beatzball](https://github.com/beatzball)! - Initial @beatzball/caribou-mastodon-client with fetchTimeline, dedup, and 401 interceptor.

- Updated dependencies [[`becf5d0`](https://github.com/beatzball/caribou/commit/becf5d0c55b79af4915e00f022d7a6073f950bdf)]:
  - @beatzball/caribou-auth@0.0.1
