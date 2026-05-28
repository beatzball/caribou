# Caribou Signout State Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Caribou's inverted signout flow — server stops clearing the non-sensitive `caribou.instance` cookie, client clears the stale `caribou.activeUserKey` localStorage entry via a new `<caribou-signout-form>` composite wrapper, and a global `litro-link { display: contents }` rule lands in the SSR head so light-DOM consumers don't trigger layout regressions.

**Architecture:** Three coordinated Caribou-only changes (no Litro patch, no Elena patch). The composite wrapper follows the patched `<litro-link>` shape (`Elena(HTMLElement)`, no render, no shadow) — it just attaches a `submit` listener to its existing light-DOM `<form>` child that calls `removeActiveUser()` before the native POST proceeds. Progressive enhancement: no-JS users still get a working server-side signout, the cookie just stays put.

**Tech Stack:** Elena (composite custom-element pattern from `<litro-link>`), `@beatzball/caribou-state` (`removeActiveUser`), h3 (server route), vitest + happy-dom (component + server unit), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-05-27-caribou-signout-state-fix-design.md`

---

## Task 1: Server — stop clearing the `caribou.instance` cookie

**Files:**
- Create: `apps/caribou-elena/tests/unit/signout-post.test.ts`
- Modify: `apps/caribou-elena/server/routes/api/signout.post.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/caribou-elena/tests/unit/signout-post.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as H3 from 'h3'

const setCookieMock = vi.fn()
const setResponseStatusMock = vi.fn()

vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof H3>('h3')
  return {
    ...actual,
    setCookie: setCookieMock,
    setResponseStatus: setResponseStatusMock,
    defineEventHandler: <T,>(fn: T) => fn,
  }
})

