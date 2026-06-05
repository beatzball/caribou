# caribou-elena

## 0.1.2

### Patch Changes

- [#25](https://github.com/beatzball/caribou/pull/25) [`28b62b5`](https://github.com/beatzball/caribou/commit/28b62b5a85a701e281525aa740cbd823ea42a8e7) Thanks [@beatzball](https://github.com/beatzball)! - `<caribou-list-mount>` moves into caribou-elena as an Elena component (`shadow: 'open'`, DSD-aware). It accepts an `items` attribute that `unsafeHTML`-injects pre-rendered `<li data-key>` children into the shadow `<ul>`. The previous behavior (empty shadow UL populated only by the imperative reconciler) is preserved on the client; the new SSR path emits the full populated list so first paint of `/local` and `/public` shows cards instead of an empty structural shell.

  `<caribou-timeline>` now serializes its SSR-known statuses via a new `_render-status-li.ts` helper and passes the result through `items`. The keyed reconciler's existing SSR-emitted-children contract picks up the `<li data-key>` children on hydration and rebinds `card.status` per item (one reassignment per card on first paint; steady-state polls remain no-ops, preserving the avatar-no-refetch invariant).

  `<caribou-status-card>`'s render path now gates `DOMPurify.sanitize` behind `typeof window !== 'undefined'` — the SSR shim has no `window`, so the card trusts content the server pre-sanitized at the boundary (in `pages/local.ts` and `pages/public.ts`'s pageData fetchers, via a jsdom-backed sanitize). Client-side re-sanitizes as defense-in-depth for poll-fetched content that arrives via the browser-side masto.js, not the server.

  `<caribou-profile>` and `<caribou-thread>` still render an empty `<caribou-list-mount>` and populate it imperatively via the reconciler on client hydration. Their SSR-paint flash fix lands in follow-up PRs (richer `<li>` shapes — profile carries variant/data-status-id; thread carries data-depth + tree ordering — need their own serializers).

  Plan 3 Exit Criterion #8 (no-JS smoke test sees cards on `/local`) now passes in the spirit, not just the letter. Verified via a new `tests/e2e/no-js-public-timeline.spec.ts` (skipped in CI per the upstream-network policy).

