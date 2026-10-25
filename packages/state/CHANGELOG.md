# @beatzball/caribou-state

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
