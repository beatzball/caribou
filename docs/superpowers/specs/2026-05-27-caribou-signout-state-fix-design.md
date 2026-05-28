# Caribou signout state fix — design

**Date:** 2026-05-27
**Status:** draft (awaiting user review)
**Follow-up to:** [phase-4.3 composite `<litro-link>`](2026-05-25-caribou-composite-litro-link-spa-nav-design.md) (PR #23)
**Related memory:** `project_caribou_signout_clears_wrong_state`

## Problem

Caribou's signout flow is inverted relative to user expectation: it clears server-side state that should persist and leaves client-side state that should be cleared.

### Server side — clears too much

`apps/caribou-elena/server/routes/api/signout.post.ts` calls `clearInstance(event)`, which removes the `caribou.instance` cookie. Without the cookie, `resolveInstanceForRoute` can't determine which Mastodon to query → `/local` and `/public` fall back to `kind: 'auth-required'`.

This is wrong by design intent. The cookie stores a hostname only (non-sensitive, no access token); its purpose is "the user's chosen Mastodon for public-route browsing." It should persist across signin/signout the way a language preference would.

### Client side — clears too little

The signout `<form action="/api/signout" method="post">` POSTs synchronously and the server returns 204. The browser stays on the current page; no JS runs. localStorage's `caribou.activeUserKey` survives untouched.

`pages/home.ts:32-40`'s `maybeSwapToTimeline` checks localStorage on connect — if `activeUserKey` is set, it swaps the auth-required placeholder for `<caribou-timeline kind="home">`. Same pattern on `/@me`. So after signout, `/home` and `/@me` still render real content because the stale localStorage key still passes the check.

`packages/state/src/users.ts:50` already exports `removeActiveUser()`, which does the right thing (removes the user key, clears `caribou.prefs.${key}` and `caribou.drafts.${key}`). The signout flow just never calls it.

### Companion issue — global `litro-link { display: contents }`

`<litro-link>` is a composite wrapper around an inner `<a>`. With no styling it behaves as an inline block, which breaks parent flex/grid layouts that expect to target the `<a>` directly. Phase-4.3 added `litro-link { display: contents }` inside `caribou-nav-rail` and `caribou-right-rail` shadow CSS where layout context required it. Light-DOM consumers (`caribou-auth-required`, retry, blog pages) currently work only because their contexts are pure inline text flow. Any future flex/grid container around a `<litro-link>` in light DOM would silently get broken layout. A one-line global rule in the SSR head eliminates the footgun.

### Symptom matrix

| Route | Post-signout actual | Post-signout expected |
|---|---|---|
| `/local`, `/public` | auth-required (cookie cleared) | public timeline of chosen instance |
| `/home`, `/@me` | real content (localStorage stale) | auth-required (signed out) |

## Goals

1. Clicking signout leaves a consistent state: server-side instance preference persists; client-side user session is cleared.
2. Both signout buttons (nav-rail + right-rail) behave identically.
3. No-JS users still get a working server-side signout (progressive enhancement).
4. Future light-DOM `<litro-link>` consumers don't trigger layout regressions.

## Non-goals

- Multi-tab consistency (clicking signout in tab A does not clear localStorage in tab B). Same behavior as today; out of scope.
- Post-signout redirect. Server keeps returning 204; browser stays on the current route. Matches current UX.
- Any Litro or Elena upstream patches. Fully Caribou-side.

## Architecture

Three coordinated changes in one PR. All `apps/caribou-elena` only.

### A. Server: stop clearing the instance cookie

`apps/caribou-elena/server/routes/api/signout.post.ts` — remove the `clearInstance(event)` call. Handler becomes a 204 no-op (kept as the POST target so the form/intercept flow is unchanged on the wire).

```ts
import { defineEventHandler, setResponseStatus } from 'h3'

export default defineEventHandler((event) => {
  setResponseStatus(event, 204)
  return ''
})
```

Pre-condition for safe removal: verify `caribou.instance` is read only as a hostname, never as a credential. (Confirmed during exploration: `resolveInstanceForRoute` uses it as a hostname only.)

### B. Client: `<caribou-signout-form>` Elena element

New file `apps/caribou-elena/pages/components/caribou-signout-form.ts`. **Composite wrapper** (no render, no shadow) — same shape as the patched `<litro-link>` (`patches/@beatzball__litro@0.9.1.patch`). Wires a `submit` listener on the consumer's existing light-DOM `<form>` child, calling `removeActiveUser()` before the native POST proceeds.

```ts
import { Elena } from '@elenajs/core'
import { removeActiveUser } from '@beatzball/caribou-state'

export class CaribouSignoutForm extends Elena(HTMLElement) {
  static override tagName = 'caribou-signout-form'
  // No render, no shadow — composite wrapper. Consumer writes the <form>.

  private onSubmit = (_e: SubmitEvent) => {
    removeActiveUser()
    // Native form POST proceeds to /api/signout.
  }

  override connectedCallback() {
    super.connectedCallback?.()
    this.querySelector('form')?.addEventListener('submit', this.onSubmit)
  }

  override disconnectedCallback() {
    super.disconnectedCallback?.()
    this.querySelector('form')?.removeEventListener('submit', this.onSubmit)
  }
}
CaribouSignoutForm.define()
```

**Design choices:**

- **Composite (no render, no shadow)**: prior art is the patched `<litro-link>`. A render-less Elena element preserves light-DOM children; the host rail's shadow CSS (`.signout-btn { ... }`) keeps styling the slotted button. A shadow root with `<slot>` would create cross-tree form-submission issues (a button inside the host's light DOM doesn't implicitly submit a form inside the wrapper's shadow root).
- **Consumer owns the `<form>`**: trade-off — the form attributes (`action="/api/signout" method="post"`) duplicate across the two rails. Acceptable: two lines of duplication for behavior boundaries that match the existing `<litro-link>` pattern.
- **Eager top-level import of `removeActiveUser`**: keeps the submit handler synchronous, no `preventDefault` dance. `@beatzball/caribou-state` is in the initial bundle anyway (loaded by `home.ts`, `@me.ts`), so eager import here adds no measurable cost.

