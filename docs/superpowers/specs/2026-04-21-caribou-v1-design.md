---
title: Caribou v1 — Design Spec
date: 2026-04-21
status: approved, ready for implementation planning
---

# Caribou v1 — Design Spec

## 1. Summary

Caribou is a Mastodon client, the first app in a new monorepo at the repo root, shipping to **caribou.quest**. It is modeled after [Elk](https://github.com/elk-zone/elk) but built on [Litro](https://github.com/beatzball/litro) (web components + Nitro) using the **Elena** adapter. Two sibling apps — `caribou-lit` and `caribou-fast` — are planned later as parallel implementations on the Lit and FAST adapters. Accordingly, almost all non-UI code lives in adapter-agnostic `packages/*`.

The v1 scope is a single-account, single-instance Mastodon client with core timelines, interactions, bookmarks, lists, hashtags, and a dark-default theme. No PWA, no push, no streaming, no search, no i18n, no rich editor in v1. The multi-account *data model* is designed in from day one; only the UI is single-account.

Deployment: Coolify on self-hosted infra, Nitro `node-server` preset, Dockerfile, persistent volume for OAuth app credentials.

---

## 2. Scope

### 2.1 In scope (v1)

- **Auth:** single-account, single-instance. OAuth via server-side app-registration proxy so any Mastodon instance works without hardcoded credentials.
- **Timelines:** home (following feed), local (user's instance public posts), public (federated — posts from every instance the user's instance is aware of); each with polling refresh and a "N new posts above" banner (not auto-prepend).
- **Status + thread views** with ancestors/descendants.
- **Account profile views** (posts / with-replies / media).
- **Interactions:** favourite, boost, reply, follow/unfollow (all optimistic with rollback).
- **Compose:** plain `<textarea>` with character count, content-warning (CW) toggle, visibility selector, media upload (image/video), alt-text editing. Presented as a global dialog, not a route.
- **Notifications:** list view with type filter, polled every 60 s while tab visible; unread badge via `lastSeenId`.
- **Bookmarks:** list view.
- **Lists:** list timelines and full CRUD (create, rename, delete, add/remove members).
- **Hashtags:** hashtag timelines.
- **Settings:** theme (dark/light/system; dark is default), default timeline, account management.
- **Theme:** dark-default, light opt-in, system-follow option. Applied via `data-theme` attribute on `<html>`.
- **Changelog:** public `/changelog` page driven by the app's `CHANGELOG.md`, with unread-indicator dot.

### 2.2 Out of scope in v1 — planned later

- PWA (manifest, service worker, Workbox precache)
- Web Push (VAPID subscription + encrypted payload decryption in SW)
- Streaming WebSocket timelines
- Search (accounts, tags, statuses)
- DMs (as a distinct view)
- Rich editor (Tiptap or equivalent)
- i18n / multi-locale
- Multi-account *UI* (data model is already multi-account)
- `apps/caribou-lit` and `apps/caribou-fast` sibling adapter-variant apps
- Sentry or server-side error tracking
- Nonce-based script CSP
- Per-package changelog aggregation in the app UI

### 2.3 Non-goals

- **Feature parity with Elk.** Elk has ~3 years of polish; Caribou is not attempting to match that in v1.
- **A reusable Mastodon component library.** Components are authored per adapter; only headless logic and data layers are shared.
- **A Twitter alternative for a general audience.** Caribou is a daily-driver for its author; rough edges are tolerable.

---

## 3. Context and references

- **Elk** ([elk-zone/elk](https://github.com/elk-zone/elk), local checkout available) — Nuxt 4 + Vue 3 + UnoCSS hybrid SSR/SSG Mastodon client. Reference for: OAuth proxy pattern, browser-direct API model, composables-over-Pinia state style, storage key conventions, PWA architecture (for Phase 2), compose UX.
- **Litro** ([beatzball/litro](https://github.com/beatzball/litro), local checkout available) — `@beatzball/*` web-components + Nitro framework. pnpm monorepo with adapters (Lit / FAST / Elena), file-based routing via URLPattern, SSR/SSG modes via `LITRO_MODE` env. Scaffolder: `pnpm create @beatzball/litro`.
- **Elena** — light-DOM web-component authoring library used by Litro. Key characteristics: no shadow DOM, no hydration step, `static props = []`, `html` template literal, `ComponentClass.define()`. Components upgrade in place after SSR.
- **masto** v7.x — framework-agnostic TypeScript Mastodon API client. REST + streaming. Used by Elk.

---

## 4. Key decisions — at a glance

| Area | Decision |
|---|---|
| Monorepo tooling | pnpm workspaces only for v1 (topological ordering + `--filter "...[origin/<base>]"` give us affected-graph runs for free). Adopt **Turborepo** when any trigger hits: cold CI > ~5 min, sibling `apps/caribou-lit` / `apps/caribou-fast` apps land (Phase 3), or remote caching is needed. Migration cost: add `turbo.json`, swap `pnpm -r <task>` → `turbo run <task>` in root scripts; no package-level changes. Nx / Lerna / Lage rejected: Nx too opinionated for 7 packages, Lerna effectively superseded by Nx + Changesets, Lage community too small. |
| Directory naming | `apps/caribou-elena` (adapter suffix even for the primary, so Lit/FAST siblings are symmetric). |
| Package scope | `@beatzball/caribou-*` for all workspace-private packages. |
| First app scaffold | `pnpm create @beatzball/litro@latest caribou-elena --recipe fullstack --adapter elena --mode ssr`. |
| Reactivity primitive | `@preact/signals-core`, wrapped in thin store APIs. Fallback to `nanostores` if signals prove awkward. TDD-tested. |
| Styling | Force light DOM in all three adapter variants. UnoCSS + `@beatzball/caribou-design-tokens` CSS custom properties. |
| Deployment | Self-hosted Coolify, Nitro `node-server` preset, `node:22-alpine` Dockerfile, `/data` persistent volume for OAuth app cache via `unstorage` fs driver. |
| Rendering | SSR everywhere except prerendered public routes (`/`, `/signin/done`, `/changelog`). |
| Mastodon API | `masto` wrapped as `@beatzball/caribou-mastodon-client` with account-scoped client factory. |
| State data model | Multi-account-shaped (`Map<UserKey, UserSession>`), size-1 in v1. No consumer rewrites to enable multi-account later. |
| OAuth redirect | Token returned in URL fragment (never in query). Never logged. |
| CI/CD | GitHub Actions: typecheck + lint + unit (Vitest) + E2E (Playwright on Chromium/Firefox/WebKit with axe). Deploy = Coolify webhook on main. |
| Testing | Vitest + happy-dom (units/integration/components), Playwright (E2E), MSW (shared Mastodon fixture), `@axe-core/playwright` (a11y gate). TDD on `state`, `auth`, `mastodon-client` packages. |
| Versioning | Changesets from day one. `privatePackages: { version: true, tag: true }` for currently-unpublished packages. In-app `/changelog` surfaces the app's generated CHANGELOG.md. |
| Git workflow | `main` is the only long-lived branch. All work in disposable worktrees (`superpowers:using-git-worktrees`), squash-merged. PRs must include a changeset (or explicit `--empty`). |
| Local dev | Portless-compatible out of the box. Scaffolded `dev:portless` / `preview:portless` scripts inherit from the Litro `fullstack` recipe; Litro's CLI honours the `PORT` env var injected by Portless. Stable HTTPS origin makes OAuth round-trips against real Mastodon instances work locally. |

---

## 5. Architecture overview

### 5.1 Shape

```
┌──────────────────┐     HTTPS (OAuth only)    ┌──────────────────────┐
│  Browser (Elena  │ ◄──────────────────────► │  Caribou server      │
│  light-DOM       │                           │  Nitro / Node 22     │
│  components)     │                           │  on Coolify          │
│                  │                           │  ┌────────────────┐  │
│                  │                           │  │ fs unstorage   │  │
│                  │                           │  │ volume /data   │  │
│                  │                           │  │ (OAuth apps)   │  │
└────────┬─────────┘                           │  └────────────────┘  │
         │                                     └──────────┬───────────┘
         │  Mastodon REST                                 │
         │  (browser-direct, Bearer token)                │
         ▼                                                │ HTTPS, POST /apps
┌──────────────────────────────────┐                      │  + /oauth/token
│  User's Mastodon instance        │ ◄────────────────────┘
│  (mastodon.social, fosstodon…)   │
└──────────────────────────────────┘
```

### 5.2 Server responsibilities — exactly three

1. **SSR the app shell.** Every authenticated request renders via Nitro → Elena server-render → HTML streams to the browser. Elena upgrades elements in place (light DOM, no hydration step, no flicker).
2. **OAuth proxy.** On first login for a given (instance, origin) pair, register a Caribou OAuth app via `POST {instance}/api/v1/apps` with `client_name="Caribou"`, `website="https://caribou.quest"`, `redirect_uris="{origin}/api/signin/callback"`, `scopes="read write follow push"`. Cache `{client_id, client_secret, vapid_public_key}` in `/data` with 7-day TTL. Perform the server-side code-for-token exchange so `client_secret` never leaves the server. Redirect the browser to `/signin/done` with the token in the URL **fragment**.
3. **Serve static assets.** Vite-built JS, UnoCSS-extracted CSS, design-token CSS, icons, prerendered HTML for `/`, `/signin/done`, `/changelog`.

Explicitly **not** done by the server: proxying Mastodon data API calls, caching user data, holding sessions, rate limiting, storing secrets beyond the OAuth app cache.

### 5.3 Where state lives

- **localStorage (browser):** user session(s) (`users` map + `activeUserKey`), per-user prefs, compose draft, theme preference.
- **In-memory signals (browser):** timeline pages, status cache, account cache, notification cache, fetch-in-flight tracking. Not persisted; rebuilt per session.
- **`/data` volume (server):** `apps:{instance}:{origin}` entries, short-lived `state:{value}` OAuth CSRF tokens. That is all.

### 5.4 Golden-path request flow — "open /home"

1. Browser requests `/home`. Nitro renders the SSR app-shell HTML (no user-specific data yet — just chrome). Streams HTML.
2. Elena custom elements upgrade in place as the page parses.
3. Client reads `activeUserKey` from localStorage. Missing → redirect to `/`.
4. Present → `<caribou-home>` mounts, subscribes an `effect()` on the `homeTimeline` store.
5. Store fires first fetch: `createCaribouClient(activeUserKey).fetchTimeline('home')`.
6. Response updates the signal; subscribed components re-render via Elena's `update()`.
7. Polling controller starts: while tab visible, fetch `since_id={firstId}` every 30 s; newer statuses go into the `newPosts` buffer, not into the rendered list, surfacing a "N new posts" banner.

### 5.5 Two design assertions

- **Redirect token in fragment, never query.** Fragments are never sent to servers, never logged, never in `Referer`. `history.replaceState` clears them on load.
- **No mid-session instance change.** v1 treats "switching instance" as "log out and back in." This keeps the active-session model trivially stable.

---

## 6. Monorepo structure and packages

### 6.1 Top-level layout

```
caribou/
├── apps/
│   └── caribou-elena/              # v1 target, ships to caribou.quest
├── packages/
│   ├── mastodon-client/            # masto wrapper, account-scoped factory
│   ├── auth/                       # pure OAuth helpers, no I/O
│   ├── state/                      # @preact/signals-core stores, user-scoped
│   ├── design-tokens/              # CSS custom props + UnoCSS preset
│   ├── ui-headless/                # focus-trap, virtual-list, dialog controllers
│   ├── tsconfig/                   # shared tsconfig bases
│   └── eslint-config/              # shared flat config
├── .changeset/
│   └── config.json
├── .github/workflows/
│   ├── ci.yml
│   └── release.yml
├── docs/superpowers/specs/         # design docs
├── .npmrc
├── package.json                    # root: devDeps + scripts
├── pnpm-workspace.yaml
├── tsconfig.json                   # project references only
└── README.md
```

**Convention:** directory names are short (`packages/state`); NPM names are fully qualified (`@beatzball/caribou-state`). Trade noise in file paths for clarity in the package manifest.

### 6.2 Per-package responsibilities

| Package | Purpose | Depends on | Test discipline |
|---|---|---|---|
| `apps/caribou-elena` | Real app: Elena components, pages, server routes, Vite/Nitro/Playwright config, Dockerfile. | all packages below + `@beatzball/litro` + `@elenajs/core` + `masto` + `@preact/signals-core` + `unstorage` + `unocss` | Interaction tests (Vitest + happy-dom); E2E (Playwright + axe + MSW) |
| `@beatzball/caribou-mastodon-client` | `createCaribouClient(userKey)` factory; in-flight dedup; error normalization to `CaribouError`; re-exports commonly-used masto types. | `masto`, `@beatzball/caribou-auth` | **TDD**, Vitest + MSW, ≥ 90% |
| `@beatzball/caribou-auth` | Pure OAuth primitives: `buildAuthorizeUrl`, `generateState` (Web Crypto), `parseCallbackFragment`, `UserKey` type/helpers. No I/O. Works in both server and browser. | none | **TDD**, Vitest, ≥ 95% |
| `@beatzball/caribou-state` | Signal-backed stores (`users`, `activeUserKey`, `activeClient`, timeline/notification/status stores). Thin API wraps signals for swap-to-nanostores. Persistence glue. | `@preact/signals-core`, `@beatzball/caribou-auth` | **TDD**, Vitest, ≥ 95% |
| `@beatzball/caribou-design-tokens` | `tokens.css` (CSS custom properties, `[data-theme="dark"]` default, `[data-theme="light"]` opt-in) + `presetCaribou()` UnoCSS preset mapping utility names to `var(--…)`. | `unocss` (peer) | Snapshot test on preset output |
| `@beatzball/caribou-ui-headless` | Framework-neutral controllers: focus trap, virtual list for timelines, dialog state, click-outside, intersection helpers. | none | Vitest + happy-dom, ≥ 80% |
| `@beatzball/caribou-tsconfig` | `base.json`, `app.json`, `library.json`. Referenced by every package. | none | — |
| `@beatzball/caribou-eslint-config` | Flat config with TS-strict + UnoCSS lint + project conventions. | none | — |

### 6.3 Dependency shape

```
apps/caribou-elena
   ├── @beatzball/caribou-state
   │      └── @beatzball/caribou-auth
   ├── @beatzball/caribou-mastodon-client
   │      └── @beatzball/caribou-auth
   ├── @beatzball/caribou-design-tokens
   ├── @beatzball/caribou-ui-headless
   └── @beatzball/litro + @elenajs/core (external)
```

Flat and shallow, no cycles. `caribou-auth` is the only package two others depend on, and has zero runtime dependencies.

### 6.4 Workspace configuration

**`pnpm-workspace.yaml`:**
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

**`.npmrc`:**
```
strict-peer-dependencies=true
auto-install-peers=false
shamefully-hoist=false
```
Strict pnpm — no phantom deps. When Lit/FAST variants land they'll catch any accidental hoist reliance immediately.

**Root `package.json` scripts:**
```json
{
  "name": "caribou",
  "private": true,
  "packageManager": "pnpm@10.28.0",
  "scripts": {
    "dev": "pnpm --filter caribou-elena dev",
    "dev:portless": "pnpm --filter caribou-elena dev:portless",
    "build": "pnpm -r build",
    "preview": "pnpm --filter caribou-elena preview",
    "preview:portless": "pnpm --filter caribou-elena preview:portless",
    "test": "pnpm -r test",
    "test:coverage": "pnpm -r test:coverage",
    "test:e2e": "pnpm --filter caribou-elena test:e2e",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint",
    "format": "prettier --write ."
  }
}
```

### 6.5 Initial scaffolding command

```bash
# from the repo root
# after setting up pnpm-workspace.yaml + root package.json
cd apps
pnpm create @beatzball/litro@latest caribou-elena \
  --recipe fullstack \
  --adapter elena \
  --mode ssr
```

After scaffolding:

1. Remove the scaffolded `.git/`, standalone lockfile, and root-level scripts that duplicate ours.
2. Adjust the scaffolded `package.json`: `"name": "caribou-elena"`, dependencies pointing at workspace packages where applicable (`"@beatzball/caribou-state": "workspace:*"`, etc.).
3. Keep the scaffolded `dev:portless` and `preview:portless` scripts (see §6.6).
4. Run `pnpm install` from the repo root so the workspace picks it up.

### 6.6 Local dev workflow — Portless-friendly

The Litro `fullstack` recipe scaffolds `dev:portless` and `preview:portless` into `apps/caribou-elena/package.json`:

```json
{
  "scripts": {
    "dev": "litro dev",
    "dev:portless": "portless run litro dev",
    "preview": "litro preview",
    "preview:portless": "portless run litro preview"
  }
}
```

We keep all four and forward them from the repo root (see §6.4).

**Why this matters for Caribou specifically.** Mastodon OAuth apps are registered with an exact-match `redirect_uris` value, and most instances (including `mastodon.social`) reject plain `http://localhost` redirects. `pnpm dev:portless` gives a stable HTTPS URL (e.g. `https://caribou-dev.portless.dev`) that every Mastodon instance accepts, so the full browser → server → instance → browser OAuth round-trip works locally against real instances.

**Why no code changes are needed:**

- Litro's CLI already reads `PORT` from env (Portless injects it) and logs `PORTLESS_URL` on startup — inherited by Caribou automatically.
- The server derives `origin` from the incoming request's `Host` header, so during a Portless run `origin` is naturally the Portless URL.
- The OAuth app cache key is `apps:{instance}:{origin}` (§7.3), so a Portless session registers its own app entries without colliding with localhost or production entries on the same `/data` volume.
- `redirect_uris` passed to `POST /api/v1/apps` is computed from the same origin, so Mastodon's exact-match check passes.

**When to use which script:**

- `pnpm dev` — normal loopback dev (hot-reload), fine for non-auth UI work.
- `pnpm dev:portless` — whenever you're touching auth, testing OAuth against a real instance, or sharing a preview URL.
- `pnpm preview:portless` — sanity-check the production build end-to-end before opening a PR.

---

## 7. Authentication flow

### 7.1 Sequence — successful login

```
Browser                     Caribou server                   Mastodon instance
   │                              │                                 │
 1 │  GET /                       │                                 │
   │─────────────────────────────►│ (prerendered, static)           │
   │◄─────────────────────────────│                                 │
   │                              │                                 │
 2 │ User enters "mastodon.social"│                                 │
   │  POST /api/signin/start      │                                 │
   │  {server, origin}            │                                 │
   │─────────────────────────────►│ 3a  cache MISS for              │
   │                              │     apps:{server}:{origin}      │
   │                              │──── POST {server}/api/v1/apps──►│
   │                              │◄──── {client_id, client_secret, │
   │                              │         vapid_key} ─────────────│
   │                              │  store 7d in /data/apps:…       │
   │                              │                                 │
   │                              │ 3b  generate state, store       │
   │                              │     state:{value} → {server,    │
   │                              │     origin} TTL 10 min          │
   │                              │                                 │
   │  { authorizeUrl }            │                                 │
   │◄─────────────────────────────│                                 │
   │                              │                                 │
 4 │ window.location = authorizeUrl                                  │
   │───────────────────────────────────────────────────────────────►│
   │                              │        user clicks "Authorize"  │
   │◄───────────────────────────────────────────────────────────────│
   │  GET /api/signin/callback?code=…&state=…                        │
   │                              │                                 │
 5 │─────────────────────────────►│  lookup state → {server,origin} │
   │                              │  lookup apps:{server}:{origin}  │
   │                              │──── POST {server}/oauth/token ─►│
   │                              │◄──── {access_token} ────────────│
   │                              │──── GET  {server}/api/v1/       │
   │                              │      accounts/verify_creds ────►│
   │                              │◄──── {Account} ─────────────────│
   │                              │  delete state:{value}           │
   │  302 /signin/done#token=…    │                                 │
   │       &server=…&vapid=…      │                                 │
   │       &userKey=…             │                                 │
   │◄─────────────────────────────│                                 │
   │                              │                                 │
 6 │  GET /signin/done (prerendered, ~30 LOC inline JS)              │
   │ - parse location.hash                                           │
   │ - write session to localStorage                                 │
   │ - history.replaceState("","","/")                               │
   │ - window.location = "/home"                                     │
```

### 7.2 Server routes

| Method | Path | Responsibility |
|---|---|---|
| `POST` | `/api/signin/start` | Ensure OAuth app cached for `{server, origin}`; generate + store `state`; return `{authorizeUrl}`. |
| `GET` | `/api/signin/callback` | Consume `state`; look up app creds; exchange `code` → `access_token`; call `verify_credentials`; 302 to `/signin/done#…` with token/server/vapid/userKey in fragment. Handles `?error=` from Mastodon. |
| `GET` | `/signin/done` | Prerendered HTML + ~30 LOC inline JS. Parses fragment, writes to localStorage, cleans URL, navigates to `/home`. |
| `GET` | `/api/health` | `{ status: 'ok', version: <git-sha> }`. Coolify health probe. |

### 7.3 Server cache shape

One `unstorage` instance, fs driver, base `/data`:

```
apps:{server}:{origin}
    → { client_id, client_secret, vapid_key, registered_at }
    TTL: 7 days (re-register automatic after expiry)

state:{value}
    → { server, origin, createdAt }
    TTL: 10 minutes; deleted on consume (one-time use)
```

`state` token: 32 random bytes from Web Crypto `getRandomValues`, base64url-encoded. Serves as CSRF protection *and* as the lookup key for server/origin context through the redirect round-trip.

Because the cache key includes `origin`, the same `/data` volume cleanly holds separate registrations for localhost, Portless (§6.6), and production without collisions, and a stale or revoked app for one origin never affects the others.

### 7.4 Client session shape (localStorage)

```ts
type UserKey = `${string}@${string}`   // "handle@instance.tld"

interface UserSession {
  userKey: UserKey
  server: string        // "mastodon.social" (no scheme)
  token: string         // Mastodon access token (long-lived, opaque)
  vapidKey: string      // stored for future push; unused in v1
  account: Account      // verify_credentials result
  createdAt: number     // ms epoch
}
```

localStorage keys (all prefixed `caribou.` to avoid cross-app collisions):

```
caribou.users            → entries-array of Map<UserKey, UserSession>
caribou.activeUserKey    → UserKey | null
caribou.prefs.{UserKey}  → { theme, defaultTimeline, lastSeenChangelogVersion, … }
caribou.drafts.{UserKey} → { text, inReplyToId?, cw?, visibility?, mediaDrafts? }
```

In v1 the `users` map always has exactly one entry. The key-by-UserKey shape is the one and only change needed to enable multi-account later; consumer code is already shaped correctly.

### 7.5 Error paths

| Where | Symptom | Handling |
|---|---|---|
| `/api/signin/start` | Instance unreachable or rejects `/api/v1/apps` | 502; client shows "Couldn't reach {instance}. Check spelling." |
| Mastodon redirect | User clicked "Deny" | Mastodon → `?error=access_denied`; server 302 `/?error=denied`; landing shows "Sign-in was cancelled." |
| `/api/signin/callback` | `state` missing / expired | 302 `/?error=state_mismatch` |
| `/api/signin/callback` | Token exchange non-2xx | 302 `/?error=exchange_failed&instance=…` |
| `/api/signin/callback` | `verify_credentials` fails | 302 `/?error=verify_failed` |
| `/signin/done` | Fragment parse fails | Inline error + link back to `/` |
| Any authenticated call | 401 from instance | Global fetch interceptor clears session, routes to `/?error=unauthorized` |

The landing page displays a human message for each `?error=…` code and strips it from the URL on mount so refreshing doesn't re-show it.

### 7.6 Sign-out

- Delete `users[activeUserKey]`; clear `activeUserKey`.
- Clear per-user keys (`caribou.prefs.{UserKey}`, `caribou.drafts.{UserKey}`).
- `window.location = "/"`.
- No server call. Optional future improvement: `POST {server}/oauth/revoke`.

### 7.7 Token refresh

Mastodon access tokens are long-lived opaque tokens with no refresh flow. The only invalidation path is user-initiated revocation from instance settings, detected by a 401 and handled by the global interceptor described above.

### 7.8 Requested OAuth scopes

`"read write follow push"` — granted at app registration time. `push` is requested now (even though unused in v1) so users don't have to re-authorize when Phase 2 ships push notifications. `follow` is technically a subset of `write` on most instances but remains explicit for clarity.

---

## 8. Data layer, state, and UX

### 8.1 Mastodon client wrapper (`@beatzball/caribou-mastodon-client`)

```ts
export function createCaribouClient(userKey: UserKey): CaribouClient
// memoized per UserKey; disposed on sign-out.

export interface CaribouClient {
  userKey: UserKey
  rest: mastodon.rest.Client

  // Convenience layer: in-flight dedup + error normalization.
  fetchTimeline(kind: TimelineKind, params?): Promise<Status[]>
  fetchNotifications(params?): Promise<Notification[]>
  fetchStatus(id: string): Promise<Status>
  fetchThread(id: string): Promise<{ ancestors: Status[]; descendants: Status[] }>

  // Mutations
  favourite(id: string): Promise<Status>
  unfavourite(id: string): Promise<Status>
  reblog(id: string, visibility?: Visibility): Promise<Status>
  unreblog(id: string): Promise<Status>
  follow(acctId: string): Promise<Relationship>
  unfollow(acctId: string): Promise<Relationship>
  bookmark(id: string): Promise<Status>
  unbookmark(id: string): Promise<Status>

  createStatus(params): Promise<Status>
  uploadMedia(file: File, onProgress?): Promise<MediaAttachment>
  updateMediaAlt(id: string, description: string): Promise<MediaAttachment>
}

export class CaribouError extends Error {
  code: 'unauthorized'|'not_found'|'rate_limited'|'unreachable'|'server_error'|'unknown'
  retryAfter?: number  // parsed from Retry-After header on 429
}
```

**In-flight dedup** keyed on the call signature, so two simultaneous home-timeline fetches return the same promise.

**Error normalization** maps masto's thrown `HttpError`s and network failures to `CaribouError` codes.

**401 interceptor** lives inside `createCaribouClient`: any throw with code `unauthorized` clears the session and routes to `/?error=unauthorized`.

### 8.2 Store architecture (`@beatzball/caribou-state`)

Three layers stacked:

```
1. Root user stores   (users, activeUserKey)
         │
2. Canonical caches   (statusCache, accountCache)
         │
3. View stores        (timelines, notifications, compose, thread)
```

**Layer 1 — Users**

```ts
export const users = signal<Map<UserKey, UserSession>>(new Map())
export const activeUserKey = signal<UserKey | null>(null)

export const activeUser = computed(() => {
  const key = activeUserKey.value
  return key ? users.value.get(key) ?? null : null
})

export const activeClient = computed(() =>
  activeUser.value ? createCaribouClient(activeUser.value.userKey) : null)
```

**Layer 2 — Canonical caches** (flat, id-keyed)

```ts
export const statusCache  = signal<Map<string, Status>>(new Map())
export const accountCache = signal<Map<string, Account>>(new Map())
```

Mutations always update the cache; views derive from the cache. Unbounded in v1 (realistically < 1 k items per session). If memory ever matters, bolt on LRU — consumer API won't change.

**Layer 3 — View stores** (factory-created)

```ts
export function createTimelineStore(
  kind:
    | 'home' | 'local' | 'public' | 'bookmarks'
    | { type: 'hashtag'; tag: string }
    | { type: 'list'; id: string },
  opts?: { pollIntervalMs?: number }
): TimelineStore

export interface TimelineStore {
  statusIds:      ReadonlySignal<string[]>    // references statusCache
  statuses:       ReadonlySignal<Status[]>    // computed through cache
  loading:        ReadonlySignal<boolean>
  error:          ReadonlySignal<CaribouError | null>
  hasMore:        ReadonlySignal<boolean>
  newPosts:       ReadonlySignal<Status[]>    // "N new posts" buffer
  newPostsCount:  ReadonlySignal<number>

  load():         Promise<void>
  loadMore():     Promise<void>
  applyNewPosts(): void
}
```

**"New posts above" banner:** polling fetches `?since_id={firstId}` every 30 s while tab visible. Returned statuses go into `newPosts`, not `statuses`. Banner shows `newPostsCount`. Click → `newPosts` prepends to `statuses`, scroll-to-top, counts reset. Avoids the scroll-jumping UX problem.

**Notifications store** — same shape, polls `/api/v1/notifications` every 60 s while visible. Unread badge derived by comparing against `lastSeenId` persisted per-user.

**Compose store** — single global (one compose at a time, per Elk):

```ts
interface ComposeState {
  text: string
  visibility: 'public'|'unlisted'|'private'|'direct'
  sensitive: boolean
  spoilerText: string
  inReplyToId: string | null
  mediaDrafts: MediaDraft[]
  // MediaDraft: { file, previewUrl, altText, uploadStatus, mediaId }
}
```

Media upload is two-phase (Mastodon's async media API): `POST /api/v2/media` returns 202 with `id`; we poll `GET /api/v1/media/{id}` every 1 s for up to 30 s or until it returns 200. `createStatus` requires every draft to have a `mediaId`.

Draft is persisted (debounced 500 ms) to `caribou.drafts.{UserKey}`.

### 8.3 Mutations — optimistic with rollback

```ts
export async function favouriteStatus(id: string) {
  const current = statusCache.value.get(id)
  if (!current || !activeClient.value) return
  const wasFavd = current.favourited

  updateCache(id, {
    favourited: !wasFavd,
    favouritesCount: current.favouritesCount + (wasFavd ? -1 : 1),
  })

  try {
    const fresh = wasFavd
      ? await activeClient.value.unfavourite(id)
      : await activeClient.value.favourite(id)
    cacheStatus(fresh)
  } catch (err) {
    updateCache(id, current)
    showToast({ kind: 'error', message: 'Favourite failed — retry?' })
    throw err
  }
}
```

Same pattern for `reblog`/`unreblog`, `bookmark`/`unbookmark`, `follow`/`unfollow`. Because all views derive from the flat cache, one mutation correctly updates every view showing that status.

### 8.4 Persistence / hydration

Only three buckets persist:

- `caribou.users`, `caribou.activeUserKey` — session
- `caribou.prefs.{UserKey}` — theme, default timeline, `lastSeenChangelogVersion`
- `caribou.drafts.{UserKey}` — in-progress compose (debounced writes)

Timelines, canonical caches, notifications are in-memory only; rebuilt each session. Eliminates an entire class of stale-data bugs.

### 8.5 Web-component ↔ signals glue (adapter-agnostic)

```ts
// packages/state/src/bindings.ts
import { effect } from '@preact/signals-core'

export function bindSignals<T extends { update?: () => void; requestUpdate?: () => void }>(
  instance: T,
  read: () => void,
): () => void {
  return effect(() => {
    read()
    ;(instance.update ?? instance.requestUpdate)?.call(instance)
  })
}
```

Elena usage:

```ts
import { html } from '@elenajs/core'
import { LitroPage } from '@beatzball/litro/adapter/elena/page'
import { createTimelineStore, bindSignals } from '@beatzball/caribou-state'

class HomePage extends LitroPage {
  static tagName = 'page-home'
  static props = ['timeline', 'newCount', 'loading']

  timeline: Status[] = []
  newCount = 0
  loading = false

  private store = createTimelineStore('home')
  private dispose?: () => void

  connectedCallback() {
    super.connectedCallback()
    this.dispose = bindSignals(this, () => {
      this.timeline = this.store.statuses.value
      this.newCount = this.store.newPostsCount.value
      this.loading  = this.store.loading.value
    })
    this.store.load()
  }

  disconnectedCallback() {
    this.dispose?.()
    super.disconnectedCallback()
  }

  render() {
    return html`…`
  }
}
HomePage.define()
```

For Lit/FAST variants later, the same pattern with `requestUpdate` instead of `update` — this single file is what enables three adapter variants to share the full state layer.

### 8.6 Theme system

```ts
export const themePref = signal<'dark'|'light'|'system'>('dark')  // default

// app.ts:
effect(() => {
  const resolved = themePref.value === 'system'
    ? matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    : themePref.value
  document.documentElement.setAttribute('data-theme', resolved)
})
```

`tokens.css` in `@beatzball/caribou-design-tokens`:

```css
:root, [data-theme="dark"] { --bg-0: #0d0d12; --fg-0: #e4e4e7; /* … */ }
[data-theme="light"]       { --bg-0: #fafafa; --fg-0: #18181b; /* … */ }
```

UnoCSS preset `presetCaribou()` maps utility names → `var(--token)` so `bg-0` in markup becomes `background-color: var(--bg-0)`.

### 8.7 Polling cadences and visibility

| Store | Interval | Runs when |
|---|---|---|
| Active timeline | 30 s | `document.visibilityState === 'visible'` |
| Notifications | 60 s | `document.visibilityState === 'visible'` |
| Everything else | — | on-demand only |

On `visibilitychange` → `visible`, immediate one-shot refetch of active timeline + notifications.

### 8.8 UX patterns

| Pattern | When |
|---|---|
| **Skeleton list** | Timeline first-load (5 placeholder cards, SSR-rendered so layout is present before JS). |
| **Inline error banner** | Top of failed view, with Retry. Triggered by `error` signal non-null. |
| **Optimistic UI** | Fav, reblog, bookmark, follow — instant feedback; rollback + toast on failure. |
| **Toast** | Mutation errors. 3 s auto-dismiss. `aria-live="polite"`. Stacked. From `caribou-ui-headless`. |
| **Empty state** | Every list view. "No posts yet", "No bookmarks", "No lists". Encourages action where applicable. |
| **Infinite scroll** | Timelines, notifications, thread descendants. `IntersectionObserver` sentinel; disabled when `hasMore` is false. |
| **"New posts" banner** | Timelines. Sticky below sub-header. Click prepends + scroll-to-top. |
| **Focus management** | Route change → focus `<h1>`. Dialog open → focus trap (`caribou-ui-headless`). Dialog close → return focus to trigger. |
| **Changelog unread dot** | Settings icon shows a dot when the latest changelog version > `caribou.prefs.{UserKey}.lastSeenChangelogVersion`. Dot clears on visiting `/changelog`. |

### 8.9 Route table

| Path | Render | Auth |
|---|---|---|
| `/` | prerendered | public (landing + instance picker) |
| `/signin/done` | prerendered | public (fragment-parsing shim) |
| `/changelog` | prerendered (or SSR with cache) | public |
| `/api/signin/start` | server | — |
| `/api/signin/callback` | server | — |
| `/api/health` | server | — |
| `/home` | SSR shell | required |
| `/local` | SSR shell | required |
| `/public` | SSR shell | required |
| `/notifications` | SSR shell | required |
| `/bookmarks` | SSR shell | required |
| `/lists` | SSR shell | required |
| `/lists/[id]` | SSR shell | required |
| `/tags/[tag]` | SSR shell | required |
| `/@[handle]` | SSR shell | required |
| `/@[handle]/[statusId]` | SSR shell | required |
| `/settings` | SSR shell | required |

### 8.10 Compose — dialog, not a route

Compose lives as a **global dialog** triggered by a floating "new post" button and the `n` keyboard shortcut. It is *not* a route. The draft auto-persists to localStorage so navigation does not lose work. A `/compose` route exists only as a future home for the PWA share-target handler; in v1 it redirects to the previous view and opens the dialog.

---

## 9. Deployment

### 9.1 Dockerfile

```dockerfile
# Stage 1: build
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter caribou-elena build

# Stage 2: runtime (Nitro's .output/ is self-contained)
FROM node:22-alpine AS runtime
RUN apk add --no-cache tini
WORKDIR /app
RUN mkdir -p /data && chown -R node:node /data
COPY --from=builder --chown=node:node /repo/apps/caribou-elena/.output ./.output
USER node
ENV NODE_ENV=production STORAGE_DIR=/data PORT=3000
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", ".output/server/index.mjs"]
```

**Why each piece:**
- `libc6-compat` — cheap insurance against glibc-expecting binaries on Alpine.
- `tini` — proper PID 1 so `SIGTERM` from Coolify triggers Node shutdown cleanly.
- `USER node` + `chown /data` — resolves the `/data` volume ownership gotcha where Docker mounts the volume as root on first create.

Final image is ~70 MB. If a dependency ever pulls in native bindings that misbehave on musl (e.g. `sharp`), switch both stages to `node:22-slim`.

### 9.2 Coolify setup

1. Coolify → *Create New Resource* → *Public Repository* (or *Private* + deploy key). Repo: `github.com/beatzball/caribou`.
2. Build pack: **Dockerfile**. Dockerfile path: `./Dockerfile`.
3. *Configuration* → Port: `3000`. Health-check path: `/api/health`.
4. *Domains* → `caribou.quest`. Toggle *Generate automatic TLS* (Coolify/Traefik/Let's Encrypt).
5. *Storage* → *Add Persistent Storage* → Volume, name `caribou-data`, mount `/data`.
6. *Environment Variables*:
   ```
   NODE_ENV=production
   STORAGE_DIR=/data
   PORT=3000
   ```
   No secrets. OAuth credentials are registered dynamically per-instance.
7. *Deployment* → *Webhook* → copy deploy URL into GitHub as the `COOLIFY_WEBHOOK_URL` secret.
8. One manual deploy to verify; thereafter CI triggers.

### 9.3 DNS

At the caribou.quest registrar:
- A record `caribou.quest` → Coolify host IPv4
- AAAA record `caribou.quest` → Coolify host IPv6 (if available)

Traefik issues the TLS cert within ~60 s of first request.

### 9.4 Environment variables — v1 is spec-complete with just three

```
NODE_ENV=production
STORAGE_DIR=/data
PORT=3000
```

If Sentry lands later: `SENTRY_DSN`.

---

## 10. CI/CD

### 10.1 GitHub Actions — `.github/workflows/ci.yml`

```yaml
name: CI
on:
  pull_request: { branches: [main] }
  push:         { branches: [main] }

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }          # pnpm --filter "...[origin/<base>]" needs history
      - uses: pnpm/action-setup@v4
        with: { version: 10.28.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Compute affected filter
        id: affected
        run: |
          if [[ "${{ github.event_name }}" == "pull_request" ]]; then
            echo "args=--filter ...[origin/${{ github.base_ref }}]" >> $GITHUB_OUTPUT
          else
            echo "args=-r" >> $GITHUB_OUTPUT
          fi
      - run: pnpm ${{ steps.affected.outputs.args }} typecheck
      - run: pnpm ${{ steps.affected.outputs.args }} lint
      - run: pnpm ${{ steps.affected.outputs.args }} test:coverage
      - if: always()
        uses: actions/upload-artifact@v4
        with: { name: coverage, path: '**/coverage/**' }

  e2e:
    runs-on: ubuntu-latest
    needs: checks
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.28.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter caribou-elena exec playwright install --with-deps chromium firefox webkit
      - run: pnpm build
      - run: pnpm test:e2e
      - if: failure()
        uses: actions/upload-artifact@v4
        with: { name: playwright-report, path: apps/caribou-elena/playwright-report }

  changeset-check:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
        with: { version: 10.28.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm changeset status --since=origin/main

  deploy:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    needs: [checks, e2e]
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Coolify deploy
        run: curl -fSsL -X POST "${{ secrets.COOLIFY_WEBHOOK_URL }}"
```

Deploy runs only on push to `main` and only after `checks` + `e2e` are green. Branch protection on `main` requires `checks`, `e2e`, and `changeset-check` to merge PRs.

**Affected-graph runs on PRs.** The `checks` job computes a pnpm filter based on event type: on a pull request it runs `pnpm --filter "...[origin/<base-ref>]" <task>` — tasks run only in packages changed since the PR base **plus all of their dependents**. On push to `main` it falls back to `pnpm -r <task>` (full workspace). This gives us the "affected" behaviour Nx is famous for, using pnpm alone. The `e2e` job always runs the full suite — an E2E break can originate in any package the app links against. If this ceases to be fast enough (cold CI > ~5 min, or the sibling Lit/FAST apps land), the migration to Turborepo captures per-task caching on top of the same filter pattern.

### 10.2 Release workflow (Changesets) — `.github/workflows/release.yml`

```yaml
name: Release
on: { push: { branches: [main] } }

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
        with: { version: 10.28.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - uses: changesets/action@v1
        with:
          version: pnpm changeset version
          commit: "chore: version packages"
          title: "chore: version packages"
          # no publish step — all packages private in v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

When changesets are present, this opens or updates a rolling "chore: version packages" PR. Merging it bumps versions and updates CHANGELOGs. Add a `publish:` step later if we decide to publish any `@beatzball/caribou-*` package to npm.

`.changeset/config.json`:

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": ["@changesets/changelog-github", { "repo": "beatzball/caribou" }],
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "restricted",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "privatePackages": { "version": true, "tag": true },
  "ignore": []
}
```

`privatePackages: { version: true, tag: true }` is the key line: every workspace package is `"private": true` in v1, and this flag tells Changesets to version and generate CHANGELOGs anyway (its default is to skip private packages).

### 10.3 In-app changelog view

- **Route:** `/changelog`, public, prerendered (or SSR with long cache).
- **Source:** `apps/caribou-elena/CHANGELOG.md`, maintained by Changesets.
- **Implementation:** Nitro server route reads the file, parses with `marked`, returns HTML. Responds with `ETag` based on file mtime; browsers 304 on subsequent loads.
- **UI:** version sections, collapsible, latest expanded by default. Each section: version number + date + grouped bullets derived from the Changesets markdown structure.
- **Unread indicator:** settings icon shows a dot when the latest changelog version > `caribou.prefs.{UserKey}.lastSeenChangelogVersion`. Dot clears on visiting `/changelog`.
- **Footer link:** every page's footer has a "changelog" link. Landing page footer mirrors it.
- **What's NOT in v1:** per-package changelog aggregation (users don't care that `@beatzball/caribou-state@0.3.1` patched). Changesets already rolls package-level entries into the app's CHANGELOG via internal-dependency updates.

---

## 11. Testing strategy

| Layer | Discipline | Coverage floor | Notes |
|---|---|---|---|
| `@beatzball/caribou-state` | **TDD** | 95% | Pure logic. Bugs here are the worst to debug. |
| `@beatzball/caribou-auth` | **TDD** | 95% | OAuth PKCE, state-param, callback parsing — security-adjacent. |
| `@beatzball/caribou-mastodon-client` | **TDD** | 90% | Client factory, dedup, error mapping. Tested against MSW fixtures. |
| `@beatzball/caribou-ui-headless` | unit | 80% | Headless controllers. |
| `server/api/**` (Nitro routes) | integration | 100% of routes | Every route has happy path + ≥1 failure mode. MSW intercepts outbound HTTP. |
| App components (Elena) | interaction | — | 5–10 hand-picked interactions (login flow, compose-and-post, fav/boost, notifications, thread nav). |
| E2E (Playwright) | smoke | 5–7 flows | Golden paths only. Chromium local, Chromium+Firefox+WebKit on CI. `@axe-core/playwright` asserts a11y on every flow. |

**Tools:**
- **Vitest** — all unit + integration tests.
- **happy-dom** — Vitest DOM env. Paired with `@elenajs/ssr-shim` so Elena's custom-element registration works in tests identically to SSR.
- **MSW** — one shared "fake Mastodon instance" fixture used at every layer. Keeps tests decoupled from implementation; survives refactors.
- **Playwright** — E2E, with `@axe-core/playwright` for a11y assertions. CI fails on a11y regressions.
- **`superpowers:test-driven-development`** skill — drives red-green-refactor for the three TDD packages during implementation.

---

## 12. Observability and security

### 12.1 Observability (deliberately minimal v1)

- **Logs:** `console.*` → stdout → captured by Coolify. Thin `pino` wrapper for structured JSON (request id, path, status, duration). ~20 LOC.
- **Errors:** Sentry *deferred* — server does almost nothing. If per-user client-side errors matter, that's a Phase 2 decision tied to privacy considerations.
- **Health check:** `GET /api/health` returns `{ status: 'ok', version: <git-sha> }`.
- **Metrics:** none v1. Coolify's container metrics (CPU, memory, restarts) are the whole story.
- **Access logs:** Traefik at the Coolify layer. No app-level access logging.

### 12.2 Security

| Concern | Approach |
|---|---|
| TLS | Coolify / Traefik / Let's Encrypt, auto-renewed. |
| HSTS | `strict-transport-security: max-age=31536000; includeSubDomains; preload` via Nitro middleware. |
| CSP | `default-src 'self'; img-src * data:; media-src * data:; connect-src *; style-src 'self' 'unsafe-inline'; script-src 'self'`. `connect-src *` required (browser hits arbitrary user-chosen instances). `unsafe-inline` on styles is UnoCSS runtime. Revisit in Phase 2 for nonce-based script CSP. |
| Token hygiene | Only in browser localStorage. Passes through server's `Location:` header once, never logged. Global 401 interceptor clears session on revocation. |
| XSS from Mastodon HTML | Status content is HTML. Parse + sanitize client-side with `DOMPurify` conservative allowlist. Never `innerHTML` raw instance content. |
| Rate limiting | None v1 (OAuth-only server, near-zero traffic). Add IP-based limit on `/api/signin/*` if ever targeted. |
| Secrets | None to manage v1. If Sentry or any external service is added later, secrets live in Coolify env vars, never in the repo. |

---

## 13. Git workflow — worktree-only

- **`main`** is the only long-lived branch. Protected: linear history, squash-merge required, passing `checks` + `e2e` + `changeset-check` required.
- **All work happens in disposable worktrees.** `superpowers:using-git-worktrees` skill drives:
  1. `git worktree add ../caribou-worktrees/<slug> -b <branch>`
  2. Work, commit, push.
  3. Open PR. CI runs.
  4. Squash-merge to `main`.
  5. `git worktree remove ../caribou-worktrees/<slug>`.
- **Branch naming is arbitrary.** The worktree slug serves as the branch name; no `feat/`/`fix/`/`chore/` convention. Canonical record is the squash commit subject + the changeset entry.
- **Every PR contains a changeset.** Either a real one (via `pnpm changeset`) or an intentional `pnpm changeset --empty` for doc/chore-only changes.

---

## 14. Risks and open questions

| Risk | Mitigation |
|---|---|
| Elena is young; SSR edge cases might bite. | Build the thinnest possible app shell in Milestone 1 (routes + sign-in only) before any feature work, to shake out SSR quirks early. |
| `@preact/signals-core` pattern feels awkward in web components. | Fallback to `nanostores` is pre-designed — thin store APIs hide the primitive. Swap = 1 dependency swap + `bindings.ts` rewrite, no consumer changes. |
| Force-light-DOM in Lit/FAST is unusual. | Accept it. This is Phase-2 concern (v1 is Elena-only, already light DOM). When Lit variant lands, override `createRenderRoot()` returning `this`. |
| CSP `connect-src *` is permissive. | Unavoidable for a client that contacts arbitrary instances. Audit script-src tightening in Phase 2. |
| Mastodon instance returns restrictive CORS. | Same constraint Elk lives with. Display a clear error; user picks a different instance. |
| Media upload async API polling can hang on bad instances. | 30 s timeout with clear error. |
| Coolify volume ownership bug on first mount. | Handled explicitly: `chown -R node:node /data` in Dockerfile. |

**Open questions (to be resolved during planning, not spec):**

- Virtual list library: roll-our-own `createVirtualList` in `caribou-ui-headless`, or adopt `virtua`? Preference: roll own v1 (no unnecessary deps); adopt if perf is an issue.
- Icons: Iconify via UnoCSS preset, or ship a hand-curated SVG sprite? Preference: Iconify (matches Elk; zero curation overhead).

**Spec decomposition:** This document is the full v1 design. It is **not** expected to turn into one monolithic implementation plan. `superpowers:writing-plans` will break it into 3–5 sequential implementation plans — the natural split is (1) monorepo skeleton + first deploy, (2) auth + data layer + first timeline end-to-end, (3) remaining timelines + mutations + compose, (4) notifications/bookmarks/lists/hashtags, (5) settings/changelog/polish. Exact partition is `writing-plans`'s call.

---

## 15. Phase-gate — NOT in v1, planned later

- **Phase 2a — PWA + Push.** Split across two repos (see §16): framework-level plumbing lives upstream as `@beatzball/litro-pwa` and `@beatzball/litro-push`; Caribou consumes them via thin `@beatzball/caribou-pwa` / `@beatzball/caribou-push` config packages (manifest values, cache strategies for Mastodon endpoints, per-account subscription registration with the user's instance). Upstream-first: the Litro modules are designed and shipped in the Litro repo before Caribou-side wiring lands. Expected cost ~2–3 weeks total.
- **Phase 2b — Streaming WebSocket timelines.** Replace polling with `masto.ws`. Per-timeline subscription management, pause on visibility hidden.
- **Phase 2c — Multi-account UI.** Data model already supports it; add switcher UI + "add another account" flow.
- **Phase 3 — Adapter-variant apps.** `apps/caribou-lit`, `apps/caribou-fast` re-implement Caribou's component layer only. All packages reused unchanged.
- **Later or never:** Search, DMs as a distinct view, rich editor, i18n, Sentry, nonce-based script CSP, per-package changelog aggregation.

---

## 16. Upstream opportunities in Litro

Because `@beatzball/litro` is ours, anything that's a framework concern (not a Caribou concern) should live upstream rather than be duplicated in this monorepo's `packages/*`. Candidates identified during this design:

### 16.1 Definitely upstream — Phase 2a blockers

- **`@beatzball/litro-pwa`** — manifest emission, Workbox `InjectManifest` wiring for Nitro, `precacheAndRoute` scaffolding, and a small runtime helper for "update available → click to refresh" UX. Today Litro has no PWA module and any app wanting one has to hand-wire Workbox. Caribou is the first consumer; future Litro apps (starter recipes, the `docs-ssr` playground, third-party users) benefit directly.
- **`@beatzball/litro-push`** — Web Push subscription lifecycle, VAPID key helpers, payload decryption inside the service worker, notification-click routing. Nothing about the *mechanism* is Mastodon-specific — only the server-side "register this push subscription with the account's instance" call is, and that stays in Caribou.

**Consumption shape in Caribou:** `@beatzball/caribou-pwa` and `@beatzball/caribou-push` shrink to thin config + Mastodon-integration packages — app name, icons, which endpoints to cache, which instance API to call to register the subscription. All hard wiring lives upstream.

### 16.2 Probably upstream — pull up when we touch them

- **`@beatzball/litro-signals`** — the `bindSignals(instance, read)` adapter-agnostic glue from §8.5. It picks the right reflow method (`update()` on Elena, `requestUpdate()` on Lit/FAST), wires dispose on `disconnectedCallback`, and ships `@preact/signals-core` as a peer. *Any* Litro app using signal-based state hits this same need. In Caribou, `packages/state/src/bindings.ts` collapses to a one-line re-export once this exists. The `nanostores` fallback path (§14) also gets cleaner: swap the upstream module's peer dep, Caribou is unaffected.
- **`@beatzball/litro-testing`** — the happy-dom + `@elenajs/ssr-shim` pairing Caribou needs for component-interaction tests (§11) is generic Litro+adapter test-setup work. A small `defineVitestConfig()` helper upstream would let Caribou supply only project-specific matchers/fixtures. Not urgent — the raw setup is ~30 LOC today — but the moment a second Litro project writes the same 30 LOC, it should move up.

### 16.3 Considered and deferred — stays in Caribou (for now)

- **OAuth proxy scaffolding.** The *pattern* is generic (unstorage-backed app-credential cache with TTL, Web-Crypto state token with one-time consume, redirect via URL fragment), but Mastodon's app-registration API shape (`POST /api/v1/apps` returning `client_id`/`client_secret`/`vapid_public_key` in one call) is specific enough that the abstraction cost isn't justified by a single consumer. Revisit if a second `@beatzball` app ever needs OAuth.
- **Dockerfile + Coolify entrypoint.** Too deployment-shape-specific for a module. Belongs as a Litro *recipe* example (`recipes/fullstack` could include a `Dockerfile.example` and a `docs/deploy-to-coolify.md` note), not a package.

### 16.4 Process

When a Phase that triggers one of these hits (Phase 2a for PWA/Push, or ad-hoc when we tire of maintaining the bindings glue here), the flow is:

1. Open an issue in the Litro repo scoping the module.
2. Design + land the module there under its normal worktree/changeset workflow.
3. Only then land the Caribou-side consumer wiring. The Caribou package shrinks from "implementation + config" to "config only."

This order keeps the upstream module honest — designed for reuse, not tailored to Caribou's incidentals — and avoids temporarily forking framework code into this repo.

---

## Appendix A — Glossary

- **UserKey** — canonical identifier for a Mastodon account: `` `${handle}@${instance}` `` (e.g. `beatzball@fosstodon.org`).
- **Instance / Server** — used interchangeably. A Mastodon server's hostname (no scheme). E.g. `mastodon.social`.
- **Origin** — `{scheme}://{host}[:{port}]` where Caribou itself is served. Dev is `http://localhost:3030`; prod is `https://caribou.quest`.
- **Adapter** — web-component framework (Elena / Lit / FAST) that Litro wraps.
- **Adapter variant** — one of the three planned sibling apps; all implement the same product, differ only in adapter.

---

## Appendix B — Non-binding implementation hint: milestone order

This is *not* the implementation plan. It is a sketch of the order that would likely surface the most load-bearing risks earliest.

1. Monorepo skeleton + pnpm workspace + tsconfig/eslint packages + Changesets + first CI pipeline (green with a no-op test).
2. Scaffold `apps/caribou-elena` via `pnpm create @beatzball/litro`. Verify dev + build + SSR work. First Dockerfile + Coolify deploy smoke test.
3. `@beatzball/caribou-auth` (TDD), `@beatzball/caribou-mastodon-client` (TDD against MSW), server OAuth routes.
4. `/` landing + instance picker; `/signin/*` flow; full login end-to-end against a real instance.
5. `@beatzball/caribou-state` (TDD), bindings, `/home` timeline with polling + "new posts" banner.
6. Local + public timelines, status view, thread view, account profile.
7. Mutations: fav, reblog, bookmark, follow — optimistic with rollback.
8. Compose dialog + media upload.
9. Notifications (list + polling + unread badge).
10. Bookmarks, lists (incl. CRUD), hashtags.
11. Settings page, theme toggle, account management.
12. `/changelog` route + unread dot.
13. a11y pass, Playwright E2E suite filled in, deploy to `caribou.quest`.

Writing-plans will turn this into the actual implementation plan with real task sizing.