- Updated dependencies [[`28b62b5`](https://github.com/beatzball/caribou/commit/28b62b5a85a701e281525aa740cbd823ea42a8e7)]:
  - @beatzball/caribou-ui-headless@0.2.1

## 0.1.1

### Patch Changes

- [#23](https://github.com/beatzball/caribou/pull/23) [`bfb8307`](https://github.com/beatzball/caribou/commit/bfb83071166824e7982992897d9dfc489572ff3a) Thanks [@beatzball](https://github.com/beatzball)! - Wrap every shell `<a href>` (nav-rail Home/Local/Public/Profile, right-rail Privacy/About, auth-required Sign-in, per-route Retry, blog navigation) in a composite `<litro-link>`. Clicks now SPA-navigate via `LitroRouter.go(href)` instead of triggering full document reloads. The `<a>` stays in light DOM at each call site so link-hint extensions, screen readers, and keyboard focus traversal see anchors normally.

  Also fixes a pre-existing tagName collision between `/` (landing) and `/home` (auth shell): Litro's path-to-route conversion used to map both `pages/index.ts` and `pages/home.ts` to `componentTag: 'page-home'` (via a special case `index → home`). Elena's `defineElement` is first-define-wins, so the silent collision bound both routes to whichever page module imported first. The Litro patch changes the special case to `index → index` so `pages/index.ts` derives `page-index` while `pages/home.ts` keeps `page-home`. `/` and `/home` now SSR distinct components and SPA-nav between them works.

  Depends on a `pnpm patch` of `@beatzball/litro@0.9.1` that rewrites Elena's `LitroLink` to a composite (no-render / no-shadow) shape and tweaks `fileToComponentTag`. Upstream PRD at `docs/superpowers/specs/2026-05-25-litro-link-composite-upstream-prd.md`.

  GitHub external link, signout POST form, and shadow-DOM component DSD emission from PR #22 are unchanged.

- [#22](https://github.com/beatzball/caribou/pull/22) [`d18dfc6`](https://github.com/beatzball/caribou/commit/d18dfc630b6169919b78622df44ade952c8b61a6) Thanks [@beatzball](https://github.com/beatzball)! - Patch `@beatzball/litro@0.9.1` so the Elena SSR adapter emits Declarative Shadow DOM for shadow-DOM custom elements and preserves the host's original light-DOM children for native `<slot>` composition. Previously the adapter emitted the host's render template as light-DOM children and dropped the page's slotted content, leaving a literal `<slot></slot>` in the response and an empty pre-hydration shell on every cross-route navigation. The patch lives in `patches/@beatzball__litro@0.9.1.patch`; the same fix is queued for upstream submission (see `docs/superpowers/specs/2026-05-12-elena-ssr-dsd-emission-upstream-prd.md`).

  User-visible: pre-hydration HTML for `/local`, `/public`, `/home`, `/@me`, profile, and thread routes now shows the route's actual content (or `<caribou-auth-required>` placeholder) instead of a bare shell. Plan 3 §12.6's byte-equal hydration parity guarantee becomes operative in production rather than just in the isolated helper.

- [#19](https://github.com/beatzball/caribou/pull/19) [`4fb1e61`](https://github.com/beatzball/caribou/commit/4fb1e61edd8961ad9c1f87f05cc157fa44ed1034) Thanks [@beatzball](https://github.com/beatzball)! - Switch `<caribou-timeline>`, `<caribou-profile>`, and `<caribou-thread>` to render via `<caribou-list-mount>` + `reconcileKeyedList` (both from `@beatzball/caribou-ui-headless`). The mount provides a shadow-DOM container that's morph-opaque (Elena's `morphContent` would otherwise wipe `<li>` children when the host's template emits the wrapping `<ul>` empty); the helper diffs the mount's inner `<ul>` by `status.id`. Cards keep object identity across polls, `loadMore`, and `applyNewPosts` — `caribou-status-card.status` no longer fires the setter on surviving cards, eliminating the avoidable card-internal re-renders that contributed to avatar flicker and lost scroll position under load.

  Pure refactor; no user-facing UI changes. Plan 3 §11.1a deferred follow-up.

- [#24](https://github.com/beatzball/caribou/pull/24) [`0424963`](https://github.com/beatzball/caribou/commit/0424963ea05c8ca89e4f94c3a647118b2055b3c2) Thanks [@beatzball](https://github.com/beatzball)! - Fix the signout-state inversion bug and the post-signout UX. Before: clicking sign out cleared the `caribou.instance` cookie (server-side) but left `localStorage.caribou.activeUserKey` untouched (client-side); the page didn't refresh; the right-rail kept showing "Signed in to fosstodon.org · Sign out". Result was inverted from intent — `/local` and `/public` showed auth-required (cookie gone) while `/home` and `/@me` still rendered real content (stale localStorage swap), and the shell chrome lied about session state.
  - Server (`server/routes/api/signout.post.ts`) no longer calls `clearInstance`. The `caribou.instance` cookie is a non-sensitive hostname preference and persists across sessions, so `/local` and `/public` keep working post-signout.
  - New `<caribou-signout-form>` composite wrapper (light-DOM, no render, no shadow — same shape as `<litro-link>`) preventDefaults the native POST, calls `removeActiveUser()` from `@beatzball/caribou-state`, fires `/api/signout` via fetch, then `location.replace('/')` so the user lands on the landing/picker with a clean SSR render — no stale timeline or signed-in chrome left in the DOM. Wired into both nav-rail and right-rail signout forms.
  - Both shell rails now subscribe to the `activeUserKey` signal on connect and reflect a `signed-out` attribute on the host. Shadow CSS gates the visible chrome: nav-rail hides `<caribou-signout-form>`; right-rail swaps "Signed in to X · Sign out" for a passive "Browsing X" label. SSR default is the signed-in chrome (the common case for users with the cookie); hydration may downgrade.
  - New `base-head.ts` injects a global `litro-link { display: contents }` rule into every SSR'd page's `<head>`, removing the per-consumer footgun where light-DOM consumers (auth-required, retry, blog) silently lacked the layout-invisible declaration that shadow-DOM consumers had inline.
  - `getInstance()` now looks up the OAuth-app registry by hostname only (`apps:${host}:`), not hostname+origin. Same SSRF amplification mitigation (cookie hostname must be in the registry before any server-side fetch fires), but stops invalidating across origin changes (dev port swaps, prod redeploys). With this, `/local` and `/public` render their feeds from the cookie alone — no need to keep an active session — which is the intended "Caribou remembers your chosen instance" behavior.
  - `/local` and `/public` pass SSR-fetched statuses to `<caribou-timeline>` via an `initial` attribute (JSON-stringified). The previous `updated()` hook fired after children had already created their stores without initial data, and Elena SSR doesn't fire `connectedCallback`/`updated()` at all — so the timeline silently rendered "No posts yet." even when serverData had 20 statuses. Elena's SSR JSON-parses object-typed attrs, so the prop is populated on both SSR (used as a render-time fallback for the shell structure) and client hydration (used by `connectedCallback` when seeding the timeline store).

  E2E covers the post-signout state: cookie persists, localStorage cleared, browser lands on `/`. Additional local-only e2e (`public-timeline.spec.ts`, skipped in CI) verifies `/local` and `/public` render actual status cards from the cookie-instance.

- Updated dependencies [[`4fb1e61`](https://github.com/beatzball/caribou/commit/4fb1e61edd8961ad9c1f87f05cc157fa44ed1034)]:
  - @beatzball/caribou-ui-headless@0.2.0

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