describe('POST /api/signout', () => {
  beforeEach(() => {
    setCookieMock.mockClear()
    setResponseStatusMock.mockClear()
  })

  it('returns 204 and does NOT clear the caribou.instance cookie', async () => {
    const { default: handler } = await import('../../server/routes/api/signout.post.js')
    const event = {} as Parameters<typeof handler>[0]
    await handler(event)
    expect(setResponseStatusMock).toHaveBeenCalledWith(event, 204)
    expect(setCookieMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter caribou-elena vitest run tests/unit/signout-post.test.ts`
Expected: FAIL — current handler calls `clearInstance(event)` which calls `setCookie`, so `setCookieMock` is called and the `not.toHaveBeenCalled()` assertion fails.

- [ ] **Step 3: Modify the handler**

Replace `apps/caribou-elena/server/routes/api/signout.post.ts` entirely:

```ts
import { defineEventHandler, setResponseStatus } from 'h3'

export default defineEventHandler((event) => {
  setResponseStatus(event, 204)
  return ''
})
```

(The `clearInstance` import is removed; the handler is a 204 no-op that keeps the POST target stable on the wire.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter caribou-elena vitest run tests/unit/signout-post.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/server/routes/api/signout.post.ts apps/caribou-elena/tests/unit/signout-post.test.ts
git commit -m "fix(caribou-elena): stop clearing caribou.instance cookie on signout

The cookie stores a non-sensitive hostname preference. Clearing it on
signout dropped /local and /public into auth-required mode even though
the instance preference should persist across sessions. Handler is now
a 204 no-op; client-side localStorage clear lands in a follow-up commit."
```

---

## Task 2: `<caribou-signout-form>` composite wrapper component

**Files:**
- Create: `apps/caribou-elena/pages/components/caribou-signout-form.ts`
- Create: `apps/caribou-elena/pages/components/__tests__/caribou-signout-form.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/caribou-elena/pages/components/__tests__/caribou-signout-form.test.ts`. The `sampleSession()` helper mirrors `packages/state/src/__tests__/users.test.ts:12-21` so the `UserSession` shape is fully populated (TypeScript requires `account` and `createdAt`).

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { toUserKey } from '@beatzball/caribou-auth'
import {
  users, activeUserKey, addUserSession, type UserSession,
} from '@beatzball/caribou-state'

const key = toUserKey('beatzball', 'fosstodon.org')

function sampleSession(): UserSession {
  return {
    userKey: key,
    server: 'fosstodon.org',
    token: 'TOKEN-1',
    vapidKey: 'VAPID',
    account: { id: 'a1', username: 'beatzball', acct: 'beatzball' } as UserSession['account'],
    createdAt: 1_700_000_000_000,
  }
}

beforeAll(async () => {
  await import('../caribou-signout-form.js')
})

beforeEach(() => {
  document.body.innerHTML = ''
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
  // happy-dom's HTMLFormElement.submit throws "Not implemented". Stub it.
  HTMLFormElement.prototype.submit = function () { /* no-op */ }
})

describe('<caribou-signout-form>', () => {
  it('does not render its own DOM (composite wrapper — preserves light-DOM children)', async () => {
    document.body.innerHTML = `
      <caribou-signout-form>
        <form action="/api/signout" method="post"><button type="submit">x</button></form>
      </caribou-signout-form>
    `
    await Promise.resolve()
    const wrapper = document.querySelector('caribou-signout-form')!
    expect(wrapper.shadowRoot).toBeNull()
    expect(wrapper.querySelector('form[action="/api/signout"]')).toBeTruthy()
  })

  it('clears activeUserKey + localStorage on form submit', async () => {
    addUserSession(sampleSession())
    expect(activeUserKey.value).toBe(key)
    expect(localStorage.getItem('caribou.activeUserKey')).toBe(JSON.stringify(key))

    document.body.innerHTML = `
      <caribou-signout-form>
        <form action="/api/signout" method="post"><button type="submit">x</button></form>
      </caribou-signout-form>
    `
    await Promise.resolve()
    const form = document.querySelector<HTMLFormElement>('form[action="/api/signout"]')!
    // requestSubmit() fires the submit event AND triggers form submission
    // (which the prototype stub above no-ops). The submit event listener
    // runs synchronously so removeActiveUser() lands before we assert.
    form.requestSubmit()

    expect(activeUserKey.value).toBeNull()
    expect(localStorage.getItem('caribou.activeUserKey')).toBe('null')
  })

  it('does not preventDefault — the native form POST proceeds', async () => {
    addUserSession(sampleSession())
    document.body.innerHTML = `
      <caribou-signout-form>
        <form action="/api/signout" method="post"><button type="submit">x</button></form>
      </caribou-signout-form>
    `
    await Promise.resolve()
    const form = document.querySelector<HTMLFormElement>('form[action="/api/signout"]')!
    const submitEvent = new SubmitEvent('submit', { bubbles: true, cancelable: true })
    form.dispatchEvent(submitEvent)
    expect(submitEvent.defaultPrevented).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter caribou-elena vitest run pages/components/__tests__/caribou-signout-form.test.ts`
Expected: FAIL — module `../caribou-signout-form.js` does not exist.

- [ ] **Step 3: Implement the component**

Create `apps/caribou-elena/pages/components/caribou-signout-form.ts`:

```ts
import { Elena } from '@elenajs/core'
import { removeActiveUser } from '@beatzball/caribou-state'

/**
 * Composite signout wrapper. Same shape as the patched <litro-link>:
 * no render, no shadow — consumer provides the <form>, this element only
 * adds a synchronous submit listener that calls removeActiveUser() before
 * the native form POST proceeds. Progressive enhancement: no-JS users
 * still get a working server-side signout.
 */
export class CaribouSignoutForm extends Elena(HTMLElement) {
  static override tagName = 'caribou-signout-form'

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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter caribou-elena vitest run pages/components/__tests__/caribou-signout-form.test.ts`
Expected: PASS (all 3 specs).

If the second spec fails with `activeUserKey.value` still set: the `connectedCallback` may have run before the inner `<form>` was parsed as a descendant. happy-dom usually parses synchronously from `innerHTML`, but if observed, switch to `document.createElement` + `appendChild` in test setup.

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/pages/components/caribou-signout-form.ts apps/caribou-elena/pages/components/__tests__/caribou-signout-form.test.ts
git commit -m "feat(caribou-elena): <caribou-signout-form> composite wrapper

Adds a composite custom element (no render, no shadow — same shape as the
patched <litro-link>) that wraps a consumer-provided signout <form>. Its
connectedCallback attaches a synchronous submit listener that calls
removeActiveUser() before the native form POST proceeds. Nav-rail and
right-rail wire-up land in following commits."
```

---

## Task 3: Wire nav-rail to use `<caribou-signout-form>`

**Files:**
- Modify: `apps/caribou-elena/pages/components/caribou-nav-rail.ts`

- [ ] **Step 1: Verify the existing nav-rail test still passes (baseline)**

Run: `pnpm --filter caribou-elena vitest run pages/components/__tests__/caribou-nav-rail.test.ts`
Expected: PASS — the existing "renders sign-out as a POST form to /api/signout" test asserts `el.shadowRoot!.querySelector('form[action="/api/signout"]')` exists. Today's pre-change code passes this.

- [ ] **Step 2: Modify nav-rail to use the wrapper**

Edit `apps/caribou-elena/pages/components/caribou-nav-rail.ts`:

First, add the side-effect import at the top (after the existing imports):
```ts
import './caribou-signout-form.js'
```

Then replace lines 73-77 (the `<form class="signout-form" action="/api/signout" method="post">` block) with:
```ts
        <caribou-signout-form>
          <form action="/api/signout" method="post" class="signout-form">
            <button type="submit" class="signout-btn">
              <span class="icon">${ICONS.logOut}</span><span class="label">Sign out</span>
            </button>
          </form>
        </caribou-signout-form>
```

The `class="signout-form"` stays on the `<form>` so existing shadow CSS (`.signout-form { display: contents }` at line 24) keeps applying.

- [ ] **Step 3: Re-run the existing nav-rail test**

Run: `pnpm --filter caribou-elena vitest run pages/components/__tests__/caribou-nav-rail.test.ts`
Expected: PASS — the form still lives inside the shadow root (just nested inside `<caribou-signout-form>`); `querySelector('form[action="/api/signout"]')` still finds it.

If it fails because the assertion was actually `el.shadowRoot!.querySelector('form[action="/api/signout"]')` and the form is now nested deeper, the test should still pass — `querySelector` traverses all descendants in the same tree. If somehow it doesn't (e.g., happy-dom quirk with unknown custom element nesting), update the assertion to:
```ts
expect(el.shadowRoot!.querySelector('caribou-signout-form form[action="/api/signout"]')).toBeTruthy()
```

- [ ] **Step 4: Type-check**

Run: `pnpm --filter caribou-elena typecheck`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/pages/components/caribou-nav-rail.ts
git commit -m "fix(caribou-elena): nav-rail signout wraps form in <caribou-signout-form>

Form submit now clears localStorage activeUserKey via the wrapper's
synchronous listener before the native POST fires. No visible change to
markup or CSS — the .signout-form / .signout-btn classes stay on the
inner elements."
```

---

## Task 4: Wire right-rail to use `<caribou-signout-form>`

**Files:**
- Modify: `apps/caribou-elena/pages/components/caribou-right-rail.ts`

- [ ] **Step 1: Verify the existing right-rail test still passes (baseline)**

Run: `pnpm --filter caribou-elena vitest run pages/components/__tests__/caribou-right-rail.test.ts`
Expected: PASS — the "renders signed-in indicator when instance prop is set" test asserts the form exists when `instance` is set.

- [ ] **Step 2: Modify right-rail to use the wrapper**

Edit `apps/caribou-elena/pages/components/caribou-right-rail.ts`:

Add side-effect import after the existing imports (after the `build-meta.generated.js` import):
```ts
import './caribou-signout-form.js'
```

Replace lines 45-47 (the inline `<form action="/api/signout"` block inside the `${inst ? html`...` : html``}` conditional) with:
```ts
        ${inst
          ? html`<div class="signed-in">Signed in to <strong>${inst}</strong> ·
                   <caribou-signout-form>
                     <form action="/api/signout" method="post" style="display:inline;">
                       <button type="submit" class="signout-btn">Sign out</button>
                     </form>
                   </caribou-signout-form>
                 </div>`
          : html``}
```

(Keep the `${inst ? ... : html``}` conditional — only render the signout affordance when an instance is set.)

- [ ] **Step 3: Re-run the existing right-rail test**

Run: `pnpm --filter caribou-elena vitest run pages/components/__tests__/caribou-right-rail.test.ts`
Expected: PASS. If it fails for the same nesting-depth reason as Task 3 Step 3, update its `querySelector('form[action="/api/signout"]')` to scope under `caribou-signout-form`.

- [ ] **Step 4: Type-check**

Run: `pnpm --filter caribou-elena typecheck`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/pages/components/caribou-right-rail.ts
git commit -m "fix(caribou-elena): right-rail signout wraps form in <caribou-signout-form>

Mirrors the nav-rail wiring from the previous commit. The signed-in
indicator's inline signout form now clears localStorage via the wrapper
before POSTing."
```

---

## Task 5: Global `litro-link { display: contents }` via `base-head.ts`

**Files:**
- Create: `apps/caribou-elena/server/lib/base-head.ts`
- Modify: `apps/caribou-elena/server/routes/[...].ts`

- [ ] **Step 1: Create `base-head.ts`**

Create `apps/caribou-elena/server/lib/base-head.ts`:

```ts
// Base layer rules injected into every SSR'd page's <head>. Kept separate
// from tokens-head (design tokens) and uno-head (utility classes) — these
// are component-author safety defaults that prevent third-party custom
// elements from breaking parent layout.
const BASE_CSS = `litro-link { display: contents; }`

export const BASE_HEAD = `<style id="caribou-base">${BASE_CSS}</style>`
```

- [ ] **Step 2: Wire `BASE_HEAD` into the SSR head**

Edit `apps/caribou-elena/server/routes/[...].ts`. After the existing `UNO_HEAD` import (around line 5), add:
```ts
import { BASE_HEAD } from '../lib/base-head.js'
```

At line 37 (`routeMeta: { head: TOKENS_HEAD + UNO_HEAD },`), change to:
```ts
    routeMeta: { head: TOKENS_HEAD + UNO_HEAD + BASE_HEAD },
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter caribou-elena typecheck`
Expected: no new errors.

- [ ] **Step 4: Build + curl smoke test**

Run:
```bash
pnpm --filter caribou-elena build
node apps/caribou-elena/dist/server/server/index.mjs &
SERVER_PID=$!
sleep 3
curl -s http://localhost:3000/ | grep -o '<style id="caribou-base">[^<]*</style>'
kill $SERVER_PID
```
Expected output: `<style id="caribou-base">litro-link { display: contents; }</style>`

If `curl` returns empty: confirm the route assembly modifies the head correctly; re-check the import path in `routes/[...].ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/server/lib/base-head.ts apps/caribou-elena/server/routes/[...].ts
git commit -m "feat(caribou-elena): inject global litro-link { display: contents } rule

Adds a third SSR <style> block (alongside tokens-head and uno-head) that
makes <litro-link> layout-invisible in light-DOM consumers (auth-required,
retry banners, blog pages). The shadow-DOM duplicates in nav-rail and
right-rail stay — shadow roots don't see the global rule, so the
duplicates are defense in depth, not dead code."
```

---

## Task 6: Playwright e2e for the full signout flow

**Files:**
- Create: `apps/caribou-elena/tests/e2e/signout.spec.ts`

- [ ] **Step 1: Write the e2e**

Create `apps/caribou-elena/tests/e2e/signout.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

// Seed a signed-in user the same way signin-done.spec.ts demonstrates:
// localStorage entries that home.ts's maybeSwapToTimeline relies on.
// Cookie is set via addCookies — exercises the persists-across-signout
// guarantee directly.
async function signIn(page: import('@playwright/test').Page, context: import('@playwright/test').BrowserContext) {
  await context.addCookies([{
    name: 'caribou.instance', value: 'fosstodon.org',
    domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax',
  }])
  await page.addInitScript(() => {
    localStorage.setItem('caribou.activeUserKey', '"beatzball@fosstodon.org"')
    localStorage.setItem('caribou.users', JSON.stringify([
      ['beatzball@fosstodon.org', { token: 'TOK', server: 'fosstodon.org', vapidKey: 'VK' }],
    ]))
  })
}

test('signout clears localStorage but preserves the instance cookie', async ({ page, context }) => {
  await signIn(page, context)

  // Visit /home to confirm signed-in state is recognised.
  await page.goto('/home')
  const beforeActive = await page.evaluate(() => localStorage.getItem('caribou.activeUserKey'))
  expect(beforeActive).toBe('"beatzball@fosstodon.org"')

  // Click the nav-rail signout button.
  const signOut = page.locator('caribou-nav-rail').locator('button.signout-btn')
  await signOut.waitFor({ state: 'visible' })
  await signOut.click()

  // Wait for the form POST to complete (server returns 204; navigation
  // does not occur but the request fires). Give it a tick.
  await page.waitForTimeout(250)

  // Cookie should still be there.
  const cookies = await context.cookies()
  expect(cookies.find((c) => c.name === 'caribou.instance')?.value).toBe('fosstodon.org')

  // localStorage activeUserKey should be the string 'null' (saveToStorage
  // JSON.stringifies the null signal value).
  const afterActive = await page.evaluate(() => localStorage.getItem('caribou.activeUserKey'))
  expect(afterActive).toBe('null')

  // /local should NOT show auth-required (instance cookie persists).
  await page.goto('/local')
  await expect(page.locator('caribou-auth-required')).toHaveCount(0)

  // /home SHOULD show auth-required (localStorage cleared).
  await page.goto('/home')
  await expect(page.locator('caribou-auth-required')).toHaveCount(1)
})
```

- [ ] **Step 2: Run the e2e**

Run: `pnpm --filter caribou-elena exec playwright test tests/e2e/signout.spec.ts`
Expected: PASS. Playwright's `webServer` config will build + start the server automatically (per `playwright.config.ts`).

If the test times out waiting for `caribou-nav-rail`: confirm `/home` does render the nav-rail with a signed-in user. If `await page.waitForTimeout(250)` is flaky, switch to `await page.waitForResponse((r) => r.url().endsWith('/api/signout') && r.status() === 204)`.

If `/local` still shows auth-required: confirm Task 1's server fix is in (the cookie should now persist), and double-check `addCookies` set the cookie with the right domain (`localhost` for the default `baseURL: http://localhost:3000`).

- [ ] **Step 3: Commit**

```bash
git add apps/caribou-elena/tests/e2e/signout.spec.ts
git commit -m "test(caribou-elena): e2e for signout state inversion fix

Asserts the symptom matrix from the spec end-to-end: post-signout,
caribou.instance cookie persists (so /local stays signed-out-but-browseable),
localStorage activeUserKey is cleared (so /home falls back to auth-required)."
```

---

## Task 7: Changeset

**Files:**
- Create: `.changeset/caribou-signout-state-fix.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/caribou-signout-state-fix.md`:

```markdown
---
"caribou-elena": patch
---

Fix inverted signout state: previously, clicking sign out cleared the non-sensitive `caribou.instance` cookie (server-side) while leaving the stale `caribou.activeUserKey` in localStorage (client-side). Effect: `/local` and `/public` dropped into auth-required mode (no instance) while `/home` and `/@me` still rendered real content (stale active user). Now inverted: instance cookie persists across signin/signout (it's a hostname preference, not a credential), and a new `<caribou-signout-form>` composite wrapper clears `activeUserKey` before the native form POST.

The wrapper follows the same shape as the patched `<litro-link>` — `Elena(HTMLElement)` with no render and no shadow, just a `submit` listener on the consumer's existing `<form>` child. Both `<caribou-nav-rail>` and `<caribou-right-rail>` now wrap their signout forms with it. No-JS users are unaffected — the native form POST still hits `/api/signout` (now a 204 no-op).

Also adds a global `litro-link { display: contents; }` rule in a new `BASE_HEAD` injection alongside `TOKENS_HEAD` and `UNO_HEAD`, so light-DOM `<litro-link>` consumers (auth-required, retry banners, blog) don't trigger layout regressions when wrapped in flex/grid containers. The shadow-DOM duplicates in the rails stay (shadow roots don't see global rules — defense in depth, not dead code).
```

- [ ] **Step 2: Commit**

```bash
git add .changeset/caribou-signout-state-fix.md
git commit -m "chore(caribou-elena): changeset for signout state fix"
```

---

## Task 8: Manual verification (dev server)

**Files:** none (verification only)

- [ ] **Step 1: Run the dev server**

Run: `pnpm --filter caribou-elena dev`
Expected: server starts on the configured dev port.

- [ ] **Step 2: Sign in via the UI**

In a browser: visit `/`, pick an instance, complete the Mastodon OAuth flow. Land on `/home` with a populated timeline.

- [ ] **Step 3: Confirm pre-signout state**

Open DevTools → Application → Local Storage: `caribou.activeUserKey` should be `"<username>@<instance>"`.
Open DevTools → Application → Cookies: `caribou.instance` should be `<instance>`.

- [ ] **Step 4: Click sign out (nav-rail)**

Click the Sign out button at the bottom of the left nav rail. Page stays on `/home` (server returns 204).

- [ ] **Step 5: Verify post-signout state**

Check storage:
- `caribou.activeUserKey` should be `null` (the string).
- `caribou.instance` cookie should STILL be set to the chosen instance.

Visit `/home`: should show the auth-required placeholder ("Sign in to continue / /home shows your personal timeline.").
Visit `/local`: should NOT show auth-required — should render the public timeline (or its loading state) for the persisted instance.

- [ ] **Step 6: Confirm right-rail signout works the same**

Sign in again. Click the "Sign out" link in the right rail's signed-in indicator. Repeat Step 5 assertions.

- [ ] **Step 7: Stop the dev server**

Ctrl-C the dev process.

(No commit — verification only.)

---

## Self-review checklist (do this before pushing)

- [ ] All 8 tasks complete; each commit is independently sensible.
- [ ] `pnpm --filter caribou-elena vitest run` — all unit tests pass.
- [ ] `pnpm --filter caribou-elena exec playwright test tests/e2e/signout.spec.ts` — e2e passes.
- [ ] `pnpm --filter caribou-elena typecheck` — no new errors.
- [ ] `pnpm --filter caribou-elena build` — clean build.
- [ ] Memory `project_caribou_signout_clears_wrong_state` is no longer "open" — update or delete after merge.
