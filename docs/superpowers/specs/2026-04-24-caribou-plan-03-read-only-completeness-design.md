---
title: Caribou Plan 3 — Read-Only Completeness — Design Spec
date: 2026-04-24
status: approved, ready for implementation planning
supersedes: none
parent-spec: docs/superpowers/specs/2026-04-21-caribou-v1-design.md
---

# Caribou Plan 3 — Read-Only Completeness

## 1. Summary

Plan 3 completes every **read-only** screen of the Caribou v1 spec (`§14 Appendix B item 6`): local timeline, public timeline, single-status view, thread view, and account profiles. Alongside the feature work, Plan 3 stands up UnoCSS and builds real layout components (`<caribou-app-shell>`, `<caribou-nav-rail>`, `<caribou-right-rail>`, status-card variants) so the app stops being a pile of inline `style="…"` scraps.

Dark-mode only. Light mode + theme toggle are deferred to Plan 5. No interactions, no compose, no notifications, no settings — those are Plan 4.

At the end of Plan 3, a logged-in user can browse their full read-only Mastodon experience on `caribou.quest`: home / local / public timelines, deep thread context, and any profile (local or remote).

## 2. Parent spec alignment

This plan executes §14 Appendix B item 6 of the v1 spec. It also depends on and does not violate:

- §2.1 in-scope features (adds local timeline, public timeline, status view, thread view, profile view).
- §8.9 route table (Plan 3 adds `/local`, `/public`, `/@[handle]`, `/@[handle]/[statusId]`, plus stubs `/privacy` and `/about`).
- §7.3 styling commitment — "UnoCSS + design tokens" — is implemented in this plan.
- §8.8 UX patterns (skeleton list, infinite scroll, focus management) — all reused.

One small deviation: Plan 2 shipped its home timeline at `/feed` instead of the spec's `/home`. Plan 3 renames `/feed` → `/home` and leaves `/feed` as a 301 redirect. Not a spec change; a Plan 2 drift we are fixing here while the blast radius is zero.

Plan 3 also amends the v1 spec to add **zen mode** (see §9 below) so Plan 5 has a concrete definition to build against.

## 3. Scope & routes

### 3.1 New routes (all SSR shell, all auth-required)

