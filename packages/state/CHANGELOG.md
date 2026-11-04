# @beatzball/caribou-state

## 0.4.4

### Patch Changes

- [#166](https://github.com/beatzball/caribou/pull/166) [`3cf8c08`](https://github.com/beatzball/caribou/commit/3cf8c08713c8d4473769c94f5af04f9586a095f6) Thanks [@beatzball](https://github.com/beatzball)! - Add `shortcutsOf(prefs)`: whether the keyboard shortcuts are on for an account. On unless `shortcuts: false` is stored.

- [#168](https://github.com/beatzball/caribou/pull/168) [`729db16`](https://github.com/beatzball/caribou/commit/729db164e22d5c7061a0bf31e3ce919382c8d9d9) Thanks [@beatzball](https://github.com/beatzball)! - New `votePoll`, `refreshPoll`, `cachedPoll` and `optimisticVote`. A vote shows at once in the post and every boost of it, takes the server's poll on success, and rolls back with a toast on failure. A result for an earlier account writes nothing. `mergeStatus` keeps the reader's vote (`voted`, `ownVotes`) over a copy without a token, and an account change drops it. Drafts can carry a `poll`; `postDraft` sends its filled options, trimmed.

- [#167](https://github.com/beatzball/caribou/pull/167) [`6af44c7`](https://github.com/beatzball/caribou/commit/6af44c76bf72cbac4b6905d4546218110e7bc512) Thanks [@beatzball](https://github.com/beatzball)! - The status cache also keeps a quoted post (Mastodon 4.5 `quote.quotedStatus`) under its own id, with the same rules as any other copy: a newer edit is never undone, the reader's flags are kept, and its `filtered` counts for `readerFiltered`. An account change drops the reader's flags from the copy inside the quote too. A quote of a post the reader deleted becomes a deleted quote when the account changes. A copy without a token (no `filtered`) never replaces the reader's quote state, and a shallow quote never replaces a full quote of the same post. A kept quote does not cache its old quoted post again, and the reader's copy is found inside a boost too. The newest `filtered` and the quote of each post now live in one record per post id (`postRecords`, read through `readerFiltered` and the new `readerQuote`), written by every copy of the post, alone, in a boost or in a quote; `filteredById` is gone.

- Updated dependencies [[`729db16`](https://github.com/beatzball/caribou/commit/729db164e22d5c7061a0bf31e3ce919382c8d9d9)]:
  - @beatzball/caribou-mastodon-client@0.4.3

## 0.4.3

### Patch Changes

- [#152](https://github.com/beatzball/caribou/pull/152) [`33c430f`](https://github.com/beatzball/caribou/commit/33c430f33b6bc95e79ba80f69f5224033fdb80a8) Thanks [@beatzball](https://github.com/beatzball)! - New `editOwnStatus` and `deleteOwnStatus`. An edit updates the post and every boost of it in the cache. A delete removes them at once, marks the id in `deletedStatusIds`, and puts everything back if the server refuses. An account change drops the cached copies of deleted posts. Every cache write (`cacheStatus` and `mergeStatus`) keeps the newest edit of a post over an older copy. New `EDIT_FIELDS`, `olderEdit` and `newestKnownStatus`. Drafts can carry `sensitive` and `language`. A redraft that must not overwrite a stored draft is kept in its own `redraft:<key>` slot; `findRedraftSlot` finds it.

- [#155](https://github.com/beatzball/caribou/pull/155) [`97df338`](https://github.com/beatzball/caribou/commit/97df33801f763ac23c5b7ad8d70ab2038289b5ff) Thanks [@beatzball](https://github.com/beatzball)! - The notifications store shows rows as groups (`groups`). It uses the grouped endpoint when the server has it, and groups single notifications itself when the server answers 404. Older and newer pages join their groups with no duplicates. `withoutSilencedAccounts` takes muted and blocked accounts out of a group.

- [#153](https://github.com/beatzball/caribou/pull/153) [`58ef9e1`](https://github.com/beatzball/caribou/commit/58ef9e13b885ada30c4b4a8b94c9cadfe9ad71dc) Thanks [@beatzball](https://github.com/beatzball)! - Add the lists store: `loadLists`, `loadList`, `createList`, `updateList`, `deleteList`, `loadListMembers`, `loadAccountLists` and `setListMember`. Each entry is kept per account. Writes show at once and roll back with a toast on failure, and an answer for an earlier account is dropped. Writes to one list or one membership run in order, so the server ends with the last change. A read that crosses a write waits and asks again.

- [#156](https://github.com/beatzball/caribou/pull/156) [`e551dda`](https://github.com/beatzball/caribou/commit/e551dda63b62327b9fb5ccdfd10901639d4941be) Thanks [@beatzball](https://github.com/beatzball)! - Add `loadRelationships`: reads the relationships of many accounts, 40 per request, and keeps any follow that started meanwhile.

- Updated dependencies [[`33c430f`](https://github.com/beatzball/caribou/commit/33c430f33b6bc95e79ba80f69f5224033fdb80a8), [`97df338`](https://github.com/beatzball/caribou/commit/97df33801f763ac23c5b7ad8d70ab2038289b5ff), [`58ef9e1`](https://github.com/beatzball/caribou/commit/58ef9e13b885ada30c4b4a8b94c9cadfe9ad71dc), [`e551dda`](https://github.com/beatzball/caribou/commit/e551dda63b62327b9fb5ccdfd10901639d4941be)]:
  - @beatzball/caribou-mastodon-client@0.4.2

## 0.4.2

### Patch Changes

- [#146](https://github.com/beatzball/caribou/pull/146) [`d334e96`](https://github.com/beatzball/caribou/commit/d334e96531bac7d5a864372046fa791ffa3dfdd1) Thanks [@beatzball](https://github.com/beatzball)! - Add `setMute` and `setBlock`. Writes to one account's relationship, follow included, go through one queue in order: the cache changes at once, an answer cannot overwrite a newer write, and a failed write rolls back only itself. Add `loadReaderView`, which merges the reader's own copies of server-rendered posts and tracks each post's check in `readerChecks`. Add `readerFiltered`, the newest `filtered` for a post from any copy. `mergeStatus` takes `filtered` from a fresh copy that has it, and the timeline, profile and thread stores seed with it.

- [#145](https://github.com/beatzball/caribou/pull/145) [`113e18e`](https://github.com/beatzball/caribou/commit/113e18e83b3d227b8dda7af0ef2c6cd05eeba1d4) Thanks [@beatzball](https://github.com/beatzball)! - Add `tagCache`, `loadTag`, `toggleTagFollow`, `tagFollowing`, `tagKey` and `normalizeTagName` for hashtag follow state. `normalizeTagName` copies Mastodon's normalizer, so `#Café` and `#cafe` are one tag. A follow shows at once and rolls back with a toast when it fails. A read that fails with anything but 404 keeps the known state. A read that overlaps a write is dropped, and so is any result after the account changes.

- [#144](https://github.com/beatzball/caribou/pull/144) [`d0bcc11`](https://github.com/beatzball/caribou/commit/d0bcc1141c48f3e600ad5986b251f8bd75e3d947) Thanks [@beatzball](https://github.com/beatzball)! - Add per-account preference helpers over `caribou.prefs.<userKey>`: `readPrefs`, `updatePrefs`, `themeOf` and `defaultTimelineOf`. Add `storageWorks`, which says whether the browser lets the app save anything. The notifications seen marker now uses them.

- Updated dependencies [[`d334e96`](https://github.com/beatzball/caribou/commit/d334e96531bac7d5a864372046fa791ffa3dfdd1), [`113e18e`](https://github.com/beatzball/caribou/commit/113e18e83b3d227b8dda7af0ef2c6cd05eeba1d4)]:
  - @beatzball/caribou-mastodon-client@0.4.1

## 0.4.1

### Patch Changes

- [#136](https://github.com/beatzball/caribou/pull/136) [`67283c2`](https://github.com/beatzball/caribou/commit/67283c2891d2faa37db44895f2efa95eab934b8c) Thanks [@beatzball](https://github.com/beatzball)! - `DraftMedia` has an optional `name`: the name of the file the user picked. It is stored with the draft. This is on purpose: it gives each attachment's buttons a name after a reload. The name stays in the browser and is never sent to the server.

- [#139](https://github.com/beatzball/caribou/pull/139) [`1947217`](https://github.com/beatzball/caribou/commit/19472171d3004a39f192483c69cfa672eaa7302c) Thanks [@beatzball](https://github.com/beatzball)! - A failed older page now waits for the reader. A background check no longer replaces its error when the check fails, and no longer clears it when the check works. This also holds while its Retry runs. So infinite scroll does not start again on its own. `retry()` and `load()` now clear `failedOp` together with `error`.

## 0.4.0

### Minor Changes

- [#127](https://github.com/beatzball/caribou/pull/127) [`e07d7a0`](https://github.com/beatzball/caribou/commit/e07d7a05b7eaecb8e41dbedff2710f3652b1b4b1) Thanks [@beatzball](https://github.com/beatzball)! - Groundwork for more than one account (#58). `switchAccount(userKey)` makes a
  stored account active and saves it. `signOutActive()` signs out of the active
  account only and makes the next stored account active, or none when it was the
  last; it returns the new active session. `nextAccountKey(keys, removed)` is the
  rule both use to pick the next account. A favourite, boost or bookmark that
  finishes after the active account changed no longer writes the old account's
  flag into the status cache, and no longer shows its error toast (#108 item 5).

## 0.3.0

### Minor Changes

- [#103](https://github.com/beatzball/caribou/pull/103) [`20b0f9c`](https://github.com/beatzball/caribou/commit/20b0f9c708b9dde27c2078d611aedfb3992d2f45) Thanks [@beatzball](https://github.com/beatzball)! - Add `createNotificationsStore` (load, load older, poll, filter by type). A poll pages forward with `min_id` until it has caught up, so a burst of new notifications leaves no hole in the list; a failed poll or load older keeps the rows and an app-wide unread count: `startUnreadNotifications` polls once a minute while the tab is visible, `unreadNotificationCount` holds the count, and `markNotificationsSeen` moves the per-account seen marker, stored as `lastSeenNotificationId` in `caribou.prefs.<userKey>`.

- [#104](https://github.com/beatzball/caribou/pull/104) [`3d3a08f`](https://github.com/beatzball/caribou/commit/3d3a08f1e82ff2bf61b196772403623b5964e098) Thanks [@beatzball](https://github.com/beatzball)! - Add `createKeepAlive`, an in-memory LRU cache that empties itself when the active account changes, with `clearKeptAlive` and `ownerGeneration` (changes on every account change, so a late result can be dropped). An account change also drops the reader's own flags from every cached status (`forgetReaderFields`), so one account's favourites never show as another's. Add `mergeStatus`, which caches a fresh copy of a status but keeps the reader's flags, and keeps the count while one of the reader's actions on that post is in flight or when the fresh copy is older. Timeline stores get `refresh()`, `retry()` (runs the last failed fetch again), `offer(page, nextMaxId)` (a fresh first page from elsewhere: new posts go to the buffer, known ones are merged; into an empty list it sets up paging), and `refreshing` / `syncedAt` signals. Every fetch checks the owner generation right before it writes. The new-posts buffer never holds a post the list already shows. `poll()` now asks from the top of the new-posts buffer. Thread stores get `offer(thread)`: posts update in place and new replies go at the end.

- [#102](https://github.com/beatzball/caribou/pull/102) [`1bf7f0a`](https://github.com/beatzball/caribou/commit/1bf7f0ae0aaea70f1175bae84d363295a4274809) Thanks [@beatzball](https://github.com/beatzball)! - The timeline store pages by the `nextMaxId` a page returns, when it has one,
  and keeps it across a new `activeClient`. A page with `nextMaxId: null` ends
  the list at once, so no extra "older" request is made.

### Patch Changes

- Updated dependencies [[`1bf7f0a`](https://github.com/beatzball/caribou/commit/1bf7f0ae0aaea70f1175bae84d363295a4274809), [`20b0f9c`](https://github.com/beatzball/caribou/commit/20b0f9c708b9dde27c2078d611aedfb3992d2f45)]:
  - @beatzball/caribou-mastodon-client@0.4.0

## 0.2.3

### Patch Changes

- Updated dependencies [[`3ba56a9`](https://github.com/beatzball/caribou/commit/3ba56a9b5aa4c851d8d0a699c0ff395fa4d46fe7)]:
  - @beatzball/caribou-mastodon-client@0.3.0

## 0.2.2

### Patch Changes

- [#86](https://github.com/beatzball/caribou/pull/86) [`9b13b5f`](https://github.com/beatzball/caribou/commit/9b13b5f5ea0ea8e65c3c06778fcac57c4fd51ebe) Thanks [@beatzball](https://github.com/beatzball)! - `caribou:unauthorized` is now a `CustomEvent` whose detail names the session of the client that got the 401 (`{ userKey, token }`). New `removeSession(userKey, token)` removes that session, with its prefs and drafts, only while it is still stored with the same token, and clears `activeUserKey` only if it was active. It returns `'active'`, `'inactive'` or `'stale'`.

  `loadFromStorage` fills in a missing `userKey` from the map key, so a 401 can still find an older stored session.

## 0.2.1

### Patch Changes

- [#75](https://github.com/beatzball/caribou/pull/75) [`cbaf05a`](https://github.com/beatzball/caribou/commit/cbaf05ac7ec2f2ce06fa5e27bd8f1793ba48ae87) Thanks [@beatzball](https://github.com/beatzball)! - `UserSession.account` is now typed `Account | null`, as sign-in stores it. New: `loadActiveAccount()` loads and stores the active user's account when it is missing; `userName(user)` gives the user's handle with or without the account; `isOwnAccount(user, account)` tells whether an account is the user.

- Updated dependencies [[`cbaf05a`](https://github.com/beatzball/caribou/commit/cbaf05ac7ec2f2ce06fa5e27bd8f1793ba48ae87)]:
  - @beatzball/caribou-mastodon-client@0.2.1

## 0.2.0

### Minor Changes

- [#72](https://github.com/beatzball/caribou/pull/72) [`c5b45e3`](https://github.com/beatzball/caribou/commit/c5b45e36ad1d82e2f122d9847ca6bce0941329e3) Thanks [@beatzball](https://github.com/beatzball)! - Add compose drafts: `loadDraft`, `saveDraft` and `clearDraft` keep one
  draft per user under `caribou.drafts.<userKey>`, with a separate slot for a
  new post and for each reply. `postDraft` posts a draft, clears it, caches
  the new status and dispatches `caribou:posted`.

- [#71](https://github.com/beatzball/caribou/pull/71) [`a46114c`](https://github.com/beatzball/caribou/commit/a46114c9a3177ba516911a02bc68ad2b066682ab) Thanks [@beatzball](https://github.com/beatzball)! - Add `relationships.ts`: a `relationshipCache` signal keyed by signed-in user and account, `loadRelationship(accountId)`, and `toggleFollow(account)`. `toggleFollow` changes the cache at once, puts the old state back and dispatches a `caribou:toast` error when the request fails, sends a follow request to a locked account (`requested`), withdraws a pending request with an unfollow, and allows one write in flight per account.

- [#70](https://github.com/beatzball/caribou/pull/70) [`1541e71`](https://github.com/beatzball/caribou/commit/1541e716563a98ff0b7b685842aa9462e78d499a) Thanks [@beatzball](https://github.com/beatzball)! - New `toggleFavourite`, `toggleReblog` and `toggleBookmark`. Each changes the
  flag and count in the status cache at once, then calls the client. On success
  it takes that flag and count from the server's answer; on failure it undoes its
  own change and dispatches an error `caribou:toast`. Either way it leaves every
  other field as the cache holds it, so a poll or another action that lands
  during the request is kept. The change reaches the post and every boost wrapper of it.
  A second click while a write for the same post and action is in flight is
  ignored.

### Patch Changes

- Updated dependencies [[`c5b45e3`](https://github.com/beatzball/caribou/commit/c5b45e36ad1d82e2f122d9847ca6bce0941329e3), [`a46114c`](https://github.com/beatzball/caribou/commit/a46114c9a3177ba516911a02bc68ad2b066682ab), [`1541e71`](https://github.com/beatzball/caribou/commit/1541e716563a98ff0b7b685842aa9462e78d499a)]:
  - @beatzball/caribou-mastodon-client@0.2.0

## 0.1.0

### Minor Changes

- [#17](https://github.com/beatzball/caribou/pull/17) [`b371f8d`](https://github.com/beatzball/caribou/commit/b371f8d14fab3d956a884fa36d469fe6bbd79478) Thanks [@beatzball](https://github.com/beatzball)! - Add `createAccountCache` (handle → Account memoization with stale-while-
  revalidate), `createProfileStore` (per-account paginated profile statuses
  with tab-driven remount), and `createThreadStore` (parallel focused-status
  - thread-context fetch with `AsyncState` discriminated-union state).
    `createTimelineStore` gains an `initial` option for SSR-seeded hydration
    without a redundant first fetch.

### Patch Changes

- Updated dependencies [[`8b4d3e1`](https://github.com/beatzball/caribou/commit/8b4d3e100088c798ab6a94bf36421c4b2d06197c), [`b371f8d`](https://github.com/beatzball/caribou/commit/b371f8d14fab3d956a884fa36d469fe6bbd79478)]:
  - @beatzball/caribou-auth@0.0.2
  - @beatzball/caribou-mastodon-client@0.1.0

## 0.0.1

### Patch Changes

- [#3](https://github.com/beatzball/caribou/pull/3) [`becf5d0`](https://github.com/beatzball/caribou/commit/becf5d0c55b79af4915e00f022d7a6073f950bdf) Thanks [@beatzball](https://github.com/beatzball)! - Initial @beatzball/caribou-state: users/caches/timeline-store/polling/bindSignals.

- Updated dependencies [[`becf5d0`](https://github.com/beatzball/caribou/commit/becf5d0c55b79af4915e00f022d7a6073f950bdf), [`becf5d0`](https://github.com/beatzball/caribou/commit/becf5d0c55b79af4915e00f022d7a6073f950bdf)]:
  - @beatzball/caribou-auth@0.0.1
  - @beatzball/caribou-mastodon-client@0.0.1
