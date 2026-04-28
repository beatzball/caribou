---
title: Caribou Plan 3 — Read-Only Completeness — Design Spec
date: 2026-04-24
last-revised: 2026-04-28
status: approved, ready for implementation planning
supersedes: none
parent-spec: docs/superpowers/specs/2026-04-21-caribou-v1-design.md
behavioral-contract: packages/elena-morph-spec/src/__tests__/morph-custom-elements.test.ts
---

# Caribou Plan 3 — Read-Only Completeness

## 1. Summary

Plan 3 completes every **read-only** screen of the Caribou v1 spec (`§14 Appendix B item 6`): local timeline, public timeline, single-status view, thread view, and account profiles. Alongside the feature work, Plan 3 stands up UnoCSS and builds real layout components (`<caribou-app-shell>`, `<caribou-nav-rail>`, `<caribou-right-rail>`, status-card variants) so the app stops being a pile of inline `style="…"` scraps. It also fixes boost rendering (currently blank cards when `status.reblog != null`) so the read-only experience is actually complete.

Dark-mode only. Light mode + theme toggle are deferred to Plan 5. No interactions, no compose, no notifications, no settings — those are Plan 4.

At the end of Plan 3, a logged-in user can browse their full read-only Mastodon experience on `caribou.quest`: home / local / public timelines, deep thread context, and any profile (local or remote).

Plan 3 also makes Caribou's **public read paths** work without JavaScript. Bare-URL profile views (`/@user`, `/@user@host`), single-status / thread views, and `/local` / `/public` are SSR'd from the upstream Mastodon API and remain readable + paginable with JS disabled. Authenticated views (`/home`, `/@me`, `/@me/[id]`) render a sign-in placeholder server-side and hydrate to the full client-side experience once JS runs. Caribou's privacy property (server never sees access tokens or post content for the signed-in user) is preserved — see §12.

## 2. Parent spec alignment

This plan executes §14 Appendix B item 6 of the v1 spec. It also depends on and does not violate:

- §2.1 in-scope features (adds local timeline, public timeline, status view, thread view, profile view).
- §8.9 route table (Plan 3 adds `/local`, `/public`, `/@[handle]`, `/@[handle]/[statusId]`, plus stubs `/privacy` and `/about`).
- §7.3 styling commitment — "UnoCSS + design tokens" — is implemented in this plan.
- §8.8 UX patterns (skeleton list, infinite scroll, focus management) — all reused.
- §11 (privacy / what the server sees): preserved verbatim, with one explicit narrowing — when a user signs in, Caribou's server stores a hostname-only `caribou.instance` cookie (no token, no user identity) so bare-URL profile views can resolve which instance to query. See §9.5 and §12.2.

One small deviation: Plan 2 shipped its home timeline at `/feed` instead of the spec's `/home`. Plan 3 renames `/feed` → `/home` and leaves `/feed` as a 301 redirect. Not a spec change; a Plan 2 drift we are fixing here while the blast radius is zero.

