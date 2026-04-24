# caribou-elena

## 0.0.1

### Patch Changes

- [#6](https://github.com/beatzball/caribou/pull/6) [`8844e9b`](https://github.com/beatzball/caribou/commit/8844e9b78882dcae405f240a95cfc8a23e78d759) Thanks [@beatzball](https://github.com/beatzball)! - Canary reliability: thread Coolify's `SOURCE_COMMIT` build arg into
  `write-build-meta.mjs` as a fallback between the explicit `GIT_SHA` env and
  the `git rev-parse HEAD` read. Fixes `/api/health.commit` returning
  `"unknown"` in environments where `.git` is stripped from the Docker build
  context.

- [#5](https://github.com/beatzball/caribou/pull/5) [`d0c41fb`](https://github.com/beatzball/caribou/commit/d0c41fb1702d1b6c0d93949983e6cfff61840ef1) Thanks [@beatzball](https://github.com/beatzball)! - `/api/health` now returns `{ status, commit, version }` where `commit` is the git HEAD at build time and `version` is the package version. Drives the new `pnpm verify:prod` canary that polls until the deployed commit matches the SHA that triggered the workflow.

- Updated dependencies [[`becf5d0`](https://github.com/beatzball/caribou/commit/becf5d0c55b79af4915e00f022d7a6073f950bdf), [`becf5d0`](https://github.com/beatzball/caribou/commit/becf5d0c55b79af4915e00f022d7a6073f950bdf), [`becf5d0`](https://github.com/beatzball/caribou/commit/becf5d0c55b79af4915e00f022d7a6073f950bdf), [`becf5d0`](https://github.com/beatzball/caribou/commit/becf5d0c55b79af4915e00f022d7a6073f950bdf)]:
  - @beatzball/caribou-auth@0.0.1
  - @beatzball/caribou-design-tokens@0.0.1
  - @beatzball/caribou-mastodon-client@0.0.1
  - @beatzball/caribou-state@0.0.1
