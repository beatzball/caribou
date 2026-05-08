# caribou-elena

## 0.1.0

### Minor Changes

- [#17](https://github.com/beatzball/caribou/pull/17) [`b371f8d`](https://github.com/beatzball/caribou/commit/b371f8d14fab3d956a884fa36d469fe6bbd79478) Thanks [@beatzball](https://github.com/beatzball)! - Plan 3: read-only completeness. Adds `/local`, `/public`, `/@[handle]`,
  `/@[handle]/[statusId]`, `/privacy`, `/about` routes; renames `/feed` →
  `/home` with a 301 redirect on `/feed`; introduces shadow-DOM layout
  components `<caribou-app-shell>`, `<caribou-nav-rail>`, `<caribou-right-rail>`;
  status-card gains four variants (timeline / focused / ancestor / descendant)
  and renders boosts via `status.reblog ?? status` with a booster-attribution
  row; SSR `pageData` for every public-read route; hostname-only
  `caribou.instance` cookie (validated against the OAuth registry) drives
  bare-URL routing; LRU + in-flight dedup upstream cache; server-side
  DOMPurify+jsdom sanitizer; declarative-shadow-DOM emission with adoption-
  suppression sentinel; anchor-as-source-of-truth pagination with
  IntersectionObserver hijack; auth-required placeholder for `/home`,
  `/@me`, `/@me/[id]`. UnoCSS installed app-local with
  `presetUno() + presetIcons() + presetCaribou()`. Lucide icons via
  `@iconify-json/lucide`.

### Patch Changes

- [`624f45f`](https://github.com/beatzball/caribou/commit/624f45f002e4d6c74922500ceab68cfcdb7be6bd) Thanks [@beatzball](https://github.com/beatzball)! - Inline design-token CSS into the SSR `<head>` so `var(--bg-0)` et al. resolve on first paint. Previously `app.ts` imported `tokens.css`, which Vite extracted into a `dist/client/assets/app-<hash>.css` asset that the SSR shell never linked, leaving every served page rendering as unstyled HTML.

- [`e9b68c3`](https://github.com/beatzball/caribou/commit/e9b68c33c32f133f8b0b9173b1b8d45b5f91eb72) Thanks [@beatzball](https://github.com/beatzball)! - Bake design-token CSS into the server bundle at build time. The previous implementation called `readFileSync(require.resolve('@beatzball/caribou-design-tokens/tokens.css'))` at module top-level, which threw `MODULE_NOT_FOUND` in production — the Docker runtime image ships only `dist/`, no `node_modules`, so the workspace package wasn't resolvable. Every page hit that loaded the `[...]` route chunk returned a JSON 500; `/api/health` worked because it's a separate chunk without that import. Fix: `scripts/write-tokens-head.mjs` inlines the CSS into `server/lib/tokens-head.generated.ts` before `litro build`, so the bundle contains a plain string constant.

- [#18](https://github.com/beatzball/caribou/pull/18) [`8ae622a`](https://github.com/beatzball/caribou/commit/8ae622ae02d9b56d85e15113c7998235a750f513) Thanks [@beatzball](https://github.com/beatzball)! - Fix `/@me` to render the signed-in user's own profile.

  The route was running `fetchAccountByHandle('me', …)` server-side against
  the public Mastodon lookup endpoint, which 404s — landing the page in the
  catch branch's "Couldn't load profile @me." stub. `/@me` is auth-required
  per the Plan 3 design (§8.8): the access token lives only in localStorage,
  so the server must never resolve it. Treat `handle === 'me'` as
  auth-required server-side (no public lookup), then on client mount swap
  the placeholder for `<caribou-profile handle="<userKey>">` using the
  active userKey from localStorage. Mirrors `HomePage.maybeSwapToTimeline`.

  Test: `handle.test.ts` asserts `/@me` returns auth-required and never
  calls the public lookup, even when the instance cookie is set.

- [#17](https://github.com/beatzball/caribou/pull/17) [`b371f8d`](https://github.com/beatzball/caribou/commit/b371f8d14fab3d956a884fa36d469fe6bbd79478) Thanks [@beatzball](https://github.com/beatzball)! - Honor `PUBLIC_BASE_URL` when computing the OAuth `redirect_uri`.

  The `/api/signin/start` route used to derive the redirect URI's origin straight from h3's `getRequestURL(event)`, which reads the `Host` header literally. Two problems fell out of that:
  1. **Host-header spoofing.** A direct `curl -H 'Host: evil.example' .../api/signin/start` would register an OAuth app on the upstream Mastodon with `redirect_uri=https://evil.example/api/signin/callback`. State and app-storage keys are scoped per-origin so the legitimate flow keeps working, but the dangling registration is a pre-baked phishing primitive against the real instance.
  2. **Reverse-proxy fragility.** h3's `getRequestURL` only consults `X-Forwarded-Host` when explicitly opted in. Ingress configurations that put the public hostname in `X-Forwarded-Host` and a service name in `Host` would silently break signin.

  The route now reads `process.env.PUBLIC_BASE_URL` first; when set, that string (with any trailing slash stripped) becomes the canonical origin and the request `Host` header is ignored. When the env var is unset — dev:portless, vitest, local development — it falls back to `getRequestURL`, so nothing changes for those flows.

  Production deployments should set `PUBLIC_BASE_URL=https://your-public-host` (e.g. `https://caribou.quest`).

- [#17](https://github.com/beatzball/caribou/pull/17) [`b371f8d`](https://github.com/beatzball/caribou/commit/b371f8d14fab3d956a884fa36d469fe6bbd79478) Thanks [@beatzball](https://github.com/beatzball)! - Quote interpolated attribute slots in Elena templates.

  Elena's compiler recognizes attribute slots only when the preceding static fragment ends with `name="` or `name='`. An unquoted slot (`data-variant=${value}`) compiles to a comment-node placeholder, and the HTML parser swallows that comment marker into the surrounding unquoted attribute value — pulling neighboring attributes into the value as text and producing nonsense attribute names on the element (e.g. `data-variant="style=\"padding:1px"`, `solid=""`, `var(--border);"`).

  The first render uses `replaceChildren()` and tolerates the malformed tree. Subsequent renders go through Elena's morph, which iterates `el.attributes` and calls `setAttribute(name, value)` for each — and throws `InvalidCharacterError: String contains an invalid character` on the first attribute whose name has a `"` or other illegal char. The card stops re-rendering, so timeline updates (banner click → prepend new status, polling fetches that change displayed status references) appear as ghost cards: the post body never updates even though `card.status` is the new object.

  Affected components, all of which now quote every interpolated attribute:
  - `caribou-status-card`: `data-variant`, `src`, `datetime`
  - `caribou-timeline`: `data-index`, `data-status-id`, `href` (sentinel)
  - `caribou-thread`: `data-id`, `data-depth`
  - `caribou-profile`: `data-index`, `data-status-id`
  - `caribou-profile-header`: `style` (banner background-image), `src` (avatar)
  - `caribou-nav-rail`: `href`
  - `caribou-right-rail`: `href`

  The Firefox banner-click test in `home.spec.ts` was the canary — it triggered exactly the second-render path that morphs and serializes attributes. Chromium is more permissive about the malformed tree but still flaked on the same bug under polling.

  Also fixed an unrelated double-mount race in `home.spec.ts`: the auth-required test was hitting the strict-mode "two `<p>` matched" failure during Litro's atomic-swap window (router pre-renders the new `<page-home>` alongside the SSR'd one with `hidden`, then removes the old after one rAF). Added the existing `waitForSingleMount` helper before the visibility assertion.

- [`fcf5578`](https://github.com/beatzball/caribou/commit/fcf55789c822188b79d31f20da1ca26ba66cd01d) Thanks [@beatzball](https://github.com/beatzball)! - Move `caribou-status-card` to shadow DOM and harden avatar loading.

  `static shadow = 'open'` walls the rendered article off from the parent timeline's morph engine. The bug we fixed by hand in PR #13 (parent re-render → Elena's `morphContent` recurses into the card's light DOM → wipes the rendered tree → avatars re-fetch and flicker) becomes structurally impossible — `parent.childNodes` only sees light DOM, and the platform's tree model never crosses a shadow boundary. CSS custom properties (`var(--bg-0)` etc.) inherit through shadow boundaries, so the design tokens still apply.

  Three companion improvements while we're touching the `<img>`:
  - `loading="lazy" decoding="async"` so off-screen avatars don't fetch on initial render — long timelines feel materially faster.
  - One-shot `error` listener that retries the avatar twice (300ms / 600ms backoff) when a transient `ERR_CONNECTION_CLOSED` truncates the response, then dims the slot if it still fails. Resets the retry budget when the URL changes.
  - The `.status-content` wrap rules that used to live in `tokens.css` are now adopted onto the shadow root via Elena's `static styles`, since global CSS no longer reaches inside.

  Side effects in `caribou-home-timeline`: dropped the `card.children.length === 0` recovery branch from `updated()`. With shadow DOM the card never has light-DOM children, so that branch was always-true and would have triggered an unnecessary re-render every time the timeline updated. Banner fallback retained — the banner is still a light-DOM component.

  The `landing.spec.ts` "submitting the picker" test gained a `waitForFunction(() => mains === 1)` guard before the form interaction, matching what the banner test already had — the Litro double-mount race surfaces much more readily on Firefox than Chromium.

- [`8b4d3e1`](https://github.com/beatzball/caribou/commit/8b4d3e100088c798ab6a94bf36421c4b2d06197c) Thanks [@beatzball](https://github.com/beatzball)! - Stop the home timeline from re-rendering on every poll tick.

  Each `cacheStatus()` call writes a new Map to the global `statusCache` signal, which made the store's `statuses` computed return a new array reference even when the displayed status IDs hadn't changed. `caribou-home-timeline` was subscribed to that array, so every poll caused a full timeline re-render → Elena's `morphContent` recursed into every `<caribou-status-card>`, wiped its `<article>`, and the browser fetched every avatar fresh (visible flicker on profile images).

  Three changes together:
  - `newPostsCount` is pushed into `<caribou-new-posts-banner>` via a dedicated `effect`, so a poll that only changes that signal doesn't invalidate the timeline's render at all.
  - The remaining bindings (`statuses`/`loading`/`errorMsg`) use a shallow-equality check so the timeline only re-renders when displayed status references actually change.
  - As a safety net for the cases that _do_ re-render (loadMore, applyNewPosts), `updated()` calls `requestUpdate()` on any child whose light DOM was emptied by Elena's morph (whose recursion into custom-element children is the structural cause of the wipe).

  Regression test in `feed.spec.ts` tags every avatar `<img>` pre-poll and asserts every node survives the poll.

- Updated dependencies [[`8b4d3e1`](https://github.com/beatzball/caribou/commit/8b4d3e100088c798ab6a94bf36421c4b2d06197c), [`fcf5578`](https://github.com/beatzball/caribou/commit/fcf55789c822188b79d31f20da1ca26ba66cd01d), [`b371f8d`](https://github.com/beatzball/caribou/commit/b371f8d14fab3d956a884fa36d469fe6bbd79478), [`b371f8d`](https://github.com/beatzball/caribou/commit/b371f8d14fab3d956a884fa36d469fe6bbd79478), [`b371f8d`](https://github.com/beatzball/caribou/commit/b371f8d14fab3d956a884fa36d469fe6bbd79478), [`b371f8d`](https://github.com/beatzball/caribou/commit/b371f8d14fab3d956a884fa36d469fe6bbd79478), [`8b4d3e1`](https://github.com/beatzball/caribou/commit/8b4d3e100088c798ab6a94bf36421c4b2d06197c)]:
  - @beatzball/caribou-auth@0.0.2
  - @beatzball/caribou-design-tokens@0.1.0
  - @beatzball/caribou-mastodon-client@0.1.0
  - @beatzball/caribou-state@0.1.0
  - @beatzball/caribou-ui-headless@0.1.0

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