Plan 3 also amends the v1 spec in two places (see §9 below): it inverts the §7.3 DOM-mode policy from "light DOM only" to "shadow-DOM-by-default for self-rendering components, light-DOM exception for components that coordinate keyed children" (matching the precedent set by PR #14 and the behavioral contract in `packages/elena-morph-spec`), and it defines zen mode so Plan 5 has a concrete target.

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

- `/privacy`: "Privacy policy coming soon. Caribou does not collect analytics or telemetry. Your Mastodon instance sees your activity; Caribou's server proxies unauthenticated public reads (timelines, profiles, threads) on your behalf and stores a hostname-only `caribou.instance` cookie when you sign in so bare-URL profile views know which instance to query — your access token and post content stay on your device."
- `/about`: one short paragraph — name, one-line description ("A Mastodon client built on Litro"), and a link to the project's GitHub repository. Actual URL pulled from `build-meta.generated.ts` at render time, same source the right-rail GitHub link uses.

### 3.6 Explicitly not in Plan 3

- `/notifications`, `/bookmarks`, `/lists`, `/lists/[id]`, `/tags/[tag]`, `/settings` — Plan 4.
- Interactions (favourite / boost / reply / follow) — Plan 4.
- Compose dialog — Plan 4.
- Keyboard shortcuts — Plan 5.
- Theme toggle, zen mode, `/changelog` page — Plan 5.

## 4. Data layer extensions

All new networking is a thin wrapper on the existing `request()` in `packages/mastodon-client/src/create-client.ts`. No new types — `Status` and `Account` already exist in `packages/mastodon-client/src/types.ts`.

> **SSR-seeded stores.** §12 introduces an `initial` option on `createTimelineStore`, `createProfileStore`, and `createThreadStore` so SSR-rendered routes can hydrate without a redundant client-side first fetch. The factories below otherwise unchanged. See §12.6 (hydration).

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

- `pages/components/caribou-status-card.ts` — already shadow-DOM as of PR #14, so document-level `uno.css` does NOT reach inside. Migration here goes through `@unocss/transformer-directives` baked into `static styles`, NOT raw utility classes on the rendered template. Same approach applies to every other shadow-DOM component built in Plan 3 (nav-rail, right-rail, profile-header, profile-tabs, thread).
  - **Note for §12 (no-JS):** declarative shadow DOM (`<template shadowrootmode="open">`) ships its initial CSS as an inline `<style>` *inside* the DSD template — `static styles` is adopted on hydration, but the no-JS render needs the rules in the SSR HTML directly. The SSR helper that emits a shadow-DOM component's DSD wraps its `static styles` source in an inline `<style>` at the top of the template; on hydration, Elena's `adoptedStyleSheets` path takes over and the inline `<style>` is left in place (browsers de-duplicate equivalent rules; the inline copy stops mattering). See §12.6.
- `pages/components/caribou-timeline.ts` — light-DOM (see §6 table); document-level utility classes apply directly.
- `pages/feed.ts` (during rename to `pages/home.ts`) — light-DOM page content.
- `pages/index.ts` (landing) — light-DOM page content.
- `app.ts`'s inline scraps — light-DOM page content.

## 6. Layout components

All new layout components live in `apps/caribou-elena/pages/components/`. Each extends `CaribouElement` (Elena base class) like existing components. Future adapter apps will reimplement these against their own base classes.

**Shadow-DOM is the default for self-rendering components.** This is the recommended pattern per `packages/elena-morph-spec` Section 1, and was set as precedent by PR #14's `<caribou-status-card>` migration. Every Plan 3 component that owns its rendered tree uses `static shadow = 'open'` + `static styles`:

> **Shadow DOM + SSR (DSD).** The shadow-DOM-by-default policy is compatible with the no-JS path because Elena adopts the **declarative shadow DOM** form on hydration: when SSR emits `<template shadowrootmode="open">…</template>` as the first child of a custom element, Elena (`@elenajs/core/src/elena.js:267-275`) detects the existing shadow root and skips its own `attachShadow()` call. The same `static styles` are then adopted as `adoptedStyleSheets`. Result: shadow-DOM components render server-side without a script, and hydrate to the same internal tree without reflow. See §12.6 for the detailed flow.

| Component | DOM | Reason |
|---|---|---|
| `<caribou-app-shell>` | shadow + `<slot>` | hosts arbitrary page content; `<slot>` projection requires shadow |
| `<caribou-nav-rail>` | shadow | self-renders chrome; immune to parent re-render wipes (morph-spec §1) |
| `<caribou-right-rail>` | shadow | same |
| `<caribou-status-card>` | shadow (already done in PR #14) | parent timeline polls every 30s; shadow walls the avatar `<img>` off |
| `<caribou-profile-header>` | shadow | self-renders avatar/bio chrome |
| `<caribou-profile-tabs>` | shadow | self-renders nav anchors |
| `<caribou-thread>` | shadow | self-renders ancestor/focused/descendant tree |
| `<caribou-timeline>` (renamed from `caribou-home-timeline`) | light-DOM | exception — owns parent of status cards, holds polling state, and was just stabilized in PR #13's split-bindings rework. See §8.2. |

Slotted content (anything between `<caribou-app-shell>` opening and closing tags) stays in the host's light DOM and continues to receive document-level utility CSS from `uno.css`.

**Custom properties pierce shadow boundaries** — design tokens (`var(--bg-0)`, etc.) work unchanged inside every shadow root.

**Why the timeline stays light-DOM** — it's the parent of status cards and currently uses an imperative `card.status = …` assignment in `updated()` (see `caribou-home-timeline.ts:104-111`). Moving it to shadow DOM would push that assignment across a shadow boundary and require additional plumbing for no behavioral gain — Section 1 of morph-spec only protects the *children's* rendered content, which the cards already handle. The timeline's own re-renders are already gated by a shallow-compare in PR #13's `effect()` binding.

### 6.1 Component tree

```
<caribou-app-shell>                                    shadow-DOM host
  └─ (shadow root)
       ├── <caribou-nav-rail>                          shadow-DOM component
       ├── <main><slot></slot></main>                  native slot — page content projects here
       └── <caribou-right-rail>                        shadow-DOM component (≥lg only)
```

The nav rail and right rail are themselves shadow-DOM components — their internal trees are walled off from both the shell's shadow root and the host page's morph engine. Each owns a small `static styles` adopted stylesheet (built via `@unocss/transformer-directives`) for its layout and chrome.

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

Shadow-DOM component (`static shadow = 'open'`, `static styles = [NAV_RAIL_CSS]`). Self-rendering, no slotted content. Its rendered chrome (anchors, icons, active-route highlight) lives entirely inside its shadow root, immune to parent re-renders per `packages/elena-morph-spec` Section 1.

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

Shadow-DOM component (`static shadow = 'open'`, `static styles = [RIGHT_RAIL_CSS]`). Self-rendering, no slotted content. Like the nav rail, its full rendered tree (about card, links list, disabled-slot placeholders) lives inside its shadow root.

Top to bottom:

1. **About card**
   - App name ("Caribou")
   - Version (from `build-meta.generated.ts`)
   - "built <relative time>" (from same meta via `formatRelativeTime`)
   - GitHub link (`i-lucide-github`, URL from meta)

2. **Links list**
   - Privacy → `/privacy`
   - About → `/about`
   - **Signed-in indicator (no-JS path only).** When the no-JS / SSR path is being used (i.e. the page was rendered without seeing localStorage), the right rail renders one extra line: "Signed in to **{instance}**" followed by a "Sign out" anchor pointing to `/api/signout` (existing endpoint from Plan 2). The `{instance}` value is read from the `caribou.instance` cookie on the server. Hydration replaces this with the JS-driven account chip from `me.signal` (Plan 4); for Plan 3 it remains visible whenever the cookie is set. Rationale: without JS, the user otherwise has no visible cue that they are signed in or how to sign out.

3. **Disabled slots** (visible but `aria-disabled="true"`, tooltip "Coming soon"):
   - Theme toggle (Plan 5)
   - Zen mode (Plan 5)
   - Keyboard shortcuts (Plan 4)

Slots are visible placeholders — not hidden — so users can see what's coming and so Plan 4/5 don't need to reflow the rail when wiring them.

### 6.5 `<caribou-app-shell>` — shadow-DOM layout host

**Declaration:**

```ts
export class CaribouAppShell extends Elena(HTMLElement) {
  static override tagName = 'caribou-app-shell'
  static override shadow = 'open'
  static override styles = [SHELL_CSS]   // built via @unocss/transformer-directives

  override render() {
    return html`
      <div class="shell-grid">
        <caribou-nav-rail></caribou-nav-rail>
        <main><slot></slot></main>
        <caribou-right-rail></caribou-right-rail>
      </div>
    `
  }
}
CaribouAppShell.define()
```

**Responsibilities:**

- Renders the three-pane grid inside its shadow root.
- Exposes a default `<slot>` for page content.
- Owns responsive logic via shadow-scoped CSS (container queries if needed; otherwise media queries on `host` width).
- Focus management: route change → focus `<h1>` in slotted content (spec §8.8). Shadow-DOM can still `focus()` into slotted content via `document.querySelector('caribou-app-shell h1')`.
- **Does not** own data fetching or route matching — pages still do that.

**Stylesheet source:** `SHELL_CSS` is a small hand-authored + `@unocss/transformer-directives`-processed string containing only what the shell needs — grid template, slot wrapper, responsive breakpoints (~40 lines of CSS). It is NOT the full `uno.css` bundle; the shell's DOM tree is tiny and doesn't need it.

Elena adopts `static styles` via the browser's native `adoptedStyleSheets` API (confirmed at `@elenajs/core/src/elena.js:280–299`). Browsers dedupe shared `CSSStyleSheet` objects, so memory cost is one sheet regardless of how many shell instances mount.

**Utility-class reach:** Document-level `uno.css` (inlined via `UNO_HEAD`) does NOT reach into the shell's shadow root — but it DOES style slotted content (which remains in the host's light DOM). So:
- Inside shell's shadow tree: only the classes defined in `SHELL_CSS` work. Keep the shell template minimal; no utility classes inside.
- In slotted content (every page's content): full utility class access as usual.

### 6.6 Validation POC (first task in implementation)

Before the rest of Plan 3 builds on top of this, the implementation plan's first task is a POC that **proves the approach works end to end**:

1. Stand up `<caribou-app-shell>` with `static shadow = 'open'`, a minimal `static styles`, and one `<slot>`.
2. Render a light-DOM child inside it (e.g., refactor `/home` / existing `<caribou-home-timeline>` into a temporary `<caribou-app-shell><caribou-home-timeline></caribou-home-timeline></caribou-app-shell>` wrapping).
3. Verify:
   - [ ] Slotted content renders in the correct grid cell.
   - [ ] Slotted content inherits `var(--bg-0)`, `var(--text-1)`, etc. (custom properties pierce shadow).
   - [ ] Utility classes on slotted content (e.g., `mx-auto`, `max-w-[640px]`) take effect from document-level `uno.css`.
   - [ ] Responsive breakpoint behavior — shell layout changes at `md` / `lg`.
   - [ ] Elena hydration works (the shell is SSR-rendered, then upgrades in-place without flicker).
   - [ ] Playwright smoke test: mount shell + child, assert computed styles on slotted child.

If any of these fail, the plan pauses and we reassess (back to template helper or full light-DOM). This POC is a hard gate — Plan 3's Task 1.

### 6.7 Page usage pattern

```html
<caribou-app-shell>
  <caribou-timeline kind="local"></caribou-timeline>
</caribou-app-shell>
```

Pages use the default slot (no `slot="main"` attribute needed). The shell's `<slot>` captures all children and projects them into its `<main>` cell.

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

| File | Role | Server-side `pageData` (§12.3) |
|---|---|---|
| `pages/home.ts` | refactored from `feed.ts`; renders `<caribou-timeline kind="home">` inside shell | none — auth-required, emits placeholder server-side (§8.8) |
| `pages/local.ts` | `<caribou-timeline kind="local">` | `fetchPublicTimeline({ instance, kind: 'local', maxId })` |
| `pages/public.ts` | `<caribou-timeline kind="public">` | `fetchPublicTimeline({ instance, kind: 'public', maxId })` |
| `pages/@[handle].ts` | parses `?tab=`, renders `<caribou-profile handle tab>` | `fetchAccountByHandle(handle, { instance })` then `fetchAccountStatuses(account.id, { tab, maxId, instance })` |
| `pages/@[handle]/[statusId].ts` | renders `<caribou-thread status-id>` | `fetchStatus(statusId, { instance: derivedFromHandle })` + `fetchThreadContext(statusId, { instance })` (parallel) |
| `pages/privacy.ts` | static stub | none |
| `pages/about.ts` | static stub | none |
| `pages/feed.ts` | Litro server route → 301 redirect to `/home` | none |

The `instance` value used by every public-read `pageData` fetcher is resolved by `resolveInstanceForRoute(route, params, cookies)` — see §12.3. Route files themselves stay thin; all upstream-calling logic lives in `server/lib/mastodon-public.ts` (§12.3) and is wrapped by the cache layer (§12.4).

### 8.2 `<caribou-timeline>` modifications

Existing component (Plan 2), currently named `<caribou-home-timeline>` after the only timeline kind it served. Changes:

- **Rename** `caribou-home-timeline` → `caribou-timeline` (file, class, custom-element tag, all callers, all tests). Done as a single sweeping commit.
- Accept `kind` attribute: `"home" | "local" | "public"`.
- Accept an `initial` prop carrying SSR-rendered `Status[]` (and optional `nextMaxId`). When present, the store is constructed with `createTimelineStore(kind, { initial })` and skips the first fetch on mount — `loading` starts `false`, the list renders the SSR statuses immediately, and the next `loadMore()` call uses `nextMaxId`. Only `local` and `public` are SSR'd in Plan 3 (§12.3); `home` continues to mount with no initial data because its content depends on the client-side token.
- Instantiate the appropriate `createTimelineStore(kind, { initial })` based on attr.
- **"Older posts" anchor (no-JS pagination).** Render an anchor after the last status: `<a href="?max_id={lastStatus.id}" rel="next" class="older-posts-link">Older posts →</a>`. With JS, the anchor is the source of truth that an `IntersectionObserver` sentinel hijacks: when the sentinel is intersected, JS calls `loadMore()` on the store and updates the anchor's `href` to the new `nextMaxId` (or removes the anchor if no more pages). Without JS, clicking the anchor is a full-page navigation that re-renders the timeline with the updated `?max_id`. See §12.7.
- No other changes — loading/error/empty/list/"N new posts" banner all unchanged.

**Stays light-DOM** (see §6 table). The existing PR #13 reactivity pattern carries over verbatim:

- Two separate `effect()` blocks. The first drives this component's `requestUpdate()` and shallow-compares `statuses` (length + element references) to gate re-renders, so a poll tick that only changes `statusCache` won't cascade through morph.
- The second pushes `newPostsCount` imperatively into the banner so banner-only updates never invalidate the timeline's render.
- Status-card props are assigned imperatively in `updated()` (`card.status = status`) since Elena does not wire `.prop=` bindings.

These remain correct under shadow-DOM status cards: the cards' rendered content lives inside their own shadow roots, so even when the timeline does re-render, morph never reaches into the cards' content. See `caribou-home-timeline.ts` and `caribou-status-card.ts` on the current main for the production wiring.

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
3. Instantiate `createProfileStore(client, accountId, tab, { initial })` and render its `statuses` signal as a list of `<caribou-status-card variant="timeline">`.
4. Tab change = anchor navigation → full-page navigation (authed SSR routes are full navigations per spec §8.9) → new `tab` attr → fresh component mount → fresh store. No bespoke tab-state logic.

**SSR resolution rules (§12.3):**

- **Host-qualified handle** (`/@user@host.example`): `resolveInstanceForRoute` uses `host.example` directly — no cookie required, fully unauthenticated, no SSRF concern (the hostname is part of the URL path the user navigated to and was already exposed to the network). The server fetches `https://host.example/api/v1/accounts/lookup?acct=user@host.example`, then `/api/v1/accounts/:id/statuses`.
- **Bare handle** (`/@user`): `resolveInstanceForRoute` reads the `caribou.instance` cookie. If present and validated against the OAuth `apps:*` registry (§12.2), uses that hostname. If absent or invalid, the server returns the auth-required placeholder (§8.8) with copy that says "Sign in to view profiles by bare handle" — bare-handle profiles intentionally require a known instance context.

**Pagination & store seeding:** the SSR list is rendered with the same "Older posts →" anchor as timelines (§8.2). The `initial` prop carries the SSR-rendered statuses + `nextMaxId`. Same hijack-the-anchor pattern under §12.7.

Status-list UX patterns (skeleton, empty state, infinite-scroll sentinel via `createIntersectionObserver`) are duplicated between `<caribou-timeline>` and `<caribou-profile>` in Plan 3. This is intentional: the status list inside a profile has different surrounding chrome (header + tabs) and different pagination semantics (no "N new posts above" banner since profiles don't poll). Extracting a shared `<caribou-status-list>` primitive is deferred until Plan 4 when bookmarks / notifications introduce a third call site — at three, extraction is justified; at two, it's premature.

If `lookupAccount` fails, profile page renders an error state with retry. No special 404 page in Plan 3.

### 8.4 `<caribou-thread>` (new)

Attr: `status-id`. Uses `createThreadStore(client, statusId, { initial })`. The `initial` option carries SSR-rendered `{ focused, ancestors, descendants }`; when present, both `focused` and `context` `AsyncState`s start in `'ready'` and the store skips the parallel mount fetch. Same instance-resolution rules as §8.3 (host-qualified handle uses path host directly, bare handle requires the cookie).

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

The core card was upgraded in PR #14 to its current shape: shadow-DOM (`static shadow = 'open'`), `static styles` carrying the sanitized-content wrap rules, DOMPurify-sanitized content via `unsafeHTML` inside `render()`, avatar onerror retry (300ms / 600ms backoff, dim on permanent failure), `loading="lazy" decoding="async"` on the avatar `<img>`. Plan 3 does **not** redo any of that — it only layers variant rendering on top of the existing component.

Plan 3 changes:

- Add a `variant` attr / prop to the existing `<caribou-status-card>`.
- Per-variant styling lives in `static styles`, not in document-level utility classes (the card is shadow-DOM; document-level `uno.css` does not reach inside).
- Variant CSS is built via `@unocss/transformer-directives` so the same token utilities can be `@apply`'d inside the adopted stylesheet.

| Variant | Used by | Visual |
|---|---|---|
| `timeline` (default) | timelines, profile lists | current PR-#14 look (compact) |
| `focused` | thread center | larger text, accent border, full absolute timestamp, no truncation |
| `ancestor` | thread above focused | muted (`opacity-75`), compact |
| `descendant` | thread below focused | indent via `margin-left` utility, "→ @replied-to-handle" line above content |

- Variant is a CSS concern only — classes conditional on attr value, applied inside the shadow tree.
- Existing DOMPurify + `PURIFY_OPTS` content rendering is shared across all variants.
- Existing avatar retry + `loading="lazy"` behavior is shared across all variants.
- No separate component files.

**PURIFY_OPTS hoisted to a shared module.** The current literal lives at the top of `apps/caribou-elena/pages/components/caribou-status-card.ts` (`PURIFY_OPTS = { ALLOWED_TAGS: [...], ALLOWED_ATTR: [...], ALLOW_DATA_ATTR: false }`). Plan 3 moves it to `packages/caribou-mastodon-client/src/sanitize-opts.ts` so the same allowlist is consumed by both client-side (status card) and server-side (`server/lib/sanitize.ts`, §12.5) sanitization. Identical allowlist on both sides is a prerequisite for hydration parity (§12.6) — an even subtle divergence would cause the server-rendered HTML to differ byte-for-byte from the client `render()` output, triggering Elena's morph step to rebuild every status card on hydration.

### 8.6 Boost rendering

Currently `<caribou-status-card>` treats every status as if its content lived on the outer status. For boosts (`status.reblog != null`), the outer `status.content` is empty and the renderable content lives on `status.reblog`. The card therefore renders boosts as blank cards in production today. Plan 3 fixes this.

**Render rule:**

- If `status.reblog` is present, render the reblog: avatar, display name, handle, timestamp, sanitized content, and (later) media all come from `status.reblog`.
- Above the reblog content, render a one-line attribution row: `↻ {status.account.displayName} boosted` (icon `i-lucide-repeat-2`). Clicking the attribution row links to `/@{status.account.acct}` (the booster's profile), wired in Plan 4 — Plan 3 renders it as a non-interactive label.
- The reblog's own `id` is what `[statusId].ts` and `<caribou-thread>` operate on when navigating to a status.

**Variants:** the boost handling is identical across `timeline`, `focused`, `ancestor`, and `descendant` variants — same attribution row above, same inner reblog content. Thread layout treats the reblog (not the wrapper) as the canonical status for ancestor / descendant chain calculations.

**Determining the status to render:** introduce a tiny pure helper inside the card, e.g. `const display = status.reblog ?? status` — and use `display.account`, `display.content`, `display.createdAt`, etc. throughout the template. The wrapper is consulted only for the attribution row.

**Tests:**

- Unit-level: render the card with a reblog fixture; assert (a) the displayed account is the reblogged author, (b) the displayed content is the reblogged content, (c) the attribution row contains the booster's display name + repeat icon, (d) the same assertions hold for `focused` / `ancestor` / `descendant` variants.
- Integration-level: extend the existing timeline Playwright smoke test with one reblog in the fixture set; assert no blank cards.

### 8.7 Stub page markup

`pages/privacy.ts`:

```html
<caribou-app-shell>
  <article slot="main" class="prose text-1">
    <h1 class="text-2xl font-semibold mb-4">Privacy</h1>
    <p class="text-2">
      Privacy policy coming soon. Caribou does not collect analytics or
      telemetry. Your Mastodon instance sees your activity; Caribou's
      server proxies unauthenticated public reads (timelines, profiles,
      threads) on your behalf and stores a hostname-only
      <code>caribou.instance</code> cookie when you sign in so bare-URL
      profile views know which instance to query — your access token and
      post content stay on your device.
    </p>
  </article>
</caribou-app-shell>
```

`pages/about.ts` is analogous.

### 8.8 Auth-required placeholder (`/home`, `/@me`, `/@me/[id]`)

Routes that require the user's access token cannot be SSR-rendered (Caribou's server never sees the token — see §11 of the parent spec, §12.1). For these routes, the SSR shell emits a placeholder card inside `<caribou-app-shell>`:

```html
<caribou-app-shell>
  <article class="auth-required-placeholder">
    <h1 class="text-2xl font-semibold">Sign in to continue</h1>
    <p class="text-2">
      <code>/home</code> shows your personal timeline. It requires
      a Mastodon access token, which Caribou keeps on your device.
      <a href="/" class="text-accent underline">Sign in</a>
      to view it.
    </p>
  </article>
</caribou-app-shell>
```

When JS runs and an active session is present in localStorage, the home / profile-me / status-me pages take over and replace the placeholder with the real component (`<caribou-timeline kind="home">`, `<caribou-profile handle="@me">`, etc.). The placeholder remains visible the entire time JS is bootstrapping; once `me.signal` resolves and the active client is ready, the page swaps.

**Routes covered:**

- `/home` — always auth-required.
- `/@me` (resolved client-side from `me.signal.handle`) — short-circuited to placeholder unless JS resolves the redirect to `/@user@host`.
- `/@me/[statusId]` — same; placeholder until JS resolves.
- Any bare-handle profile (`/@user`) when `caribou.instance` cookie is absent or invalid — falls through to a copy variant: "Sign in to view profiles by bare handle" (§8.3).

The placeholder is a single light-DOM template fragment, not a custom element. No JS, no shadow DOM. It uses `var(--text-1)` / `var(--text-accent)` directly so it styles correctly under the inlined `tokens.css`.

## 9. Parent spec amendments

Plan 3 introduces two amendments to the v1 spec (`docs/superpowers/specs/2026-04-21-caribou-v1-design.md`): a carve-out to the light-DOM policy for layout components, and the definition of zen mode so Plan 5 has a concrete target.

### 9.0 Amendment — §7.3 (Styling / DOM mode)

Current text reads "Force light DOM in all three adapter variants." Replace with:

> **DOM mode:** Shadow DOM is the default for components that own their rendered tree (`<caribou-app-shell>`, `<caribou-nav-rail>`, `<caribou-right-rail>`, `<caribou-status-card>`, `<caribou-profile-header>`, `<caribou-profile-tabs>`, `<caribou-thread>`, etc.). Self-rendering components walled off behind a shadow root are immune to parent re-render wipes — see the behavioral contract in `packages/elena-morph-spec/src/__tests__/morph-custom-elements.test.ts`. Such components ship their own small `static styles` (adopted via the browser's native `adoptedStyleSheets`) built with `@unocss/transformer-directives` so token utilities still apply.
>
> **Exception:** components whose primary job is to host children with arbitrary keyed identity (e.g. `<caribou-timeline>`, which manages a list of status cards plus polling state) may stay light-DOM. These components must gate their own re-renders explicitly (shallow-compare on signal change, split bindings per child component) so morph never wipes their child trees needlessly.
>
> Slotted content (anything between a shadow-DOM component's opening and closing tags) stays in the host's light DOM and continues to receive document-level utility CSS from `uno.css`. Custom properties (design tokens) pierce shadow boundaries.

Rationale: PR #14 demonstrated that the simplest, most durable pattern for a component that polls (timeline) hosting components that self-render (status cards) is for the children to use shadow DOM. This generalizes: any component that wants to be re-rendered safely by an arbitrary parent should opt into shadow DOM. The earlier "light DOM only" stance traded reactivity safety for one-stylesheet convenience and was incompatible with `<slot>`-based composition. The exception covers the small number of components whose internal model genuinely needs to coordinate light-DOM children.

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

### 9.5 Amendment — §11 (privacy / what the server sees)

Plan 3 introduces server-side fetches against the user's Mastodon instance for **public read paths only** (timelines, profiles, threads). To support this without leaking signed-in user identity, the server stores one piece of state per session: a hostname-only cookie.

Add to §11 (or wherever the parent spec describes "what the server sees"):

> **`caribou.instance` cookie.** When a user signs in, Caribou's server sets a cookie named `caribou.instance` whose value is the **hostname only** of the user's Mastodon instance (e.g. `mastodon.social`, `fosstodon.org`). The cookie is `Secure`, `HttpOnly`, `SameSite=Lax`, `Max-Age=31536000`, `Path=/`. It contains no access token, no user ID, no acct, and no display name — only the instance hostname.
>
> The cookie's purpose is bare-URL public read paths: when an unauthenticated request lands on `/@user`, `/local`, or `/public`, the server uses the cookie to know which Mastodon instance to query upstream. This avoids forcing every public route to require either a host-qualified URL or client-side JavaScript.
>
> The cookie value is validated against the OAuth registry on every read (`server/lib/storage.ts` keys: `apps:<host>:<origin>`). If the cookie hostname is not a hostname Caribou has previously registered an OAuth app with, the server treats the cookie as absent. This kills the SSRF amplification class where an attacker would set `caribou.instance=169.254.169.254` (or any private/internal address) to make Caribou's server fetch from arbitrary hosts.
>
> The cookie is cleared by `/api/signout` alongside the existing localStorage purge.

This narrows but does not break the parent spec's privacy promise: the server still does not see the user's access token, post content, or timeline contents from authenticated endpoints. It does see (a) which instance the user signed in to, and (b) which public statuses / profiles a user is browsing if they use the no-JS path. The parent spec already discloses (a) implicitly (the OAuth handshake hits the server). The (b) disclosure is genuinely new and is called out explicitly in the privacy stub copy (§3.5).

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

- **Shell POC (§6.6)** — Playwright smoke test mounting `<caribou-app-shell>` with a slotted child, asserting: (a) slotted content appears in the expected grid cell, (b) slotted child's computed `color` resolves `var(--text-1)` to the dark-theme value, (c) utility class `max-w-[640px]` applied to slotted content produces the expected `max-width`, (d) responsive grid layout changes between 500px / 800px / 1200px viewports. This test is the gate for §6.6 and must pass before any other Plan 3 work merges.
- `caribou-status-card` variant rendering — four tests (one per variant) with a canned `Status` fixture. Assert the utility classes applied on the root element, not pixel output.
- `caribou-status-card` boost rendering — render with a reblog fixture; assert displayed account/content come from `status.reblog`, attribution row shows the booster, and no blank card. Repeat across all four variants.
- `caribou-thread` indent cap — render a depth-5 descendant chain, assert DOM indentation stops at depth 3.
- `caribou-profile` tab parsing — mount with `?tab=media`, assert `onlyMedia: true` was passed to `createProfileStore`.
- **SSR hydration parity** — for each SSR'd public route (`/local`, `/public`, `/@user@host`, `/@user@host/[id]`), unit-level test that renders the route's `pageData` output and the corresponding component's `render()` output and asserts the two HTML strings are byte-equal (after normalizing whitespace). Catches the most common hydration-flicker class: a server-side branch that adds or omits an attribute the client doesn't. Uses a fixed `now` so relative timestamps are deterministic in both paths (in fact, server emits absolute timestamp; client substitutes the relative form on hydration — see §12.6).
- **Cookie hostname validation** — unit test for `getInstance(event)`: cookie set to a registered host returns the host; cookie set to an unregistered host returns `undefined`; cookie set to `169.254.169.254` returns `undefined`; missing cookie returns `undefined`.
- **Playwright JS-disabled smoke** — single Playwright test launched with `javaScriptEnabled: false`. Visits `/local` (using a test fixture instance), asserts: at least one status card is visible, "Older posts →" anchor is visible, clicking the anchor navigates to `/local?max_id=…` and renders a different status set, no console errors. Also visits `/home` and asserts the auth-required placeholder is shown. This is the only no-JS Playwright test in Plan 3 — the rest of the no-JS path is covered by the byte-equal hydration parity tests above.

**Behavioral contract for shadow-DOM components:** every shadow-DOM component built in Plan 3 is implicitly tested by `packages/elena-morph-spec/src/__tests__/morph-custom-elements.test.ts`. That suite verifies (Section 1) that children with `static shadow = 'open'` survive parent re-renders without their internal trees being wiped. Plan 3 does not add new morph-spec tests — it relies on the existing suite and the precedent set by PR #14. If a Plan 3 component breaks under poll-driven re-render in production, the fix is to make it shadow-DOM, not to add another bespoke test.

### 10.3 E2E tests

Only the shell POC test (in §10.2) is new. Existing Playwright suite (signin + home timeline from Plan 2) runs in CI unchanged.

Rationale: adding Playwright coverage for remaining read-only screens delivers little signal per minute of test runtime. Unit + integration tests catch regressions more cheaply. Plan 4 adds E2E for interactions — the feature that genuinely needs click-through coverage.

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

- Favourite / boost / reply / follow (interactions)
- Compose dialog (textarea, CW, visibility, media upload, alt-text)
- Notifications view + unread badge + 60s polling
- Bookmarks view
- Lists (CRUD + list timelines)
- Hashtag timelines (`/tags/[tag]`)
- Settings page (account mgmt, default timeline picker)
- Keyboard shortcut registry + `createFocusTrap` in `caribou-ui-headless`
- E2E coverage for any of the above

### 11.1a Deferred follow-up (separate post-Plan-3 PR, before Plan 4 starts)

- **Keyed-list reconciliation in `<caribou-timeline>`.** The current shallow-compare in PR #13's `effect()` binding gates re-renders correctly but, when a re-render does happen, morph still walks the full status list by index. Long timelines pay the cost; cards that didn't change are still reconciled in place. Replace the indexed `.map()` render with keyed reconciliation by `status.id` so prepends (poll, applyNewPosts) only insert new nodes and appends (loadMore) only push new ones. Lands as a focused PR after Plan 3 merges; not in Plan 3's scope because (a) it's not blocking read-only completeness and (b) it deserves its own PR with measurable before/after numbers.

### 11.1b Deferred operational follow-ups (no fixed schedule, triggers documented)

These items are deliberately deferred from Plan 3. Each has a concrete trigger that should re-open it; until the trigger fires, they are not blocking work.

- **Cache observability — counters + structured logs in `upstream-cache.ts` (§12.4).** Count cache hit/miss/in-flight-dedup events, log slow upstream fetches above a threshold, optionally expose a `/_metrics` endpoint behind a flag. **Trigger:** sustained traffic where upstream rate-limit breaches start appearing in logs, or perceived latency on `/local` / `/public` exceeds 1s p50. Without traffic, observability code is speculative.
- **Synthetic load testing of the public-read pipeline.** A small `k6` (or equivalent) script that hits `/local` and `/@user@host` at controlled concurrency, asserts the cache absorbs duplicates correctly, and measures upstream call rate. **Trigger:** any deployment to a host that is publicly indexable (currently: `caribou.quest`), or before announcing the project on a public forum where traffic spike is plausible.
- **Stricter SSRF protection for the cookie pipeline.** Plan 3 validates the cookie hostname against the OAuth `apps:*` registry (§12.2) — that's already a strong filter. Stricter follow-ups: explicit deny-list of RFC-1918 / link-local / loopback ranges enforced before DNS resolution; pinning resolved IPs through a curated DNS resolver; outbound network policy at the host level. **Trigger:** the OAuth registry validation gets bypassed in any way (e.g., a future plan stores `apps:*` keys for development hosts in production), or an external security review flags it.
- **Cookie tampering tests.** Targeted unit tests that simulate forged `caribou.instance` values: empty string, `..`, IPv6 literal, embedded `\r\n`, very long string, hostname-with-credentials (`user:pass@host`). All must be rejected by `getInstance(event)`. **Trigger:** any change to `instance-cookie.ts` validation logic, or before the first external security review. **Out of scope for Plan 3** because the validation logic has only one shape (registry membership) and `URL` parsing handles the malformed-input cases adequately for the threat model at this traffic level.

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
- **Light-DOM shell with template helper function** — rejected in favor of shadow-DOM shell. Template helpers scatter layout markup across every page's render method; shadow-DOM shell centralizes it and uses `<slot>` native composition. Also translates to Lit/FAST ports more cleanly.
- **Light-DOM-by-default for all components** — earlier draft kept feature components light-DOM and only opted shells into shadow. Rejected once PR #14 demonstrated that shadow-DOM is also the simplest way to make a self-rendering component immune to parent-driven re-renders (the timeline-polls-card-flicker problem). Plan 3 inverts the default: shadow-DOM for self-rendering components, light-DOM only as a deliberate exception (`<caribou-timeline>`). See §9.0.
- **Keyed-list reconciliation as part of Plan 3** — would touch `<caribou-timeline>`'s render path under poll pressure; high-blast-radius for a plan whose goal is read-only completeness. Deferred to a focused post-Plan-3 PR (§11.1a).
- **Use `<litro-link>` / `LitroRouter` for client-side navigation.** Considered as part of the §12 amendment to make navigation between SSR'd pages snappier. Rejected: `LitroRouter.go()` requires an instantiated `LitroRouter` with a configured outlet element; using `<litro-link>` without that bootstrap leaves the URL changed but the page content unchanged ("soft break"). Wiring up the SPA-router primitives correctly would mean dual rendering pipelines (server-side full HTML for cold loads, client-side fragment swaps for warm navigations) — which is exactly the complexity Plan 3 is trying to avoid. Plain `<a>` everywhere keeps a single rendering pipeline (server emits HTML, client hydrates in place). Plan 5 may revisit if SPA-style navigation becomes worth the cost.
- **Token in a server cookie instead of the URL fragment / localStorage.** Considered as a way to make `/home` SSR-able. Rejected: this would invert the parent spec's privacy property (server now sees the token; can issue requests on the user's behalf; gains a new exfiltration target). The complexity to do it safely (encrypted cookie at rest, minted-per-session keys, careful rotation) is significant for a feature whose only payoff is server-rendering one screen the user sees only after they've already executed JS to sign in. The placeholder pattern (§8.8) ships `/home` no-JS-friendly enough to satisfy "site doesn't crash without JS" without giving up the privacy property.

---

## 12. Progressive enhancement & no-JS support

### 12.1 Goal & scope

Caribou's public read paths must be **fully usable without JavaScript**. With JS disabled, a user can browse `/local`, `/public`, profile views (`/@user@host`, and `/@user` if the `caribou.instance` cookie is set), single-status views, and threads. Pagination works through full-page navigations. Privacy stub and About stub render normally.

**Auth-required routes** (`/home`, `/@me`, `/@me/[id]`) render a sign-in placeholder server-side (§8.8) and only become functional once JS hydrates a signed-in session. This is non-negotiable: Caribou's server must never receive the user's access token (parent spec §11), which means routes whose content depends on the token cannot be SSR-rendered.

**Privacy property preserved (Approach B from brainstorm).** The server proxies unauthenticated public reads and stores one piece of state per session: a hostname-only `caribou.instance` cookie. The server still does not see the user's access token, post content from authenticated endpoints, or which authenticated timelines they are viewing. New disclosures in Plan 3:

1. The server sees which instance a user signed in to (already implicit from the OAuth handshake).
2. The server sees which public statuses / profiles a no-JS user is browsing (this disclosure is genuinely new and is called out in the privacy stub copy, §3.5).

**What this rules out.** No SSR for the home timeline. No SSR for boost / favourite / reply actions (write features, deferred to Plan 4 anyway). No SSR for "load more on scroll without leaving the page" — JS users get IO-sentinel hijacks; no-JS users get full-page navigations via the same anchor.

### 12.2 The `caribou.instance` cookie

**Purpose:** without JS, the client cannot tell the server which Mastodon instance to fetch from for bare-URL routes like `/@user` or `/local`. The cookie carries that one piece of context.

**Format and properties:**

- **Name:** `caribou.instance`
- **Value:** hostname only (e.g., `mastodon.social`, `fosstodon.org`). No scheme, no port, no path, no credentials.
- **Attributes:** `Secure; HttpOnly; SameSite=Lax; Max-Age=31536000; Path=/`.
- **Lifetime:** one year. Refreshed on next signin.

**Set on signin.** `server/lib/signin-callback.ts` already returns a `kind: 'ok'` result that redirects to `/signin/done#token=…&server=…`. The catch-all route handler that processes the OAuth callback now also sets the cookie before returning the redirect. The setter is a one-liner using h3's `setCookie`:

```ts
import { setCookie } from 'h3'

setCookie(event, 'caribou.instance', stateData.server, {
  secure: true,
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 60 * 60 * 24 * 365,
  path: '/',
})
```

**Cleared on signout.** The existing `/api/signout` endpoint (Plan 2) gains one extra line:

```ts
setCookie(event, 'caribou.instance', '', { maxAge: 0, path: '/' })
```

**Helper module:** `apps/caribou-elena/server/lib/instance-cookie.ts` (~30 lines):

```ts
import { getCookie, setCookie } from 'h3'
import type { H3Event } from 'h3'
import { appKey, type OAuthApp } from './storage.js'

const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i

export async function getInstance(event: H3Event, deps: {
  storage: { getItem<T>(key: string): Promise<T | null> }
  origin: string
}): Promise<string | undefined> {
  const raw = getCookie(event, 'caribou.instance')
  if (!raw) return undefined
  if (!HOSTNAME_PATTERN.test(raw)) return undefined
  const app = await deps.storage.getItem<OAuthApp>(appKey(raw, deps.origin))
  return app ? raw : undefined
}

export function setInstance(event: H3Event, hostname: string) {
  setCookie(event, 'caribou.instance', hostname, {
    secure: true, httpOnly: true, sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365, path: '/',
  })
}

export function clearInstance(event: H3Event) {
  setCookie(event, 'caribou.instance', '', { maxAge: 0, path: '/' })
}
```

**Validation pipeline (defense against SSRF amplification):** `getInstance` runs the cookie value through three filters before returning it:

1. **Format check.** A regex requires the value to look like a real DNS hostname (lowercase letters, digits, hyphens; at least one dot; no leading/trailing hyphen per label). Rejects garbage, IPv4 literals, IPv6 literals, embedded `\r\n`, `..`, hostname-with-credentials.
2. **Registry membership.** The value must be a key for which `apps:<host>:<origin>` is present in storage — i.e., Caribou has previously registered an OAuth app with this instance. The `apps:*` registry is populated by `signin-callback.ts` only after a successful OAuth handshake (parent spec §11), so attackers cannot pre-poison it.
3. **Origin scoping.** The `apps:<host>:<origin>` key includes the current origin. A cookie set in one Caribou deployment cannot point the upstream fetcher at an instance only registered for a different origin.

**Why this matters:** without registry membership, a forged cookie like `caribou.instance=169.254.169.254` (AWS metadata IP), `caribou.instance=localhost`, or `caribou.instance=internal-redis.svc.cluster.local` would let an attacker make Caribou's server fetch from arbitrary internal addresses (SSRF amplification). With registry membership, the only allowed hostnames are ones the deployment operator has already opted into via OAuth handshake. This is checked **on every public-read fetch**, not just at signin.

### 12.3 The fetch pipeline

New module: `apps/caribou-elena/server/lib/mastodon-public.ts` (~120 lines). Exposes the unauthenticated upstream calls used by SSR `pageData` fetchers.

```ts
import type { Status, Account } from '@beatzball/caribou-mastodon-client'
import { cachedFetch, TTL } from './upstream-cache.js'

export interface PublicFetchOpts { instance: string }

export async function fetchPublicTimeline(
  opts: PublicFetchOpts & { kind: 'local' | 'public'; maxId?: string },
): Promise<Status[]> {
  const params = new URLSearchParams()
  if (opts.kind === 'local') params.set('local', 'true')
  if (opts.maxId) params.set('max_id', opts.maxId)
  const url = `https://${opts.instance}/api/v1/timelines/public?${params}`
  return cachedFetch<Status[]>(url, TTL.PUBLIC_TIMELINE)
}

export async function fetchAccountByHandle(
  handle: string,
  opts: PublicFetchOpts,
): Promise<Account> {
  const url = `https://${opts.instance}/api/v1/accounts/lookup?acct=${encodeURIComponent(handle)}`
  return cachedFetch<Account>(url, TTL.PROFILE)
}

export async function fetchAccountStatuses(
  accountId: string,
  opts: PublicFetchOpts & { tab: 'posts' | 'replies' | 'media'; maxId?: string },
): Promise<Status[]> {
  const params = new URLSearchParams()
  if (opts.tab === 'posts') params.set('exclude_replies', 'true')
  if (opts.tab === 'media') params.set('only_media', 'true')
  if (opts.maxId) params.set('max_id', opts.maxId)
  const url = `https://${opts.instance}/api/v1/accounts/${encodeURIComponent(accountId)}/statuses?${params}`
  return cachedFetch<Status[]>(url, TTL.PROFILE_STATUSES)
}

export async function fetchStatus(statusId: string, opts: PublicFetchOpts): Promise<Status> {
  const url = `https://${opts.instance}/api/v1/statuses/${encodeURIComponent(statusId)}`
  return cachedFetch<Status>(url, TTL.STATUS)
}

export async function fetchThreadContext(
  statusId: string,
  opts: PublicFetchOpts,
): Promise<{ ancestors: Status[]; descendants: Status[] }> {
  const url = `https://${opts.instance}/api/v1/statuses/${encodeURIComponent(statusId)}/context`
  return cachedFetch<{ ancestors: Status[]; descendants: Status[] }>(url, TTL.THREAD_CONTEXT)
}
```

**Instance resolution.** Each route's `pageData` fetcher uses a small helper to decide which instance to pass:

```ts
// resolveInstanceForRoute(route, params, event):
// - host-qualified handle in path → use the path host directly
// - bare handle / no handle in path → use getInstance(event)
// - if neither yields a host → render auth-required placeholder (§8.8)
```

**No upstream auth.** Every fetch in this module is unauthenticated. Mastodon servers expose `/api/v1/timelines/public`, `/api/v1/accounts/*`, `/api/v1/statuses/*` to anonymous requests for public content. Caribou never attaches the user's bearer token server-side.

**Error handling.** Upstream 404 → the route renders an error state inside the shell ("Status not found", "Account not found"). Upstream 5xx / network error → render a transient-error state with a "Retry" link that re-runs the same URL. No retries inside the cache layer (one shot per request); retries belong to the JS hydration path or to the user clicking "Retry".

### 12.4 The upstream cache

New module: `apps/caribou-elena/server/lib/upstream-cache.ts` (~50 lines). Two responsibilities:

1. **Short-TTL in-memory LRU** keyed by full upstream URL. Reduces per-request load when many users are browsing the same public timeline / status.
2. **In-flight request dedup.** A `Map<url, Promise>` ensures that if two requests for the same URL arrive while one upstream fetch is mid-flight, the second await the first instead of issuing a second upstream call. Kills the thundering-herd class.

```ts
import { LRUCache } from 'lru-cache'

export const TTL = {
  PUBLIC_TIMELINE: 15_000,    // ms
  STATUS: 60_000,
  THREAD_CONTEXT: 60_000,
  PROFILE: 300_000,
  PROFILE_STATUSES: 60_000,
} as const

const lru = new LRUCache<string, { value: unknown; expiresAt: number }>({ max: 5_000 })
const inflight = new Map<string, Promise<unknown>>()

export async function cachedFetch<T>(url: string, ttlMs: number): Promise<T> {
  const now = Date.now()
  const cached = lru.get(url)
  if (cached && cached.expiresAt > now) return cached.value as T

  const existing = inflight.get(url)
  if (existing) return existing as Promise<T>

  const promise = (async () => {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`upstream ${res.status} ${url}`)
      const value = (await res.json()) as T
      lru.set(url, { value, expiresAt: Date.now() + ttlMs })
      return value
    } finally {
      inflight.delete(url)
    }
  })()

  inflight.set(url, promise)
  return promise
}
```

**TTL rationale:**

- **Public timelines (15s):** highest update frequency. Users who reload `/public` expect freshness. Cache window is small enough that mid-flight collisions during a viral moment dominate the savings.
- **Statuses + thread context (60s):** deletions and edits are rare; a one-minute window between cache writes is barely perceptible to a reader and significantly reduces upstream load on viral-thread reads.
- **Profile metadata (300s):** rarely changes (display name, bio, header). Long TTL.
- **Profile statuses (60s):** profile owners post; new posts should appear within a minute.

**LRU bound (`max: 5_000`):** assuming average payload ~5 KB, full cache ~25 MB. Comfortable for a 1-vCPU Nitro deployment. Eviction is global LRU; per-key TTLs ensure stale entries are not served regardless of LRU position.

**No persistence.** Cache is per-process, in memory. Server restart drops all entries. Acceptable: TTLs are short anyway.

**Operational deferments.** Hit/miss counters, structured logging, metrics endpoint are deferred to §11.1b.

### 12.5 The server-side sanitizer

New module: `apps/caribou-elena/server/lib/sanitize.ts` (~10 lines):

```ts
import DOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'
import { PURIFY_OPTS } from '@beatzball/caribou-mastodon-client/sanitize-opts'

const purify = DOMPurify(new JSDOM('').window as unknown as Window)

export function sanitize(html: string): string {
  return purify.sanitize(html, PURIFY_OPTS)
}
```

**`PURIFY_OPTS` is the shared allowlist** at `packages/caribou-mastodon-client/src/sanitize-opts.ts`:

```ts
export const PURIFY_OPTS = {
  ALLOWED_TAGS: ['p', 'br', 'a', 'span', 'em', 'strong', 'ul', 'ol', 'li', 'code', 'pre'],
  ALLOWED_ATTR: ['href', 'rel', 'target', 'class', 'lang'],
  ALLOW_DATA_ATTR: false,
} as const
```

**Why DOMPurify + jsdom directly, not `isomorphic-dompurify`:** the wrapper exists to abstract the "browser DOM vs. jsdom" decision behind a single import. Caribou doesn't gain from that abstraction — server code paths and client code paths live in different files anyway (`server/lib/sanitize.ts` vs. `pages/components/caribou-status-card.ts`). The wrapper would add a version-pinning lag (its DOMPurify dep tracks separately from ours) and ESM/CJS interop quirks for no benefit. Three additional lines of glue is the entire cost of skipping it.

**Why a single shared `PURIFY_OPTS` is non-negotiable:** hydration parity (§12.6). If the server allowlist accepts `<span class="invisible">` and the client allowlist doesn't, the SSR HTML and the client `render()` output diverge — the client morph engine then walks every status card and rebuilds it, defeating the whole point of SSR. Both paths import `PURIFY_OPTS` from `@beatzball/caribou-mastodon-client/sanitize-opts`; bumping the allowlist requires editing one file.

### 12.6 Hydration parity

**Goal:** for every SSR'd public route, the HTML the server emits is byte-equal (after whitespace normalization) to what the client `render()` would produce given the same data. When that holds, Elena's hydration is a no-op morph: the existing DOM tree is kept; props are wired up; signals start tracking.

**The five sources of divergence and their mitigations:**

1. **Sanitization differences.** Mitigated by shared `PURIFY_OPTS` (§12.5).
2. **Locale-dependent output.** Mitigated by passing the page's `Accept-Language` to the SSR rendering context and using the same `Intl` calls on both sides. For Plan 3, only English copy is rendered, so divergence risk is low; we still pass the locale to the rendering context for forward-compatibility.
3. **Time-dependent output (relative timestamps).** The client renders relative timestamps via `formatRelativeTime` (§7.3); the server cannot, because "5m" vs "6m" depends on the wall clock at render. **Resolution:** SSR emits the absolute ISO timestamp inside a `<time datetime="…">…</time>` element with the absolute formatted form as inner text ("Apr 14, 16:32"). On client mount, the status card replaces the inner text with the relative form. The `<time>` element's `datetime=` attribute is unchanged by hydration; only the inner text changes. This swap happens after morph, so it does not cause a hydration mismatch — it's a deliberate post-hydration update, gated by JS being present.
4. **Element ordering inside collections.** Trivially preserved as long as both sides iterate `statuses` in the same order. Passing `initial` directly into `createTimelineStore` guarantees this.
5. **Whitespace inside templates.** Elena's template engine collapses whitespace consistently. SSR emits HTML through the same template strings (the components themselves run server-side via `renderToString`); both sides go through the same whitespace handling.

**Declarative shadow DOM (DSD) flow:**

When a page contains `<caribou-status-card>` (a shadow-DOM component), SSR emits:

```html
<caribou-status-card data-index="0" data-status-id="…">
  <template shadowrootmode="open">
    <style>/* contents of static styles */</style>
    <article>… status card markup …</article>
  </template>
</caribou-status-card>
```

The browser parses `<template shadowrootmode="open">` and attaches a shadow root automatically (it is a built-in HTML platform feature; no JS required). Without JS, the user sees the styled card. With JS, on hydration:

1. Elena's upgrade path runs (`@elenajs/core/src/elena.js:267-275`): it sees `this.shadowRoot != null`, so it skips its own `attachShadow()` call and reuses the DSD-attached root.
2. `static styles` is converted to `CSSStyleSheet` and pushed onto `shadowRoot.adoptedStyleSheets`. The browser de-duplicates equivalent rules — the inline `<style>` from DSD remains in the DOM but its rules are overlapped by the adopted sheet.
3. The component's `render()` runs; morph is a no-op because the existing DOM matches.
4. Props (`status`) are assigned imperatively from the parent's `updated()` lifecycle (existing pattern from PR #14).

**Light-DOM components** (e.g., `<caribou-timeline>`) are simpler — no DSD. SSR emits the rendered light-DOM children directly inside the custom element. On hydration, Elena's upgrade calls `connectedCallback`, which runs the same effect bindings, sees `this.statuses` already populated from the `initial` prop (set imperatively by the page on mount, just before the upgrade settles), and morph is a no-op.

**Initial-data delivery.** Each page's render method receives a `pageData` object from Litro's `definePageData`. The page assigns the relevant slice to the component imperatively, e.g.:

```ts
// pages/local.ts (sketch)
export const pageData = definePageData(async (event) => {
  const instance = await getInstance(event, { storage, origin })
  if (!instance) return { kind: 'auth-required' as const }
  const maxId = getQueryParam(event, 'max_id') || undefined
  const statuses = await fetchPublicTimeline({ instance, kind: 'local', maxId })
  return { kind: 'ok' as const, statuses, nextMaxId: statuses.at(-1)?.id }
})

// in render path:
//   if (pageData.kind === 'auth-required') emit placeholder (§8.8)
//   else: <caribou-app-shell><caribou-timeline kind="local" .initial=${pageData}></caribou-timeline></caribou-app-shell>
```

Litro serializes `pageData` into a `<script type="application/json" id="__litro_data">…</script>` block in the SSR HTML; on hydration, the page's client bootstrap reads that JSON and uses it to set the `initial` prop on the relevant component before Elena's upgrade settles. Plan 3 is the first plan to use per-route `pageData` for hydration (Plan 2's signed-in session lives in localStorage, not in a server-rendered `pageData` block).

### 12.7 Pagination — anchor as source of truth

**The pattern:**

```html
<ul class="status-list">
  <li>… status …</li>
  …
</ul>
<a href="/local?max_id=110123" rel="next" class="older-posts-link" data-sentinel>
  Older posts →
</a>
```

The anchor is rendered both server-side and client-side. Without JS, clicking it is a normal full-page navigation: the route's `pageData` runs again with the new `max_id`, the server emits HTML with the next page of statuses + a new anchor pointing further back.

With JS, the timeline component:

1. On mount, registers an `IntersectionObserver` on the anchor element (`data-sentinel`).
2. When the anchor scrolls into view, the IO callback calls `loadMore()` on the store. `loadMore()` issues an authenticated client-side fetch (for `/local` and `/public` it is also unauthenticated — same code path as anonymous reads, but routed through the client `CaribouClient` instance), appends results to `statuses`, and the timeline re-renders with the appended cards.
3. The IO callback also updates the anchor's `href` to point to the new `nextMaxId` (or removes the anchor entirely if the upstream returned an empty array). The anchor is the single source of truth for "where the next page lives."
4. `event.preventDefault()` is wired on the anchor's `click` event to prevent the full-page navigation when JS is active.

**Why anchor-as-source-of-truth:** the alternative is "JS computes the next URL from the store; HTML doesn't have a working link." That breaks no-JS users entirely. Anchor-as-source-of-truth means both paths converge on the same data: the URL the JS path is about to fetch is the same URL the no-JS path would navigate to.

**Edge case — `?max_id=` when JS is also using IO sentinels.** If a user with JS visits `/local?max_id=110123` directly (e.g., from a bookmark or shared link), the SSR HTML contains 20 statuses starting at 110123. The timeline mounts with `initial: { statuses, nextMaxId }`. The IO sentinel observes the new anchor. From here, JS-driven appends continue normally. The starting `?max_id=` in the URL is a snapshot of what the user navigated in with; it does not need to be removed from the address bar.

**Edge case — pagination on profile routes.** Same pattern. `/@user@host?max_id=…` on the profile statuses list. Tab changes use `?tab=` as a separate parameter, so a user can land on `/@alice@example.social?tab=replies&max_id=110123` and the SSR resolves both.

### 12.8 Auth-required placeholder

(Already specified in §8.8 — referenced here for the §12 cross-reference.)

The placeholder is emitted by routes that depend on the user's access token. It is a static HTML fragment, no JS required. When JS hydrates and `me.signal` resolves to a signed-in user, the page swaps the placeholder for the real component. With JS disabled, the placeholder is the final state.

### 12.9 Per-component / per-page summary

| Page or component | SSR mode in Plan 3 | Server-side fetch | Pagination model |
|---|---|---|---|
| `/local` | Full SSR via `pageData` | `fetchPublicTimeline({ kind: 'local' })` | `?max_id=` anchor + IO hijack |
| `/public` | Full SSR via `pageData` | `fetchPublicTimeline({ kind: 'public' })` | same |
| `/@user@host` (host-qualified) | Full SSR | `fetchAccountByHandle` + `fetchAccountStatuses` | `?max_id=` anchor + IO hijack |
| `/@user` (bare) | Full SSR if `caribou.instance` cookie set; placeholder otherwise | same | same |
| `/@user@host/[id]` | Full SSR | `fetchStatus` + `fetchThreadContext` | n/a (single status + bounded thread) |
| `/@user/[id]` | Full SSR if cookie set; placeholder otherwise | same | n/a |
| `/home` | Auth-required placeholder | n/a | n/a (hydration loads timeline client-side) |
| `/@me` | Auth-required placeholder (handle resolved client-side) | n/a | n/a |
| `/@me/[id]` | Auth-required placeholder | n/a | n/a |
| `/privacy` | Static HTML | n/a | n/a |
| `/about` | Static HTML | n/a | n/a |
| `<caribou-app-shell>` | DSD shadow root with grid + nav-rail + right-rail children | n/a | n/a |
| `<caribou-nav-rail>` | DSD shadow root with anchors | n/a | n/a |
| `<caribou-right-rail>` | DSD shadow root with about/links/disabled-slots; signed-in line if cookie set | n/a | n/a |
| `<caribou-timeline>` | Light-DOM SSR with status-card children + Older posts anchor | n/a | inherited from page |
| `<caribou-status-card>` | DSD shadow root with sanitized content + absolute timestamp | n/a | n/a |
| `<caribou-profile>` | Light-DOM SSR with header + tabs + statuses + anchor | n/a | inherited from page |
| `<caribou-thread>` | Light-DOM SSR with ancestor + focused + descendant tree | n/a | n/a |

### 12.10 Server-lib modules summary

| Module | Purpose | Approx. size |
|---|---|---|
| `server/lib/instance-cookie.ts` | `getInstance` (with format check + registry membership), `setInstance`, `clearInstance` | ~30 lines |
| `server/lib/mastodon-public.ts` | `fetchPublicTimeline`, `fetchAccountByHandle`, `fetchAccountStatuses`, `fetchStatus`, `fetchThreadContext` — all unauth, all routed through `cachedFetch` | ~120 lines |
| `server/lib/upstream-cache.ts` | LRU + TTL constants + in-flight dedup `Map<url, Promise>`; exports `cachedFetch` and `TTL` | ~50 lines |
| `server/lib/sanitize.ts` | DOMPurify + jsdom glue; exports `sanitize(html)` reading shared `PURIFY_OPTS` | ~10 lines |
| `packages/caribou-mastodon-client/src/sanitize-opts.ts` | Shared `PURIFY_OPTS` constant | ~10 lines |

All five modules are added in Plan 3. New runtime dependencies on `apps/caribou-elena`: `lru-cache`, `jsdom`, `dompurify`. `dompurify` is already a client-side dep on the same app from PR #14, so the addition there is moving it from `dependencies` to a shared spot (it is also imported on the server). `jsdom` is a server-only dep and adds ~7 MB installed; acceptable for a Nitro server image.

### 12.11 Signin / signout wiring

**Signin (`server/lib/signin-callback.ts` + the route that calls it).** The existing `completeSignin` function returns a redirect Location with the token in the URL fragment. Plan 3's wiring change:

- The route handler that invokes `completeSignin` (catch-all SSR handler `server/routes/[...].ts` for the `/api/signin/callback` path, or its dedicated route file) now also calls `setInstance(event, server)` before returning the redirect. The `server` value is read from `stateData.server` after the state lookup — a value that has already been validated by completing the OAuth handshake against it.
- No change to `completeSignin` itself (it remains pure, easy to test, takes deps).

**Signout.** The existing `/api/signout` POST endpoint (Plan 2) gains one extra line: `clearInstance(event)`. Client-side, the existing localStorage purge is unchanged. Both flows happen in the same request: server clears the cookie; client clears localStorage; the page redirects to `/`.

**Failure modes:**

- User signs in successfully but cookie write fails (browser refused, third-party-cookie policy, etc.). Effect: `getInstance(event)` returns `undefined` for subsequent SSR requests; bare-handle profile views fall through to the auth-required placeholder. JS-driven pages still work normally because they read instance from `me.signal`, which lives in localStorage. **Action:** none; the placeholder copy explains the situation.
- Cookie present but the corresponding `apps:<host>:<origin>` entry has been evicted from storage (e.g., admin cleared the OAuth registry). Effect: `getInstance(event)` returns `undefined`; same behavior as above. The client-side path is also affected because the next signed-in API call will get a 401 from the upstream — at which point the existing client-side error handling kicks in (sign-out, redirect to landing). **Action:** none for Plan 3; storage retention is an operational concern, not a feature.
- Cookie is forged with a hostname that is not in the `apps:*` registry. Effect: `getInstance(event)` returns `undefined`; the SSR path treats the user as unauthenticated. **Action:** none; this is the SSRF-amplification mitigation working as designed.

---

## Appendix — Open questions

None. All decisions closed during brainstorming:

- Layout: three-pane (`<caribou-app-shell>` with nav rail + main + right rail).
- Right-rail v1 content: about card + privacy/about links + disabled slots for theme/zen/shortcuts.
- Thread layout: hybrid (Mastodon web v4 pattern).
- Architecture: Approach B (infrastructure-first — UI-headless package, status-card variants, UnoCSS stand-up).
- Dark-mode only in Plan 3; theme toggle + light-mode → Plan 5.
- Zen-mode spec amendment included in this plan.
- **Shell composition:** shadow-DOM-by-default for self-rendering components (shell, nav rail, right rail, status card, profile header/tabs, thread); light-DOM only for `<caribou-timeline>`. Validated via POC (§6.6) as Plan 3's first task, gating everything else.
- **v1 spec §7.3 amendment:** shadow-DOM-by-default with light-DOM exception for child-coordinating components — documented in §9.0.
- **Boost rendering** absorbed into Plan 3 (§8.6) so the read-only experience doesn't ship with blank reblog cards.
- **Keyed-list reconciliation** in `<caribou-timeline>` deferred to a focused post-Plan-3 PR (§11.1a) before Plan 4 starts.
- **No-JS / progressive enhancement: privacy approach.** Approach B — keep access tokens on the client, SSR only public unauthenticated read paths. Preserves the parent spec's privacy property; auth-required routes emit a sign-in placeholder server-side and hydrate to the full client-side experience.
- **Bare-handle profile resolution.** B1 — set a hostname-only `caribou.instance` cookie on signin so `/@user` can resolve which instance to query. Cookie validated against the OAuth `apps:*` registry on every read.
- **Pagination semantics under no-JS.** A — real `?max_id=` cursor links rendered as anchors. With JS, an `IntersectionObserver` sentinel hijacks the anchor for in-place append; without JS, the anchor is a full-page navigation. Anchor is the single source of truth.
- **Auth-required views without JS.** A — server emits sign-in placeholder card for `/home`, `/@me`, `/@me/[id]`. Hydration replaces the placeholder once JS resolves the active session.
- **HTML sanitization on the server.** C — DOMPurify + jsdom directly (≈10 lines of glue in `server/lib/sanitize.ts`). Same `PURIFY_OPTS` consumed on both client and server, hoisted to `packages/caribou-mastodon-client/src/sanitize-opts.ts`.
- **Upstream cache.** A — short-TTL in-memory LRU keyed by upstream URL. TTLs: public timelines 15s, statuses + thread context 60s, profiles 300s, profile statuses 60s. In-flight request dedup (`Map<url, Promise>`) included in Plan 3 scope to kill thundering-herd.
