# caribou-elena

## 0.0.2

### Patch Changes

- [#9](https://github.com/beatzball/caribou/pull/9) [`d12a711`](https://github.com/beatzball/caribou/commit/d12a7118d4ca6826dd641bf13893914fb3034b08) Thanks [@beatzball](https://github.com/beatzball)! - Inline design-token CSS into the SSR `<head>` so `var(--bg-0)` et al. resolve on first paint. Previously `app.ts` imported `tokens.css`, which Vite extracted into a `dist/client/assets/app-<hash>.css` asset that the SSR shell never linked, leaving every served page rendering as unstyled HTML.

- [#11](https://github.com/beatzball/caribou/pull/11) [`73bea0b`](https://github.com/beatzball/caribou/commit/73bea0b57eb56834912597c73d149903c1c15b2a) Thanks [@beatzball](https://github.com/beatzball)! - Bake design-token CSS into the server bundle at build time. The previous implementation called `readFileSync(require.resolve('@beatzball/caribou-design-tokens/tokens.css'))` at module top-level, which threw `MODULE_NOT_FOUND` in production — the Docker runtime image ships only `dist/`, no `node_modules`, so the workspace package wasn't resolvable. Every page hit that loaded the `[...]` route chunk returned a JSON 500; `/api/health` worked because it's a separate chunk without that import. Fix: `scripts/write-tokens-head.mjs` inlines the CSS into `server/lib/tokens-head.generated.ts` before `litro build`, so the bundle contains a plain string constant.

- [#14](https://github.com/beatzball/caribou/pull/14) [`e833419`](https://github.com/beatzball/caribou/commit/e833419093741d780e822e817cbd7e7f8986a336) Thanks [@beatzball](https://github.com/beatzball)! - Move `caribou-status-card` to shadow DOM and harden avatar loading.

  `static shadow = 'open'` walls the rendered article off from the parent timeline's morph engine. The bug we fixed by hand in PR #13 (parent re-render → Elena's `morphContent` recurses into the card's light DOM → wipes the rendered tree → avatars re-fetch and flicker) becomes structurally impossible — `parent.childNodes` only sees light DOM, and the platform's tree model never crosses a shadow boundary. CSS custom properties (`var(--bg-0)` etc.) inherit through shadow boundaries, so the design tokens still apply.

  Three companion improvements while we're touching the `<img>`:
  - `loading="lazy" decoding="async"` so off-screen avatars don't fetch on initial render — long timelines feel materially faster.
  - One-shot `error` listener that retries the avatar twice (300ms / 600ms backoff) when a transient `ERR_CONNECTION_CLOSED` truncates the response, then dims the slot if it still fails. Resets the retry budget when the URL changes.
  - The `.status-content` wrap rules that used to live in `tokens.css` are now adopted onto the shadow root via Elena's `static styles`, since global CSS no longer reaches inside.

  Side effects in `caribou-home-timeline`: dropped the `card.children.length === 0` recovery branch from `updated()`. With shadow DOM the card never has light-DOM children, so that branch was always-true and would have triggered an unnecessary re-render every time the timeline updated. Banner fallback retained — the banner is still a light-DOM component.

  The `landing.spec.ts` "submitting the picker" test gained a `waitForFunction(() => mains === 1)` guard before the form interaction, matching what the banner test already had — the Litro double-mount race surfaces much more readily on Firefox than Chromium.

- [#13](https://github.com/beatzball/caribou/pull/13) [`3b8baed`](https://github.com/beatzball/caribou/commit/3b8baed1f40343bd3dc44149c41a54417193b467) Thanks [@beatzball](https://github.com/beatzball)! - Stop the home timeline from re-rendering on every poll tick.

  Each `cacheStatus()` call writes a new Map to the global `statusCache` signal, which made the store's `statuses` computed return a new array reference even when the displayed status IDs hadn't changed. `caribou-home-timeline` was subscribed to that array, so every poll caused a full timeline re-render → Elena's `morphContent` recursed into every `<caribou-status-card>`, wiped its `<article>`, and the browser fetched every avatar fresh (visible flicker on profile images).

  Three changes together:
  - `newPostsCount` is pushed into `<caribou-new-posts-banner>` via a dedicated `effect`, so a poll that only changes that signal doesn't invalidate the timeline's render at all.
  - The remaining bindings (`statuses`/`loading`/`errorMsg`) use a shallow-equality check so the timeline only re-renders when displayed status references actually change.
  - As a safety net for the cases that _do_ re-render (loadMore, applyNewPosts), `updated()` calls `requestUpdate()` on any child whose light DOM was emptied by Elena's morph (whose recursion into custom-element children is the structural cause of the wipe).

  Regression test in `feed.spec.ts` tags every avatar `<img>` pre-poll and asserts every node survives the poll.

- Updated dependencies [[`3b8baed`](https://github.com/beatzball/caribou/commit/3b8baed1f40343bd3dc44149c41a54417193b467), [`e833419`](https://github.com/beatzball/caribou/commit/e833419093741d780e822e817cbd7e7f8986a336), [`3b8baed`](https://github.com/beatzball/caribou/commit/3b8baed1f40343bd3dc44149c41a54417193b467)]:
  - @beatzball/caribou-auth@0.0.2
  - @beatzball/caribou-design-tokens@0.0.2
  - @beatzball/caribou-mastodon-client@0.0.2
  - @beatzball/caribou-state@0.0.2

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
