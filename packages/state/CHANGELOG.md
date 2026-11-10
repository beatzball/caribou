# @beatzball/caribou-state

## 0.4.11

### Patch Changes

- [#257](https://github.com/beatzball/caribou/pull/257) [`049c6c3`](https://github.com/beatzball/caribou/commit/049c6c355c1edd3c618454b769971b6377b23265) Thanks [@beatzball](https://github.com/beatzball)! - New `actAsAccounts`, `actAsClient`, `readAsAccount` and `actAs`: act on a Bluesky post as another signed-in Bluesky account. The write goes through that account's own client. It never changes the active account's cached post. An expired account sends nothing, and an answer that lands after expiry counts as expired. A write the server acked is kept for that account and sign-in through the AppView's read lag, so a reread does not hide it and a click never makes a second record. `deferredBlueskyClient` takes `{ splash: false }`, so another account's restore does not show the splash.

- [#258](https://github.com/beatzball/caribou/pull/258) [`03e5c8d`](https://github.com/beatzball/caribou/commit/03e5c8dbd8b2943bc1e86d3c2e0fb72ea01bc6ae) Thanks [@beatzball](https://github.com/beatzball)! - Bluesky drafts keep reply and quote limits (`bluesky.gates`). A send freezes them with the record and passes them to `blueskyCreatePost`. A reply never sends limits. With no limit, the send and its draft input are as before.

- [#259](https://github.com/beatzball/caribou/pull/259) [`9cc3cf2`](https://github.com/beatzball/caribou/commit/9cc3cf27e605dbec45895375ea07db7af192b780) Thanks [@beatzball](https://github.com/beatzball)! - A Bluesky draft keeps a link card. The record sends it as `app.bsky.embed.external` when there are no images and no quote, and `prepareCardThumb` uploads its image once before Post.

- [#260](https://github.com/beatzball/caribou/pull/260) [`cf311f6`](https://github.com/beatzball/caribou/commit/cf311f6822e5ad00a5cb2151059f37e6daf696e4) Thanks [@beatzball](https://github.com/beatzball)! - Document that the app calls `clearKeptAlive` after a Bluesky muted-words save.

- Updated dependencies [[`03e5c8d`](https://github.com/beatzball/caribou/commit/03e5c8dbd8b2943bc1e86d3c2e0fb72ea01bc6ae)]:
  - @beatzball/caribou-mastodon-client@0.4.9

## 0.4.10

### Patch Changes

- [#249](https://github.com/beatzball/caribou/pull/249) [`56cb752`](https://github.com/beatzball/caribou/commit/56cb7521f8830515a9a19be4c65421d9de0839c0) Thanks [@beatzball](https://github.com/beatzball)! - Add `savedFeedsCache` and `loadSavedFeeds`: a Bluesky reader's saved feeds, kept per account. Read only. A copy under 5 minutes old is used with no request; an older one is answered at once and read again in the background. `force: true` reads again.

- [#247](https://github.com/beatzball/caribou/pull/247) [`58fddb9`](https://github.com/beatzball/caribou/commit/58fddb9033aee1dd0abc589537ac6299e28b4bbc) Thanks [@beatzball](https://github.com/beatzball)! - After a Bluesky Unblock, `setBlock` takes an optional page `signal` and reads the follow again at 5 s, 20 s, and 5 s before the lag window ends (55 s on Bluesky) while it is unknown and no block is known. `settleBlueskyRedraft` answers another tab's redraft of the same post when that tab removed this copy. Removed dead code in `renameDraftIf`, and fixed stale comments.

- [#250](https://github.com/beatzball/caribou/pull/250) [`1f1c35e`](https://github.com/beatzball/caribou/commit/1f1c35e77bf35662942f880c6f7a9f7ed40f6abf) Thanks [@beatzball](https://github.com/beatzball)! - A list write whose outcome is unknown goes back, says "Could not tell whether … Reload to check.", and reads the lists (and the members, when shown) again. A failure with words for the reader is toasted as it is. A partly done delete brings the list back, says so, and reads the lists, the members and the memberships again. A failed re-read drops the members or memberships it was for, instead of keeping them as current.

- Updated dependencies [[`56cb752`](https://github.com/beatzball/caribou/commit/56cb7521f8830515a9a19be4c65421d9de0839c0), [`f9e07a4`](https://github.com/beatzball/caribou/commit/f9e07a4f90492b1240fe32478bea7f60a197a6ef)]:
  - @beatzball/caribou-mastodon-client@0.4.8

## 0.4.9

### Patch Changes

- [#236](https://github.com/beatzball/caribou/pull/236) [`ee3d0e4`](https://github.com/beatzball/caribou/commit/ee3d0e4055687c132cb0db1426f1cb3ba8ba885f) Thanks [@beatzball](https://github.com/beatzball)! - Status actions and relationship writes accept a Bluesky ack. An ack commits the flag and the record ref and keeps the count the click set. A relationship ack is partial: with nothing cached, other fields stay unknown, and `relationshipKnown` says when Follow can show. A read is judged per field group, and the lag guard compares the record URI too. Unblock and Unmute refuse a list block or mute. A Bluesky block leaves the follow, and after an Unblock the relationship is read again. A Mastodon write still drops a read that started before it, whole, as before.

- [#232](https://github.com/beatzball/caribou/pull/232) [`1b953ac`](https://github.com/beatzball/caribou/commit/1b953acbdcbf6a354230144d2aa9527d5bcc60e0) Thanks [@beatzball](https://github.com/beatzball)! - Add the Bluesky draft contract and `postBlueskyDraft`: the rkey and the frozen record are stored before a send, and a retry checks the PDS first, so one click is one post.

- [#231](https://github.com/beatzball/caribou/pull/231) [`847d947`](https://github.com/beatzball/caribou/commit/847d947229bc06343cccb3a712c54db848b2aba1) Thanks [@beatzball](https://github.com/beatzball)! - The notifications list ends only on a null `nextCursor`, for both networks: an empty page with a cursor keeps "Load older". Bluesky lists group on the client (type, post, UTC day), order by `indexedAt`, and poll by catch-up. The unread badge reads `getUnreadCount` for a Bluesky account, and `markBlueskyNotificationsSeen` sends `updateSeen` once, only for the active sign-in. Mastodon is unchanged. A list or cursor that a poll replaces starts a new generation: an older "Load older" answer writes nothing. A poll on an empty list does not bring "Load older" back after the end. An empty first page brings "Load older" back only when its raw top changed (new notifications arrived).

- [#237](https://github.com/beatzball/caribou/pull/237) [`1ce053d`](https://github.com/beatzball/caribou/commit/1ce053d1d3d9bf7deb1e279e5319dacfc64838fc) Thanks [@beatzball](https://github.com/beatzball)! - Bluesky delete and redraft. `deleteOwnStatusOutcome` answers deleted, failed or unknown (`deleteOwnStatus` keeps its shape). `readBlueskyRedraft`, `storeBlueskyRedraft`, `settleBlueskyRedraft` and `discardBlueskyRedraft` read the post, stage the redraft in a hidden `staged:` slot before the delete, then move or remove it by the outcome. The move after the delete renames the slot in place, so it needs no more storage. A redraft keeps its source post; a stored redraft of the same post wins over a new one, so no edit is lost. A redraft whose delete was in doubt is checked when it opens. A draft is removed only by its send, by the reader, or, while no one could see it yet, by its own redraft flow (rule E); a staged draft of a post still up after a day becomes a normal redraft with a note. `forgetDeletedStatus` drops a post found already deleted. `draft-files.ts` keeps a stored redraft's image bytes in IndexedDB. The label menu adds `sexual` (Suggestive), and a redraft carries any other self-label.

- Updated dependencies [[`ee3d0e4`](https://github.com/beatzball/caribou/commit/ee3d0e4055687c132cb0db1426f1cb3ba8ba885f), [`1b953ac`](https://github.com/beatzball/caribou/commit/1b953acbdcbf6a354230144d2aa9527d5bcc60e0), [`847d947`](https://github.com/beatzball/caribou/commit/847d947229bc06343cccb3a712c54db848b2aba1), [`1ce053d`](https://github.com/beatzball/caribou/commit/1ce053d1d3d9bf7deb1e279e5319dacfc64838fc)]:
  - @beatzball/caribou-mastodon-client@0.4.7

## 0.4.8

### Patch Changes

- [#225](https://github.com/beatzball/caribou/pull/225) [`e85a68a`](https://github.com/beatzball/caribou/commit/e85a68a16728b922c63dd58cc2a6489f67f525e4) Thanks [@beatzball](https://github.com/beatzball)! - A Bluesky post's `moderation` now stays paired with its `viewerOf` through every cache merge. When the merge keeps the cached `viewerOf` (page data, another account's copy), it keeps the cached decision too. When it clears `viewerOf` (another account's copy with nothing cached, an account change), it drops the decision, so a screen covers the post until a copy for the current reader arrives.

- [#226](https://github.com/beatzball/caribou/pull/226) [`2aaa752`](https://github.com/beatzball/caribou/commit/2aaa752f68a197a7ca1f6a5e73dda7af32f91496) Thanks [@beatzball](https://github.com/beatzball)! - A session is now a Mastodon session or a Bluesky session (`did`, `handle`, `pds`, user key `<did>@bsky`, no token). For a Bluesky session `activeClient` still answers at once: it restores the OAuth session once per sign-in, through a driver the app sets, and every method waits for that. `blueskyRestore` says how the restore is going. A session the SDK calls gone, or any 401, sends `caribou:session-expired`; a network error changes nothing and the next call tries again. `signOutBluesky` waits for the driver to delete the stored tokens (not for the network), then drops the session only while it has the same `generation`; a failed local delete keeps the account. `renewSession` keeps an existing account's new session after a mismatched sign-in. A Bluesky account reloads its handle on each page load. The rules (8 to 12) are in the README.

## 0.4.7

### Patch Changes

- [#222](https://github.com/beatzball/caribou/pull/222) [`8bd7867`](https://github.com/beatzball/caribou/commit/8bd7867f1b6179379259278a263ae4e30180fcf9) Thanks [@beatzball](https://github.com/beatzball)! - The timeline and profile stores end a list only when the client says so, with a null cursor. An empty page that names a next cursor no longer ends it. Mastodon gives an empty page a null cursor, so nothing changes there.

- Updated dependencies [[`33f4f1e`](https://github.com/beatzball/caribou/commit/33f4f1eaf98d28970411ca2bef5c54462a236426), [`ed5753a`](https://github.com/beatzball/caribou/commit/ed5753ad296d6901607cc59576624bfcfe3a645c)]:
  - @beatzball/caribou-mastodon-client@0.4.6

## 0.4.6

### Patch Changes

- [#212](https://github.com/beatzball/caribou/pull/212) [`53e3716`](https://github.com/beatzball/caribou/commit/53e3716f0a522b923201b60249fc2d32c8331d19) Thanks [@beatzball](https://github.com/beatzball)! - Sessions get a `generation`, one per sign-in, and an `expired` state. A failure changes a session only while it has the same `generation`. `markExpired` keeps the session, its prefs and its drafts. `removeSession` (a 401) now keeps the drafts and prefs; only a sign-out deletes them. The failure events carry `{ userKey, generation }`, and `caribou:session-expired` is split from `caribou:unauthorized`. The rules are in the README.

- [#213](https://github.com/beatzball/caribou/pull/213) [`f0a9069`](https://github.com/beatzball/caribou/commit/f0a906960cfe7954928eccb86ddfe660118ac750) Thanks [@beatzball](https://github.com/beatzball)! - Viewer state lives in slots: a like, a repost and a bookmark each keep their flag and record ref together. One rule decides which copy of a post may change a slot: only the reader's copy, never while the reader's write is out, never a fetch that started before that write finished, and not inside the network's lag window when its flag or record ref disagrees with that write. A copy from another account never brings viewer state, cached or not, on either network. An account change clears every viewer field, `replyDisabled` and `embeddingDisabled` included. Stores and the edit path pass each copy's source (`readSource`). Relationship reads follow the same lag rule.

- Updated dependencies [[`f0a9069`](https://github.com/beatzball/caribou/commit/f0a906960cfe7954928eccb86ddfe660118ac750)]:
  - @beatzball/caribou-mastodon-client@0.4.5

## 0.4.5

### Patch Changes

- [#209](https://github.com/beatzball/caribou/pull/209) [`a789261`](https://github.com/beatzball/caribou/commit/a789261653998910ec7d5ae03cb328e4bf180f45) Thanks [@beatzball](https://github.com/beatzball)! - The timeline store takes its order from the client instead of always sorting by Mastodon id. A sorted timeline merges new posts as before. A timeline in feed order takes new posts only from checks: each check's answer replaces the new-posts buffer, and an answer that does not reach the list is a gap that replaces the list when applied. Bookmarks take the feed-order path, but a bookmarks check answers with an empty page, so they never fill the new-posts banner. One check runs at a time. No visible change for Mastodon.

- [#204](https://github.com/beatzball/caribou/pull/204) [`c553d3f`](https://github.com/beatzball/caribou/commit/c553d3f98db40ee718aeb0ba3df9826a1b37c796) Thanks [@beatzball](https://github.com/beatzball)! - Stores name Caribou's own data types from the client package instead of masto's types. No behavior change.

- [#210](https://github.com/beatzball/caribou/pull/210) [`8fbb318`](https://github.com/beatzball/caribou/commit/8fbb3186037511b86f95af495e4cfe1dcf829b7a) Thanks [@beatzball](https://github.com/beatzball)! - The timeline and profile stores keep the page's opaque cursor and page by it, never by the last status id. The profile store takes the server's first cursor, and both stores expose `nextCursor`. No behavior change.

- [#208](https://github.com/beatzball/caribou/pull/208) [`ba34c91`](https://github.com/beatzball/caribou/commit/ba34c911318dcd81f6484b1fd181e2878c957400) Thanks [@beatzball](https://github.com/beatzball)! - Status actions and relationship writes send refs. A status action commits the record ref its result carries (Bluesky's like or repost record), and a failure puts the old one back. A queued relationship write builds its ref when it starts, so an unfollow after a follow names the follow's record. No behavior change for Mastodon.

- Updated dependencies [[`a789261`](https://github.com/beatzball/caribou/commit/a789261653998910ec7d5ae03cb328e4bf180f45), [`c553d3f`](https://github.com/beatzball/caribou/commit/c553d3f98db40ee718aeb0ba3df9826a1b37c796), [`8fbb318`](https://github.com/beatzball/caribou/commit/8fbb3186037511b86f95af495e4cfe1dcf829b7a), [`ba34c91`](https://github.com/beatzball/caribou/commit/ba34c911318dcd81f6484b1fd181e2878c957400)]:
  - @beatzball/caribou-mastodon-client@0.4.4

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