| Path | Purpose |
|---|---|
| `/local` | Local timeline (user's instance public posts) |
| `/public` | Federated timeline |
| `/@[handle]` | Profile view with tabs (`?tab=posts|replies|media`, default `posts`) |
| `/@[handle]/[statusId]` | Single status + thread (hybrid layout) |
| `/privacy` | Stub page — one-paragraph placeholder |
| `/about` | Stub page — one-paragraph placeholder |

### 3.2 Renames & redirects

- `/feed` (Plan 2) → **renamed to `/home`** to match spec §8.9.
- `/feed` remains as a Litro server route that issues a 301 redirect to `/home`. Bookmarks keep working; this route is removed entirely in Plan 4 or 5.

### 3.3 Profile sub-tabs

Tabs are a query parameter — `?tab=posts`, `?tab=replies`, `?tab=media` — not a sub-route. Reasons:
- The Mastodon endpoint (`GET /api/v1/accounts/:id/statuses`) already takes `exclude_replies` / `only_media`; it is one fetch variation, not three screens.
- One fewer route in the file tree.
- Tab change is an intentional full remount (new `tab` attr → fresh store); profiles don't need cross-tab state preservation.

Default (no `tab` param) = `posts`.

### 3.4 Handle parsing

`/@[handle]` accepts:
- `@user` — local account on the signed-in user's instance.
- `@user@host.example` — remote account.

Normalization happens in `lookupAccount(handle)` on the client (strip leading `@`, accept either form, always pass to `/api/v1/accounts/lookup?acct=`).

### 3.5 Stub pages

`/privacy` and `/about` ship as one-paragraph static pages in Plan 3. They exist only so the right-rail links resolve. Real content is out of scope for this plan.

- `/privacy`: "Privacy policy coming soon. Caribou does not collect analytics or telemetry. Your Mastodon instance sees your activity; Caribou's server sees only your OAuth-related requests (no post content)."
- `/about`: one short paragraph — name, one-line description ("A Mastodon client built on Litro"), and a link to the project's GitHub repository. Actual URL pulled from `build-meta.generated.ts` at render time, same source the right-rail GitHub link uses.

### 3.6 Explicitly not in Plan 3

- `/notifications`, `/bookmarks`, `/lists`, `/lists/[id]`, `/tags/[tag]`, `/settings` — Plan 4.
- Interactions (favourite / boost / reply / follow) — Plan 4.
- Compose dialog — Plan 4.
- Keyboard shortcuts — Plan 5.
- Theme toggle, zen mode, `/changelog` page — Plan 5.

## 4. Data layer extensions

All new networking is a thin wrapper on the existing `request()` in `packages/mastodon-client/src/create-client.ts`. No new types — `Status` and `Account` already exist in `packages/mastodon-client/src/types.ts`.

### 4.1 CaribouClient additions

```ts
// packages/mastodon-client/src/create-client.ts

fetchStatus(id: string): Promise<Status>
  // GET /api/v1/statuses/:id

fetchThread(id: string): Promise<{ ancestors: Status[]; descendants: Status[] }>
  // GET /api/v1/statuses/:id/context

lookupAccount(handle: string): Promise<Account>
  // GET /api/v1/accounts/lookup?acct=<user-or-user@host>
  // Handle normalization: strip leading '@', accept "user" or "user@host"

fetchAccountStatuses(
  accountId: string,
  opts?: { maxId?: string; excludeReplies?: boolean; onlyMedia?: boolean; limit?: number }
): Promise<Status[]>
  // GET /api/v1/accounts/:id/statuses
```

### 4.2 State additions

Three new factories, one file each, alongside the existing `packages/state/src/timeline-store.ts`:

#### `packages/state/src/account-cache.ts`

```ts
export function createAccountCache(client: CaribouClient): {
  lookup(handle: string): Signal<AsyncState<Account>>
}
```

- Memoized by normalized handle (lowercased, leading `@` stripped).
- One fetch per unique handle per session.
- `AsyncState<T> = { status: 'idle' | 'loading' | 'ready' | 'error'; data?: T; error?: Error }`.

#### `packages/state/src/profile-store.ts`

```ts
export function createProfileStore(
  client: CaribouClient,
  accountId: string,
  tab: 'posts' | 'replies' | 'media',
): {
  statuses: Signal<Status[]>
  loading: Signal<boolean>
  error: Signal<Error | null>
  loadMore(): Promise<void>
  refresh(): Promise<void>
}
```

- Cursor pagination via `maxId` (last status id in list).
- `excludeReplies` / `onlyMedia` derived from `tab`:
  - `posts` → `excludeReplies: true`
  - `replies` → neither flag
  - `media` → `onlyMedia: true`
- No polling — profiles aren't treated as live.

#### `packages/state/src/thread-store.ts`

```ts
export function createThreadStore(
  client: CaribouClient,
  statusId: string,
): {
  focused: Signal<AsyncState<Status>>
  context: Signal<AsyncState<{ ancestors: Status[]; descendants: Status[] }>>
}
```

- Two parallel fetches on mount: `fetchStatus(statusId)` and `fetchThread(statusId)`.
- No polling.
- A failure of one does not fail the other (each has its own `AsyncState`).

### 4.3 Unchanged

`createTimelineStore(kind, opts)` already handles `kind: 'home' | 'local' | 'public'`. Plan 3 uses it as-is.

## 5. Styling system — UnoCSS

### 5.1 App-local install

UnoCSS is installed in `apps/caribou-elena/` — **not** as a shared package. Each future adapter app (caribou-lit, caribou-fast) will configure its own, since utility conventions may differ per adapter.

`apps/caribou-elena/uno.config.ts`:

```ts
import { defineConfig, presetUno, presetIcons } from 'unocss'
import { presetCaribou } from '@beatzball/caribou-design-tokens/uno-preset'

export default defineConfig({
  presets: [
    presetCaribou(),   // bg-0 / text-1 / border-1 / etc. → var(--…)
    presetUno(),       // Tailwind-compatible defaults
    presetIcons({ scale: 1, extraProperties: { display: 'inline-block' } }),
  ],
  content: {
    filesystem: [
      'pages/**/*.{ts,html}',
      'app.ts',
      '../../packages/*/src/**/*.ts',
    ],
  },
})
```

### 5.2 New design-tokens export: `presetCaribou()`

A new export from `@beatzball/caribou-design-tokens` — lives next to the existing `tokens.css` export. Maps token-name utilities to the corresponding `var(--…)` custom properties. Both the CSS-vars export and the preset ship from the same package so utilities and raw vars stay in sync (adding a new token updates both at once).

Illustrative (full mapping generated from the token source of truth):

```ts
export function presetCaribou() {
  return {
    name: 'caribou',
    rules: [
      ['bg-0', { 'background-color': 'var(--bg-0)' }],
      ['bg-1', { 'background-color': 'var(--bg-1)' }],
      ['text-1', { color: 'var(--text-1)' }],
      ['text-2', { color: 'var(--text-2)' }],
      ['text-accent', { color: 'var(--text-accent)' }],
      ['border-1', { 'border-color': 'var(--border-1)' }],
      // … full token set
    ],
  }
}
```

### 5.3 Build integration

- **Dev:** `@unocss/vite` plugin, HMR-friendly.
- **Prod:** UnoCSS emits `dist/client/assets/uno-*.css` alongside Vite's other CSS bundles.
- **SSR head injection:** new `UNO_HEAD` helper parallel to `TOKENS_HEAD` (PR #9), in `apps/caribou-elena/server/lib/uno-head.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Read the hashed uno-*.css from dist/client/assets at module init
// (only runs in built/preview/prod mode; dev uses Vite's CSS injection)
const ASSETS_DIR = resolve(import.meta.dirname, '../../../dist/client/assets')
const unoFile = readdirSync(ASSETS_DIR).find(f => f.startsWith('uno-') && f.endsWith('.css'))
const UNO_CSS = unoFile ? readFileSync(resolve(ASSETS_DIR, unoFile), 'utf8') : ''

export const UNO_HEAD = UNO_CSS
  ? `<style id="caribou-uno">${UNO_CSS}</style>`
  : ''
```

Dev mode skips the inline step; Vite's dev server serves the stylesheet directly.

Route handler combines the two:

```ts
// apps/caribou-elena/server/routes/[...].ts
routeMeta: { head: TOKENS_HEAD + UNO_HEAD }
```

### 5.4 Dark-mode only

`tokens.css` already defines both dark (`:root`) and light (`[data-theme="light"]`) custom properties. No changes needed. Nothing in Plan 3 sets `data-theme`, so dark is effectively locked in.

Plan 5 adds the toggle: zero Plan-3 migration work is required to keep that door open.

### 5.5 Icons

`@iconify-json/lucide` only, via `presetIcons`. Classes like `i-lucide-home`, `i-lucide-user`. Single-set policy keeps bundle predictable. Other sets added only if a specific icon is unavailable in Lucide — case-by-case, not blanket.

### 5.6 Migration of Plan 2's inline styles

All inline `style="…"` in the existing surface gets converted to utility classes as part of Plan 3. Each conversion is its own commit:

- `pages/components/caribou-status-card.ts`
- `pages/components/caribou-timeline.ts`
- `pages/feed.ts` (during rename to `pages/home.ts`)
- `pages/index.ts` (landing)
- `app.ts`'s inline scraps

## 6. Layout components

All new layout components live in `apps/caribou-elena/pages/components/`. Each extends `CaribouElement` (Elena base class) like existing components. Future adapter apps will reimplement these against their own base classes.

### 6.1 Component tree

```
<caribou-app-shell>
├── <caribou-nav-rail>          left
├── <slot name="main">          center — page content
└── <caribou-right-rail>        right (≥lg only)
```

### 6.2 Responsive breakpoints

Tailwind-compatible breakpoints via `presetUno`:

| Width | Layout |
|---|---|
| `<md` (<768) | Single column. Nav becomes bottom tab bar (fixed, 5 icons). Right rail hidden. |
| `md` (768–1023) | Nav rail left (icon-only, 56px). Main column. Right rail hidden. |
| `lg` (≥1024) | Nav rail left (labeled, 200px). Main column. Right rail right (280px). |

Main column is always `max-w-[640px] mx-auto` inside its grid cell.

Mobile: bottom tab bar rather than a hamburger drawer. Rationale: every nav destination fits in 5 slots; a drawer adds a tap + animation for zero benefit at this scope.

### 6.3 `<caribou-nav-rail>`

Nav items (top to bottom / left to right on mobile):

| Item | Icon | Route |
|---|---|---|
| Home | `i-lucide-home` | `/home` |
| Local | `i-lucide-users` | `/local` |
| Public | `i-lucide-globe` | `/public` |
| Profile | `i-lucide-user` | `/@<me>` (from `me.signal` handle) |
| Sign out | `i-lucide-log-out` | existing `/api/signout` POST |

Active route gets `aria-current="page"` + accent-bg utility. Active detection: shell reads `window.location.pathname` on mount and on `popstate`.

### 6.4 `<caribou-right-rail>` (v1 content)

Top to bottom:

1. **About card**
   - App name ("Caribou")
   - Version (from `build-meta.generated.ts`)
   - "built <relative time>" (from same meta via `formatRelativeTime`)
   - GitHub link (`i-lucide-github`, URL from meta)

2. **Links list**
   - Privacy → `/privacy`
   - About → `/about`

3. **Disabled slots** (visible but `aria-disabled="true"`, tooltip "Coming soon"):
   - Theme toggle (Plan 5)
   - Zen mode (Plan 5)
   - Keyboard shortcuts (Plan 4)

Slots are visible placeholders — not hidden — so users can see what's coming and so Plan 4/5 don't need to reflow the rail when wiring them.

### 6.5 `<caribou-app-shell>` responsibilities

- Renders three-pane grid via UnoCSS grid utilities.
- Exposes `main` slot for pages.
- Owns responsive logic via a single Uno responsive class binding (no JS breakpoint checks).
- Focus management: route change → focus `<h1>` in main slot (spec §8.8). Implemented in connected / attribute-changed lifecycle; pages only need to provide an `<h1>`.
- **Does not** own data fetching or route matching — pages still do that.

### 6.6 Page usage pattern

```html
<caribou-app-shell>
  <caribou-timeline slot="main" kind="local"></caribou-timeline>
</caribou-app-shell>
```

The existing `/home` (née `/feed`) page is refactored to this shape in Plan 3, as part of the utility-class migration.

## 7. `@beatzball/caribou-ui-headless` package

New workspace package. Adapter-agnostic (no DOM-framework imports).

### 7.1 Plan 3 contents

```
packages/caribou-ui-headless/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── intersection-observer.ts
│   └── relative-time.ts
└── test/
    ├── intersection-observer.test.ts
    └── relative-time.test.ts
```

### 7.2 `createIntersectionObserver`

```ts
export function createIntersectionObserver(
  callback: (entry: IntersectionObserverEntry) => void,
  options?: IntersectionObserverInit,
): { observe(el: Element): void; disconnect(): void }
```

Thin ergonomic wrapper. Used by timeline + profile for "load more on scroll" sentinel. Tests use vitest env's stub `IntersectionObserver`.

### 7.3 `formatRelativeTime`

```ts
export function formatRelativeTime(iso: string, now?: Date): string
  // "just now" (<30s)
  // "5m"       (<1h)
  // "2h"       (<24h)
  // "3d"       (<30d)
  // "Apr 14"   (<1y)
  // "Apr 14, 2025" (≥1y)
```

Centralizes relative-time formatting used by status cards, profile, and the right-rail "built" line. Tests use a fixed `now` for determinism.

### 7.4 Deliberately NOT in Plan 3

- **`createFocusTrap`** — no dialogs in Plan 3. Added in Plan 4 alongside the compose dialog.
- **`createVirtualList`** — no measured scroll-length problem yet. Added only if long-timeline profiling shows a need.
- **Keyboard-shortcut registry** — Plan 5.

### 7.5 Package setup

Mirrors existing packages: TypeScript, vitest, built via `tsc`, workspace-protocol dependency. New `.changeset/` entry at initial publish.

## 8. Page components

All in `apps/caribou-elena/pages/` or `pages/components/`.

### 8.1 Route files (thin)

| File | Role |
|---|---|
| `pages/home.ts` | refactored from `feed.ts`; renders `<caribou-timeline kind="home">` inside shell |
| `pages/local.ts` | `<caribou-timeline kind="local">` |
| `pages/public.ts` | `<caribou-timeline kind="public">` |
| `pages/@[handle].ts` | parses `?tab=`, renders `<caribou-profile handle tab>` |
| `pages/@[handle]/[statusId].ts` | renders `<caribou-thread status-id>` |
| `pages/privacy.ts` | static stub |
| `pages/about.ts` | static stub |
| `pages/feed.ts` | Litro server route → 301 redirect to `/home` |

### 8.2 `<caribou-timeline>` modifications

Existing component (Plan 2). Changes:

- Accept `kind` attribute: `"home" | "local" | "public"`.
- Instantiate the appropriate `createTimelineStore(kind)` based on attr.
- No other changes — loading/error/empty/list/"N new posts" banner all unchanged.

### 8.3 `<caribou-profile>` (new)

Attrs: `handle`, `tab`.

```
<caribou-profile handle="@alice@example.social" tab="posts">
├── <caribou-profile-header>     avatar, display name, handle, bio, follower/following/posts counts
├── <caribou-profile-tabs>       Posts | Replies | Media — anchor tags (query-param nav)
└── (inline status list)         loops over profile-store statuses, renders
                                 <caribou-status-card variant="timeline"> per item,
                                 mirrors timeline's skeleton / empty / sentinel patterns
```

Flow:
1. Use `createAccountCache.lookup(handle)` to resolve → `accountId`.
2. Render `<caribou-profile-header>` from the cached `Account`.
3. Instantiate `createProfileStore(client, accountId, tab)` and render its `statuses` signal as a list of `<caribou-status-card variant="timeline">`.
4. Tab change = anchor navigation → full-page navigation (authed SSR routes are full navigations per spec §8.9) → new `tab` attr → fresh component mount → fresh store. No bespoke tab-state logic.

Status-list UX patterns (skeleton, empty state, infinite-scroll sentinel via `createIntersectionObserver`) are duplicated between `<caribou-timeline>` and `<caribou-profile>` in Plan 3. This is intentional: the status list inside a profile has different surrounding chrome (header + tabs) and different pagination semantics (no "N new posts above" banner since profiles don't poll). Extracting a shared `<caribou-status-list>` primitive is deferred until Plan 4 when bookmarks / notifications introduce a third call site — at three, extraction is justified; at two, it's premature.

If `lookupAccount` fails, profile page renders an error state with retry. No special 404 page in Plan 3.

### 8.4 `<caribou-thread>` (new)

Attr: `status-id`. Uses `createThreadStore(client, statusId)`.

Hybrid layout (per brainstorm decision, matching Mastodon web v4):

```
ancestors (top-down, chronological) — timeline-variant card, muted
ancestors (older → newer)
FOCUSED (larger, accent border, full timestamp)
  descendant (indent-1)
    descendant (indent-2)
      descendant (indent-3)    ← max indent
    descendant (indent-3, flattened from deeper)
  descendant (indent-1)
```

- Indent depth computed from `in_reply_to_id` reply chain relative to the focused status.
- Indent caps at depth 3 (plus focused root = 4 visible levels). Anything deeper renders at depth 3 to prevent horizontal overflow on narrow screens.
- Ancestors above focused post get no indent (they are the context chain leading up to it).

### 8.5 `<caribou-status-card>` variants (modification)

Split the existing component via a new `variant` attr — single component file, variant drives CSS:

| Variant | Used by | Visual |
|---|---|---|
| `timeline` (default) | timelines, profile lists | current Plan-2 look (compact) |
| `focused` | thread center | larger text, accent border, full absolute timestamp, no truncation |
| `ancestor` | thread above focused | muted (`opacity-75`), compact |
| `descendant` | thread below focused | indent via `margin-left` utility, "→ @replied-to-handle" line above content |

- Variant is a CSS concern only — classes conditional on attr value.
- Existing DOMPurify + `PURIFY_OPTS` content rendering is shared across all variants.
- No separate component files.

### 8.6 Stub page markup

`pages/privacy.ts`:

```html
<caribou-app-shell>
  <article slot="main" class="prose text-1">
    <h1 class="text-2xl font-semibold mb-4">Privacy</h1>
    <p class="text-2">
      Privacy policy coming soon. Caribou does not collect analytics or
      telemetry. Your Mastodon instance sees your activity; Caribou's server
      sees only your OAuth-related requests (no post content).
    </p>
  </article>
</caribou-app-shell>
```

`pages/about.ts` is analogous.

## 9. Spec amendment — zen mode

Plan 3 does not implement zen mode. It adds zen mode to the v1 spec so Plan 5 has a concrete definition and so Plan 3 can reserve the right-rail slot with correct future semantics.

### 9.1 Amendment — §2.1 (In scope)

Add bullet:
> - **Zen mode.** Reading-focused layout toggle. Widens main column, hides nav rail and right rail, reduces status-card density. Per-user preference persisted to localStorage. See §8.8.

### 9.2 Amendment — §8.8 (UX patterns)

Add row:
> | **Zen mode** | Reading-focused layout. `data-zen="true"` on `<html>` triggers: nav rail collapses to single "exit zen" affordance (top-left); right rail hidden; main column widens to `max-w-[720px]` (from 640); status-card density reduced (boost/fav/reply counts hidden, relative-time on hover only). Persisted in `localStorage` under `caribou.prefs.{UserKey}.zen`. Toggled via right-rail control, settings, or `z` keyboard shortcut (Plan 5). |

### 9.3 Amendment — §14 Appendix B item 11

Update:
> 11. Settings page, **theme toggle, zen mode**, account management.

### 9.4 Why `data-zen` is separate from `data-theme`

Zen is an orthogonal concern (layout vs. color scheme); overloading one attribute bundles two toggles together unnaturally and forces Plan 5 to refactor the attribute semantics.

## 10. Testing strategy

### 10.1 Unit tests (vitest, per package)

| Package | New tests |
|---|---|
| `@beatzball/caribou-mastodon-client` | `fetchStatus`, `fetchThread`, `lookupAccount`, `fetchAccountStatuses` — happy path + 404 + network error per method. Mocked `fetch`. |
| `@beatzball/caribou-state` | `account-cache` (memoization, re-emit on stale), `profile-store` (initial load, `loadMore` pagination, `tab` switching = full remount), `thread-store` (parallel fetches succeed, one fails one succeeds). |
| `@beatzball/caribou-ui-headless` | `createIntersectionObserver` (observe + disconnect lifecycle), `formatRelativeTime` (all six ranges with fixed `now`). |
| `@beatzball/caribou-design-tokens` | `presetCaribou()` returns the expected rule mapping (snapshot test against a sampled subset of tokens). |

Tests co-located with source per existing repo convention: `src/*.ts` + `test/*.test.ts`.

### 10.2 Integration tests (Elena app)

Minimal, high-value only:

- `caribou-status-card` variant rendering — four tests (one per variant) with a canned `Status` fixture. Assert the utility classes applied on the root element, not pixel output.
- `caribou-thread` indent cap — render a depth-5 descendant chain, assert DOM indentation stops at depth 3.
- `caribou-profile` tab parsing — mount with `?tab=media`, assert `onlyMedia: true` was passed to `createProfileStore`.

### 10.3 E2E tests

**None added in Plan 3.** Existing Playwright suite (signin + home timeline from Plan 2) runs in CI unchanged.

Rationale: adding Playwright coverage for read-only screens delivers little signal per minute of test runtime. Unit + integration tests above catch regressions more cheaply. Plan 4 adds E2E for interactions — the feature that genuinely needs click-through coverage.

### 10.4 Manual verification checklist

Run before declaring plan done:

- [ ] `/home`, `/local`, `/public` each render real data; scroll-sentinel loads more.
- [ ] `/@me` loads own profile.
- [ ] Switching tabs via URL (posts → replies → media) works; no flicker on tab change.
- [ ] `/@alice@example.social` resolves a remote handle.
- [ ] `/@alice/<statusId>` renders focused post + ancestors + descendants; chain of depth >3 caps visual indent at depth 3.
- [ ] `/feed` 301-redirects to `/home`; browser address bar updates.
- [ ] `/privacy`, `/about` load.
- [ ] Right-rail disabled slots show "Coming soon" on hover; clicks do nothing.
- [ ] Bottom tab bar on `<md`; nav rail only on `md`; nav rail + right rail on `lg`.
- [ ] Sign out + sign back in on same instance still works (flow from Plan 2, not regressed).

### 10.5 CI

Existing `typecheck` + `test` + `build` matrix extends automatically to the new `caribou-ui-headless` package. No new CI jobs. Coverage reporting remains optional / off.

## 11. Out of scope

### 11.1 Deferred to Plan 4 (interactions + write features)

- Favourite / boost / reply / follow
- Compose dialog (textarea, CW, visibility, media upload, alt-text)
- Notifications view + unread badge + 60s polling
- Bookmarks view
- Lists (CRUD + list timelines)
- Hashtag timelines (`/tags/[tag]`)
- Settings page (account mgmt, default timeline picker)
- Keyboard shortcut registry + `createFocusTrap` in `caribou-ui-headless`
- E2E coverage for any of the above

### 11.2 Deferred to Plan 5 (polish + themes + PWA)

- Theme toggle (dark/light/system) + `data-theme` wiring
- Zen mode (defined in this spec, implemented in Plan 5) + `data-zen` attribute
- Changelog page (`/changelog`) + unread-dot indicator
- PWA manifest, service worker, Workbox precache
- Web Push (VAPID, encrypted payload decryption)
- Streaming WebSocket timelines
- `createVirtualList` in `caribou-ui-headless` (only if measured need)

### 11.3 Out of v1 entirely (per parent spec §2.2)

Restated so Plan 3 reviewers don't expect them:

- Search (accounts / tags / statuses)
- DMs as a distinct view
- Rich editor (Tiptap)
- i18n / multi-locale
- Multi-account UI
- Sibling adapter apps (`caribou-lit`, `caribou-fast`)
- Sentry / server-side error tracking
- Nonce-based script CSP

### 11.4 Considered and rejected

- **Light-mode in Plan 3** — deferred by user decision; token CSS already exists, only toggle behavior is missing.
- **Profile sub-routes** (`/@handle/replies`) — chose `?tab=` query param instead; one fewer route, identical UX.
- **`createFocusTrap` now** — YAGNI: no dialogs until Plan 4.
- **`createVirtualList` now** — no measured timeline-length problem yet.
- **Custom 404 page** — Litro default acceptable for Plan 3; polish lives in Plan 5.
- **Error-boundary component** — per-store error state inside timeline/profile/thread is sufficient.
- **Profile avatar upload / edit** — write feature, out of plan's scope (probably Plan 5).

---

## Appendix — Open questions

None. All decisions closed during brainstorming:

- Layout: three-pane (`<caribou-app-shell>` with nav rail + main + right rail).
- Right-rail v1 content: about card + privacy/about links + disabled slots for theme/zen/shortcuts.
- Thread layout: hybrid (Mastodon web v4 pattern).
- Architecture: Approach B (infrastructure-first — UI-headless package, status-card variants, UnoCSS stand-up).
- Dark-mode only in Plan 3; theme toggle + light-mode → Plan 5.
- Zen-mode spec amendment included in this plan.