**Consumer changes:**

`caribou-nav-rail.ts` — replace lines 73-77:
```html
<caribou-signout-form>
  <form action="/api/signout" method="post" class="signout-form">
    <button type="submit" class="signout-btn">
      <span class="icon">${ICONS.logOut}</span><span class="label">Sign out</span>
    </button>
  </form>
</caribou-signout-form>
```

`caribou-right-rail.ts` — replace lines 45-47 (keep the `${inst ? ... : html``}` conditional):
```html
<caribou-signout-form>
  <form action="/api/signout" method="post" style="display:inline;">
    <button type="submit" class="signout-btn">Sign out</button>
  </form>
</caribou-signout-form>
```

Both rails import the new module (side-effect import is enough since `CaribouSignoutForm.define()` registers itself).

### C. Global `litro-link { display: contents }` rule

New file `apps/caribou-elena/server/lib/base-head.ts`:

```ts
// Base layer rules injected into every SSR'd page's <head>. Kept separate
// from tokens-head (design tokens) and uno-head (utility classes) — these
// are component-author safety defaults that prevent third-party custom
// elements from breaking parent layout.
const BASE_CSS = `litro-link { display: contents; }`

export const BASE_HEAD = `<style id="caribou-base">${BASE_CSS}</style>`
```

Inject `BASE_HEAD` into the SSR head at `apps/caribou-elena/server/routes/[...].ts:37`:

```ts
routeMeta: { head: TOKENS_HEAD + UNO_HEAD + BASE_HEAD },
```

The shadow-DOM duplicates (`caribou-nav-rail.ts:23`, `caribou-right-rail.ts:13`) stay — shadow roots don't see the global rule, so the duplicates are defense in depth, not dead code.

## Data flow

### Sign-out (JS available)

```
user clicks Sign out
  ↓
<form submit> fires inside <caribou-signout-form>
  ↓
onSubmit handler (sync)
  → removeActiveUser()
      → users.value delete key
      → activeUserKey.value = null
      → saveToStorage (signal effect): localStorage rewrite
  ↓
native form POST → /api/signout
  ↓
server: 204, no cookie touched
  ↓
browser stays on current page
  ↓
any subsequent navigation: home.ts/maybeSwapToTimeline reads
activeUserKey, sees null, leaves auth-required placeholder
```

### Sign-out (no-JS)

```
<form submit> → native POST → /api/signout → 204
no localStorage write (no JS); no localStorage read either, so
no inconsistency observable. caribou.instance cookie persists;
/local and /public continue to work.
```

## Edge cases

| Case | Behavior | Notes |
|---|---|---|
| Form submit before custom element upgrade | Listener never attached; native form POSTs; no localStorage clear. | Acceptable: localStorage is only read by JS that requires script to be loaded, so no observable inconsistency. |
| Double-click submit | Browser's native form-submission lockout debounces; `removeActiveUser` is idempotent. | No special handling needed. |
| POST fails (network / 5xx) | `removeActiveUser` already ran; local state signed-out; server unchanged. | Benign — cookie isn't a credential, no server session to clear. |
| User navigates away mid-submit | localStorage write committed synchronously before POST left the page. | Same as today's form-only flow. |

## Testing

### Server unit

`apps/caribou-elena/tests/unit/signout.post.test.ts` (new) — invoke the handler with a mock H3 event; assert `setResponseStatus(event, 204)` is called and no `setCookie` / `clearInstance` is called. Catches regressions where someone re-adds the cookie clear.

### Component unit

`apps/caribou-elena/pages/components/__tests__/caribou-signout-form.test.ts` (new) — jsdom + vitest, same pattern as `caribou-profile.test.ts`.

- Seed `users` state with one active user.
- Render `<caribou-signout-form><form action="/api/signout" method="post"><button type="submit">x</button></form></caribou-signout-form>`.
- Stub `HTMLFormElement.prototype.submit` (jsdom doesn't navigate).
- Dispatch `submit` event on the inner form.
- Assert `activeUserKey.value === null` and `localStorage.getItem('caribou.activeUserKey') === 'null'` (the string `'null'` — `saveToStorage` JSON-stringifies the null signal value).

### E2E

`apps/caribou-elena/tests/e2e/signout.spec.ts` (new). Sign-in setup reuses or adapts from `signin-done.spec.ts`; if no reusable fixture exists, seed state directly with `page.addInitScript` to set the cookie + localStorage entry before first navigation. The plan step will inspect `signin-done.spec.ts` and pick the path.

Assertions after clicking signout from `/home`:
- `caribou.instance` cookie still present (`page.context().cookies()`).
- `caribou.activeUserKey` localStorage entry is the string `'null'` (cleared but stored — `page.evaluate(() => localStorage.getItem('caribou.activeUserKey'))`).
- `/local` renders the public timeline (or its loading state) — not auth-required.
- `/home` renders auth-required.

### Companion rule

No explicit test — the e2e exercises real pages whose layout depends on the rule. Adding a string-literal assertion on `BASE_CSS` would test the test, not the behavior.

## Out of scope (future)

- Multi-tab signout coordination via `storage` events.
- Post-signout redirect to `/`. (If we want this later, add it on the client after `removeActiveUser` returns — server stays 204.)
- Surfacing the instance preference in a UI affordance ("Change instance" link). Out of scope; the cookie just persists silently for now.

## Open questions

None. All architectural choices resolved in brainstorm.
