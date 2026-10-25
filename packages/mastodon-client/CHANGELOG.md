# @beatzball/caribou-mastodon-client

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
