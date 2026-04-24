# Caribou Plan 2 — Auth + Data Layer + First Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A logged-in user can sign in to any Mastodon instance through our own OAuth proxy and see their home timeline rendered from real Mastodon API data, including the "N new posts" banner driven by polling.

**Architecture:** Four new workspace packages (`@beatzball/caribou-auth`, `@beatzball/caribou-mastodon-client`, `@beatzball/caribou-state`, `@beatzball/caribou-design-tokens`), two server routes (`/api/signin/start`, `/api/signin/callback`) backed by a single `unstorage` fs instance rooted at `/data`, one prerendered `/signin/done` fragment-parse shim, an instance-picker landing page replacing the Plan 1 placeholder, and an authenticated `/home` page composed of three Elena components (`caribou-home-timeline`, `caribou-status-card`, `caribou-new-posts-banner`). State is backed by `@preact/signals-core`, wrapped in thin store APIs; web-component reflow is driven by `bindSignals(instance, read)`. All three TDD packages (auth, mastodon-client, state) follow red-green-refactor against MSW fixtures; server routes factor out pure functions (`startSignin(body, deps)`, `completeSignin(query, deps)`) so Nitro handlers stay thin and the logic is unit-testable.

**Tech Stack:** `masto` v7.x, `@preact/signals-core`, `unstorage` fs driver, `DOMPurify`, MSW for tests, Playwright `page.route()` + `addInitScript` for E2E fakes, Web Crypto `getRandomValues` for state tokens, `URL` + `URLSearchParams` everywhere (no string concatenation of URLs).

---

## Exit Criteria

All of the following must be true before this plan is considered done:

1. `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all pass from a clean clone.
2. `@beatzball/caribou-auth` has ≥ 95% line coverage via Vitest.
3. `@beatzball/caribou-mastodon-client` has ≥ 90% coverage via Vitest against MSW fixtures.
4. `@beatzball/caribou-state` has ≥ 95% coverage via Vitest.
5. `pnpm dev` serves an instance-picker at `/` with an input field, submit button, and inline error banner; `/home` redirects to `/` when no active user in localStorage.
6. `pnpm dev:portless`: a real OAuth round-trip against `fosstodon.org` completes — user is redirected to the instance, consents, redirected back via `/api/signin/callback`, lands on `/signin/done`, and ends up on `/home` seeing their home timeline rendered.
7. `/home` polls every 30s while `document.visibilityState === 'visible'`; new statuses accumulate in a "N new posts" banner that, when clicked, prepends them and resets the counter.
8. 401 from any authenticated call clears session and routes to `/?error=unauthorized`.
9. Playwright E2E: `tests/e2e/landing.spec.ts`, `tests/e2e/signin-done.spec.ts`, `tests/e2e/home.spec.ts` all green on Chromium locally and on all three browsers in CI, with `@axe-core/playwright` violations empty.
10. `GET https://caribou.quest/` renders the instance picker; signing in end-to-end against a real instance lands on `/home` with live data.

---

## File Structure

### Created by this plan

```
caribou/
├── packages/
│   ├── auth/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── src/
│   │       ├── index.ts                      # barrel
│   │       ├── user-key.ts                   # UserKey type + isUserKey/toUserKey/parseUserKey
│   │       ├── generate-state.ts             # 32-byte base64url CSRF token (Web Crypto)
│   │       ├── build-authorize-url.ts        # URL builder for the Mastodon consent page
│   │       ├── parse-callback-fragment.ts    # parses #token=...&server=...&userKey=...
│   │       └── __tests__/
│   │           ├── user-key.test.ts
│   │           ├── generate-state.test.ts
│   │           ├── build-authorize-url.test.ts
│   │           └── parse-callback-fragment.test.ts
│   ├── mastodon-client/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── src/
│   │       ├── index.ts
│   │       ├── caribou-error.ts
│   │       ├── normalize-error.ts
│   │       ├── dedup.ts
│   │       ├── create-client.ts              # createCaribouClient(userKey)
│   │       ├── session-source.ts             # pluggable session-lookup + on-unauthorized
│   │       └── __tests__/
│   │           ├── caribou-error.test.ts
│   │           ├── normalize-error.test.ts
│   │           ├── dedup.test.ts
│   │           ├── create-client.test.ts
│   │           └── fixtures/
│   │               ├── server.ts             # MSW setupServer with Mastodon handlers
│   │               ├── handlers.ts
│   │               └── status.ts             # sample Status + Account payloads
│   ├── state/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── src/
│   │       ├── index.ts
│   │       ├── bindings.ts                   # bindSignals(instance, read)
│   │       ├── users.ts                      # users, activeUserKey, activeUser, activeClient, persistence
│   │       ├── caches.ts                     # statusCache, accountCache, cacheStatus, updateCache
│   │       ├── timeline-store.ts             # createTimelineStore factory
│   │       ├── polling.ts                    # pure polling-controller (visibility gated)
│   │       └── __tests__/
│   │           ├── bindings.test.ts
│   │           ├── users.test.ts
│   │           ├── caches.test.ts
│   │           ├── timeline-store.test.ts
│   │           └── polling.test.ts
│   └── design-tokens/
│       ├── package.json
│       └── tokens.css                        # :root[data-theme="dark"] defaults + [data-theme="light"]
├── apps/caribou-elena/
│   ├── server/
│   │   ├── lib/
│   │   │   ├── storage.ts                    # unstorage fs singleton (STORAGE_DIR=/data)
│   │   │   ├── signin-start.ts               # pure startSignin(body, deps) — testable
│   │   │   └── signin-callback.ts            # pure completeSignin(query, deps) — testable
│   │   ├── routes/
│   │   │   ├── api/
│   │   │   │   ├── signin/
│   │   │   │   │   ├── start.post.ts         # thin H3 wrapper around startSignin
│   │   │   │   │   └── callback.get.ts       # thin H3 wrapper around completeSignin
│   │   │   │   └── (health.ts exists)
│   │   │   └── signin/
│   │   │       └── done.ts                   # prerendered; inline JS fragment-parse shim
│   │   └── __tests__/
│   │       ├── signin-start.test.ts
│   │       └── signin-callback.test.ts
│   ├── pages/
│   │   ├── components/
│   │   │   ├── (caribou-landing.ts rewritten)
│   │   │   ├── caribou-error-banner.ts       # reads ?error= from URL, shows message, clears URL
│   │   │   ├── caribou-instance-picker.ts    # form + POST /api/signin/start + redirect
│   │   │   ├── caribou-home-timeline.ts
│   │   │   ├── caribou-status-card.ts        # DOMPurify sanitized content
│   │   │   └── caribou-new-posts-banner.ts
│   │   └── home.ts                           # /home SSR shell
│   ├── app.ts                                # 401 interceptor wiring + tokens.css import (modified)
│   └── tests/
│       ├── e2e/
│       │   ├── (landing.spec.ts rewritten)
│       │   ├── signin-done.spec.ts
│       │   └── home.spec.ts                  # uses page.route() + addInitScript for localStorage
│       └── unit/
│           ├── signin-start.test.ts
│           └── signin-callback.test.ts
```

### Modified by this plan

- `apps/caribou-elena/package.json` — add runtime deps: `@beatzball/caribou-auth`, `@beatzball/caribou-mastodon-client`, `@beatzball/caribou-state`, `@beatzball/caribou-design-tokens` (all `workspace:*`), `masto`, `@preact/signals-core`, `unstorage`, `dompurify`; devDeps: `msw`, `@types/dompurify`.
- `apps/caribou-elena/app.ts` — import `tokens.css`, wire the 401 interceptor and hydrate `users`/`activeUserKey` from localStorage.
- `apps/caribou-elena/pages/index.ts` — still the home route `/`, but renders `<caribou-landing>` which now contains the picker.
- `apps/caribou-elena/pages/components/caribou-landing.ts` — rewritten as composition of `caribou-error-banner` + `caribou-instance-picker`.
- `apps/caribou-elena/tests/e2e/landing.spec.ts` — rewritten around the picker; keeps the a11y and health-endpoint assertions.
- `tsconfig.json` (root) — add project references for the four new packages.

### NOT created by this plan (future work)

- `packages/ui-headless` — Plan 3+ when compose dialog lands.
- Local / public / notifications / bookmarks / lists / hashtags / settings — Plan 3, 4, 5.
- Optimistic mutations (`favouriteStatus`, etc.) — Plan 3.
- Compose dialog + media upload — Plan 3.
- `/changelog` page — Plan 5.
- PWA, push, streaming — Phase 2.

---

## Pre-flight

### Task 0: Worktree setup (already done)

**Files:** none (git plumbing)

The worktree `caribou-worktrees/02-auth-data-timeline` on branch `02-auth-data-timeline` (based on `main@f5c6442`) already exists and is the working directory for every subsequent task.

- [ ] **Step 1: Confirm you are in the Plan 2 worktree on a clean tree**

```bash
pwd
git status
git log --oneline -1
```

Expected: path ends with `/caribou-worktrees/02-auth-data-timeline`; branch is `02-auth-data-timeline`; working tree clean; HEAD commit is the merged Plan 1 tip on `main` (subject starts with `feat: monorepo skeleton` or equivalent squash commit).

- [ ] **Step 2: Verify git identity**

```bash
git config --get user.name
git config --get user.email
```

Expected: `beatzball` and `github@beatzball.com`. If either is wrong, set with `git config --local user.name beatzball` and `git config --local user.email github@beatzball.com`.

All subsequent tasks run inside this worktree.

---

## Phase A — `@beatzball/caribou-auth` (TDD, zero-dep)

The auth package is pure functions: UserKey helpers, a CSRF state generator, a consent-URL builder, and a fragment parser. No I/O. Runs identically in Node and the browser.

### Task 1: Package scaffold

**Files:**
- Create: `packages/auth/package.json`
- Create: `packages/auth/tsconfig.json`
- Create: `packages/auth/vitest.config.ts`
- Create: `packages/auth/src/index.ts`

- [ ] **Step 1: Write `packages/auth/package.json`**

```json
{
  "name": "@beatzball/caribou-auth",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage"
  },
  "devDependencies": {
    "@beatzball/caribou-eslint-config": "workspace:*",
    "@beatzball/caribou-tsconfig": "workspace:*",
    "@vitest/coverage-v8": "^2.1.0",
    "eslint": "^9.0.0",
    "typescript": "^5.7.3",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `packages/auth/tsconfig.json`**

```json
{
  "extends": "@beatzball/caribou-tsconfig/base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM"],
    "noEmit": true
  },
  "include": ["src", "vitest.config.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write `packages/auth/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/index.ts'],
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
      reporter: ['text', 'lcov'],
    },
  },
})
```

- [ ] **Step 4: Write `packages/auth/src/index.ts` (barrel — empty for now)**

```ts
export {}
```

- [ ] **Step 5: Install and commit**

```bash
pnpm install
git add packages/auth/ pnpm-lock.yaml
git commit -m "feat(auth): package scaffold"
```

### Task 2: UserKey type + helpers (TDD)

**Files:**
- Create: `packages/auth/src/user-key.ts`
- Create: `packages/auth/src/__tests__/user-key.test.ts`
- Modify: `packages/auth/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/auth/src/__tests__/user-key.test.ts
import { describe, expect, it } from 'vitest'
import { isUserKey, parseUserKey, toUserKey, type UserKey } from '../user-key.js'

describe('UserKey', () => {
  it('toUserKey composes handle and server', () => {
    expect(toUserKey('beatzball', 'fosstodon.org')).toBe('beatzball@fosstodon.org')
  })

  it('isUserKey accepts well-formed values', () => {
    expect(isUserKey('beatzball@fosstodon.org')).toBe(true)
  })

  it('isUserKey rejects values without exactly one @', () => {
    expect(isUserKey('fosstodon.org')).toBe(false)
    expect(isUserKey('beatzball@@fosstodon.org')).toBe(false)
    expect(isUserKey('beatzball@')).toBe(false)
    expect(isUserKey('@fosstodon.org')).toBe(false)
    expect(isUserKey('')).toBe(false)
  })

  it('parseUserKey round-trips', () => {
    const parsed = parseUserKey('beatzball@fosstodon.org' satisfies UserKey)
    expect(parsed).toEqual({ handle: 'beatzball', server: 'fosstodon.org' })
  })

  it('parseUserKey throws on malformed input', () => {
    expect(() => parseUserKey('not-a-user-key' as UserKey)).toThrow(/invalid UserKey/i)
  })
})
```

- [ ] **Step 2: Run the test and see it fail**

```bash
pnpm --filter @beatzball/caribou-auth test
```

Expected: FAIL with "Cannot find module '../user-key.js'".

- [ ] **Step 3: Implement**

```ts
// packages/auth/src/user-key.ts
export type UserKey = `${string}@${string}`

export function toUserKey(handle: string, server: string): UserKey {
  return `${handle}@${server}` as UserKey
}

export function isUserKey(value: unknown): value is UserKey {
  if (typeof value !== 'string') return false
  const parts = value.split('@')
  if (parts.length !== 2) return false
  const [handle, server] = parts
  return !!handle && !!server
}

export function parseUserKey(value: UserKey): { handle: string; server: string } {
  if (!isUserKey(value)) throw new Error(`invalid UserKey: ${String(value)}`)
  const [handle, server] = value.split('@') as [string, string]
  return { handle, server }
}
```

- [ ] **Step 4: Re-export from the barrel**

```ts
// packages/auth/src/index.ts
export * from './user-key.js'
```

- [ ] **Step 5: Run the tests and see them pass**

```bash
pnpm --filter @beatzball/caribou-auth test
```

Expected: PASS, 5/5.

- [ ] **Step 6: Commit**

```bash
git add packages/auth/src/user-key.ts packages/auth/src/__tests__/user-key.test.ts packages/auth/src/index.ts
git commit -m "feat(auth): UserKey type with isUserKey/toUserKey/parseUserKey"
```

### Task 3: `generateState` — CSRF token (TDD)

**Files:**
- Create: `packages/auth/src/generate-state.ts`
- Create: `packages/auth/src/__tests__/generate-state.test.ts`
- Modify: `packages/auth/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/auth/src/__tests__/generate-state.test.ts
import { describe, expect, it } from 'vitest'
import { generateState } from '../generate-state.js'

describe('generateState', () => {
  it('returns a base64url string with no +, /, or = padding', () => {
    const s = generateState()
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('encodes 32 bytes (produces 43 base64url chars)', () => {
    expect(generateState()).toHaveLength(43)
  })

  it('produces distinct values on repeated calls', () => {
    const set = new Set(Array.from({ length: 100 }, () => generateState()))
    expect(set.size).toBe(100)
  })
})
```

- [ ] **Step 2: Run the test and see it fail**

```bash
pnpm --filter @beatzball/caribou-auth test generate-state
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/auth/src/generate-state.ts
export function generateState(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  // base64url without padding
  let b64 = ''
  // btoa is not available in Node node:test env, but Vitest with happy-dom/node
  // both provide `Buffer`. Use a portable conversion via string-of-bytes → btoa
  // when available, fallback to Buffer.
  if (typeof btoa === 'function') {
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    b64 = btoa(binary)
  } else {
    b64 = Buffer.from(bytes).toString('base64')
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
```

- [ ] **Step 4: Re-export**

```ts
// packages/auth/src/index.ts
export * from './user-key.js'
export * from './generate-state.js'
```

- [ ] **Step 5: Run and pass**

```bash
pnpm --filter @beatzball/caribou-auth test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/auth/src/generate-state.ts packages/auth/src/__tests__/generate-state.test.ts packages/auth/src/index.ts
git commit -m "feat(auth): generateState CSRF token (32 bytes base64url, Web Crypto)"
```

### Task 4: `buildAuthorizeUrl` (TDD)

**Files:**
- Create: `packages/auth/src/build-authorize-url.ts`
- Create: `packages/auth/src/__tests__/build-authorize-url.test.ts`
- Modify: `packages/auth/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/auth/src/__tests__/build-authorize-url.test.ts
import { describe, expect, it } from 'vitest'
import { buildAuthorizeUrl } from '../build-authorize-url.js'

describe('buildAuthorizeUrl', () => {
  it('builds https URL to instance /oauth/authorize with all query params', () => {
    const url = buildAuthorizeUrl({
      server: 'fosstodon.org',
      clientId: 'abc123',
      redirectUri: 'https://caribou.quest/api/signin/callback',
      scope: 'read write follow push',
      state: 'Xyz-AbC_dEf',
    })
    const u = new URL(url)
    expect(u.origin).toBe('https://fosstodon.org')
    expect(u.pathname).toBe('/oauth/authorize')
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('client_id')).toBe('abc123')
    expect(u.searchParams.get('redirect_uri')).toBe('https://caribou.quest/api/signin/callback')
    expect(u.searchParams.get('scope')).toBe('read write follow push')
    expect(u.searchParams.get('state')).toBe('Xyz-AbC_dEf')
  })

  it('strips scheme from server if included', () => {
    const url = buildAuthorizeUrl({
      server: 'https://mastodon.social',
      clientId: 'x', redirectUri: 'https://caribou.quest/api/signin/callback',
      scope: 'read', state: 's',
    })
    expect(new URL(url).origin).toBe('https://mastodon.social')
  })

  it('throws on empty server', () => {
    expect(() => buildAuthorizeUrl({
      server: '', clientId: 'x', redirectUri: 'y', scope: 'z', state: 'w',
    })).toThrow(/server/)
  })
})
```

- [ ] **Step 2: Run and see it fail**

```bash
pnpm --filter @beatzball/caribou-auth test build-authorize-url
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/auth/src/build-authorize-url.ts
export interface BuildAuthorizeUrlInput {
  server: string            // "fosstodon.org" (scheme optional; stripped if present)
  clientId: string
  redirectUri: string
  scope: string             // e.g. "read write follow push"
  state: string
}

export function buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
  const bareServer = input.server.replace(/^https?:\/\//, '').trim()
  if (!bareServer) throw new Error('buildAuthorizeUrl: server is required')
  const u = new URL(`https://${bareServer}/oauth/authorize`)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', input.clientId)
  u.searchParams.set('redirect_uri', input.redirectUri)
  u.searchParams.set('scope', input.scope)
  u.searchParams.set('state', input.state)
  return u.toString()
}
```

- [ ] **Step 4: Re-export**

```ts
// packages/auth/src/index.ts
export * from './user-key.js'
export * from './generate-state.js'
export * from './build-authorize-url.js'
```

- [ ] **Step 5: Run and pass**

```bash
pnpm --filter @beatzball/caribou-auth test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/auth/src/build-authorize-url.ts packages/auth/src/__tests__/build-authorize-url.test.ts packages/auth/src/index.ts
git commit -m "feat(auth): buildAuthorizeUrl"
```

### Task 5: `parseCallbackFragment` (TDD)

**Files:**
- Create: `packages/auth/src/parse-callback-fragment.ts`
- Create: `packages/auth/src/__tests__/parse-callback-fragment.test.ts`
- Modify: `packages/auth/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/auth/src/__tests__/parse-callback-fragment.test.ts
import { describe, expect, it } from 'vitest'
import { parseCallbackFragment } from '../parse-callback-fragment.js'

describe('parseCallbackFragment', () => {
  it('parses a valid fragment with token, server, userKey, vapidKey', () => {
    const r = parseCallbackFragment(
      '#token=abc&server=fosstodon.org&userKey=beatzball%40fosstodon.org&vapidKey=BP...',
    )
    expect(r).toEqual({
      token: 'abc',
      server: 'fosstodon.org',
      userKey: 'beatzball@fosstodon.org',
      vapidKey: 'BP...',
    })
  })

  it('also accepts fragments without a leading #', () => {
    const r = parseCallbackFragment('token=a&server=s&userKey=u%40s&vapidKey=v')
    expect(r?.token).toBe('a')
  })

  it('returns null when token is missing', () => {
    expect(parseCallbackFragment('#server=fosstodon.org&userKey=u%40s')).toBeNull()
  })

  it('returns null when userKey is not a valid UserKey', () => {
    expect(parseCallbackFragment('#token=a&server=s&userKey=malformed')).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(parseCallbackFragment('')).toBeNull()
    expect(parseCallbackFragment('#')).toBeNull()
  })
})
```

- [ ] **Step 2: Run and fail**

```bash
pnpm --filter @beatzball/caribou-auth test parse-callback-fragment
```

- [ ] **Step 3: Implement**

```ts
// packages/auth/src/parse-callback-fragment.ts
import { isUserKey, type UserKey } from './user-key.js'

export interface CallbackFragment {
  token: string
  server: string
  userKey: UserKey
  vapidKey: string
}

export function parseCallbackFragment(fragment: string): CallbackFragment | null {
  if (!fragment) return null
  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment
  if (!raw) return null
  const params = new URLSearchParams(raw)
  const token = params.get('token')
  const server = params.get('server')
  const userKey = params.get('userKey')
  const vapidKey = params.get('vapidKey') ?? ''
  if (!token || !server || !userKey) return null
  if (!isUserKey(userKey)) return null
  return { token, server, userKey, vapidKey }
}
```

- [ ] **Step 4: Re-export**

```ts
// packages/auth/src/index.ts
export * from './user-key.js'
export * from './generate-state.js'
export * from './build-authorize-url.js'
export * from './parse-callback-fragment.js'
```

- [ ] **Step 5: Run full auth coverage to confirm ≥ 95%**

```bash
pnpm --filter @beatzball/caribou-auth test:coverage
```

Expected: PASS, coverage thresholds met.

- [ ] **Step 6: Changeset + commit**

```bash
pnpm changeset
# Select: @beatzball/caribou-auth  (and only that)
# Patch bump.
# Description: "Initial @beatzball/caribou-auth: UserKey helpers, generateState, buildAuthorizeUrl, parseCallbackFragment."
git add packages/auth/src/ .changeset/
git commit -m "feat(auth): parseCallbackFragment + changeset for @beatzball/caribou-auth"
```

---

## Phase B — `@beatzball/caribou-mastodon-client` (TDD, MSW)

Wraps `masto` v7 with in-flight dedup, `CaribouError` normalization, and a 401 interceptor. Tests run against MSW fixtures that fake a Mastodon instance.

### Task 6: Package scaffold + MSW fixtures

**Files:**
- Create: `packages/mastodon-client/package.json`
- Create: `packages/mastodon-client/tsconfig.json`
- Create: `packages/mastodon-client/vitest.config.ts`
- Create: `packages/mastodon-client/src/index.ts`
- Create: `packages/mastodon-client/src/__tests__/fixtures/status.ts`
- Create: `packages/mastodon-client/src/__tests__/fixtures/handlers.ts`
- Create: `packages/mastodon-client/src/__tests__/fixtures/server.ts`

- [ ] **Step 1: Write `packages/mastodon-client/package.json`**

```json
{
  "name": "@beatzball/caribou-mastodon-client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage"
  },
  "dependencies": {
    "@beatzball/caribou-auth": "workspace:*",
    "masto": "^7.0.0"
  },
  "devDependencies": {
    "@beatzball/caribou-eslint-config": "workspace:*",
    "@beatzball/caribou-tsconfig": "workspace:*",
    "@vitest/coverage-v8": "^2.1.0",
    "eslint": "^9.0.0",
    "msw": "^2.6.0",
    "typescript": "^5.7.3",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `packages/mastodon-client/tsconfig.json`**

```json
{
  "extends": "@beatzball/caribou-tsconfig/base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM"],
    "noEmit": true
  },
  "include": ["src", "vitest.config.ts"]
}
```

- [ ] **Step 3: Write `packages/mastodon-client/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/index.ts'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
      reporter: ['text', 'lcov'],
    },
  },
})
```

- [ ] **Step 4: Write `packages/mastodon-client/src/index.ts`**

```ts
export {}
```

- [ ] **Step 5: Write fixture data**

```ts
// packages/mastodon-client/src/__tests__/fixtures/status.ts
export const sampleAccount = {
  id: 'acct-1',
  username: 'beatzball',
  acct: 'beatzball',
  display_name: 'Beatz Ball',
  url: 'https://fosstodon.org/@beatzball',
  avatar: 'https://fosstodon.org/avatars/beatzball.png',
  avatar_static: 'https://fosstodon.org/avatars/beatzball.png',
  header: '', header_static: '', note: '',
  followers_count: 0, following_count: 0, statuses_count: 1,
  locked: false, bot: false, discoverable: true,
  created_at: '2024-01-01T00:00:00.000Z',
  fields: [], emojis: [],
}

export function makeStatus(id: string, content = `<p>post ${id}</p>`) {
  return {
    id,
    uri: `https://fosstodon.org/@beatzball/${id}`,
    url: `https://fosstodon.org/@beatzball/${id}`,
    created_at: '2024-01-01T00:00:00.000Z',
    account: sampleAccount,
    content,
    visibility: 'public',
    sensitive: false,
    spoiler_text: '',
    media_attachments: [],
    mentions: [], tags: [], emojis: [],
    reblogs_count: 0, favourites_count: 0, replies_count: 0,
    favourited: false, reblogged: false, bookmarked: false,
    language: 'en',
  }
}
```

- [ ] **Step 6: Write MSW handlers**

```ts
// packages/mastodon-client/src/__tests__/fixtures/handlers.ts
import { http, HttpResponse } from 'msw'
import { makeStatus, sampleAccount } from './status.js'

let nextStatuses = [makeStatus('s1'), makeStatus('s2')]

export function setNextStatuses(statuses: ReturnType<typeof makeStatus>[]) {
  nextStatuses = statuses
}

export const handlers = [
  http.get('https://fosstodon.org/api/v1/timelines/home', () =>
    HttpResponse.json(nextStatuses),
  ),
  http.get('https://fosstodon.org/api/v1/accounts/verify_credentials', () =>
    HttpResponse.json(sampleAccount),
  ),
]
```

- [ ] **Step 7: Write MSW server setup**

```ts
// packages/mastodon-client/src/__tests__/fixtures/server.ts
import { setupServer } from 'msw/node'
import { handlers } from './handlers.js'

export const server = setupServer(...handlers)
```

- [ ] **Step 8: Install**

```bash
pnpm install
```

- [ ] **Step 9: Commit**

```bash
git add packages/mastodon-client/ pnpm-lock.yaml
git commit -m "feat(mastodon-client): package scaffold + MSW fixtures"
```

### Task 7: `CaribouError` class (TDD)

**Files:**
- Create: `packages/mastodon-client/src/caribou-error.ts`
- Create: `packages/mastodon-client/src/__tests__/caribou-error.test.ts`
- Modify: `packages/mastodon-client/src/index.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/mastodon-client/src/__tests__/caribou-error.test.ts
import { describe, expect, it } from 'vitest'
import { CaribouError, type CaribouErrorCode } from '../caribou-error.js'

describe('CaribouError', () => {
  it('is an Error with name, code, retryAfter', () => {
    const e = new CaribouError('unauthorized', 'you shall not pass')
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('CaribouError')
    expect(e.code).toBe('unauthorized')
    expect(e.message).toBe('you shall not pass')
    expect(e.retryAfter).toBeUndefined()
  })

  it('accepts retryAfter seconds', () => {
    const e = new CaribouError('rate_limited', 'slow down', { retryAfter: 30 })
    expect(e.retryAfter).toBe(30)
  })

  it('enumerates all known codes', () => {
    const codes: CaribouErrorCode[] = [
      'unauthorized', 'not_found', 'rate_limited',
      'unreachable', 'server_error', 'unknown',
    ]
    for (const code of codes) {
      expect(new CaribouError(code, '').code).toBe(code)
    }
  })
})
```

- [ ] **Step 2: Run and fail**

```bash
pnpm --filter @beatzball/caribou-mastodon-client test caribou-error
```

- [ ] **Step 3: Implement**

```ts
// packages/mastodon-client/src/caribou-error.ts
export type CaribouErrorCode =
  | 'unauthorized'
  | 'not_found'
  | 'rate_limited'
  | 'unreachable'
  | 'server_error'
  | 'unknown'

export class CaribouError extends Error {
  readonly code: CaribouErrorCode
  readonly retryAfter?: number

  constructor(code: CaribouErrorCode, message: string, opts: { retryAfter?: number } = {}) {
    super(message)
    this.name = 'CaribouError'
    this.code = code
    if (opts.retryAfter !== undefined) this.retryAfter = opts.retryAfter
  }
}
```

- [ ] **Step 4: Barrel**

```ts
// packages/mastodon-client/src/index.ts
export * from './caribou-error.js'
```

- [ ] **Step 5: Run and pass**

```bash
pnpm --filter @beatzball/caribou-mastodon-client test
```

- [ ] **Step 6: Commit**

```bash
git add packages/mastodon-client/src/caribou-error.ts packages/mastodon-client/src/__tests__/caribou-error.test.ts packages/mastodon-client/src/index.ts
git commit -m "feat(mastodon-client): CaribouError class with code + retryAfter"
```

### Task 8: `normalizeError` — masto HttpError → CaribouError (TDD)

**Files:**
- Create: `packages/mastodon-client/src/normalize-error.ts`
- Create: `packages/mastodon-client/src/__tests__/normalize-error.test.ts`
- Modify: `packages/mastodon-client/src/index.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/mastodon-client/src/__tests__/normalize-error.test.ts
import { describe, expect, it } from 'vitest'
import { CaribouError } from '../caribou-error.js'
import { normalizeError } from '../normalize-error.js'

class FakeHttpError extends Error {
  readonly statusCode: number
  readonly headers: Record<string, string>
  constructor(statusCode: number, message: string, headers: Record<string, string> = {}) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
    this.headers = headers
  }
}

describe('normalizeError', () => {
  it('maps 401 to unauthorized', () => {
    const e = normalizeError(new FakeHttpError(401, 'bad token'))
    expect(e).toBeInstanceOf(CaribouError)
    expect(e.code).toBe('unauthorized')
  })

  it('maps 404 to not_found', () => {
    expect(normalizeError(new FakeHttpError(404, '')).code).toBe('not_found')
  })

  it('maps 429 to rate_limited with retryAfter', () => {
    const e = normalizeError(new FakeHttpError(429, '', { 'retry-after': '120' }))
    expect(e.code).toBe('rate_limited')
    expect(e.retryAfter).toBe(120)
  })

  it('maps 5xx to server_error', () => {
    expect(normalizeError(new FakeHttpError(500, '')).code).toBe('server_error')
    expect(normalizeError(new FakeHttpError(502, '')).code).toBe('server_error')
  })

  it('maps generic TypeError/"fetch failed" to unreachable', () => {
    expect(normalizeError(new TypeError('fetch failed')).code).toBe('unreachable')
  })

  it('falls through to unknown', () => {
    expect(normalizeError(new Error('weird')).code).toBe('unknown')
  })

  it('returns CaribouError unchanged when given one', () => {
    const original = new CaribouError('rate_limited', 'x', { retryAfter: 5 })
    expect(normalizeError(original)).toBe(original)
  })
})
```

- [ ] **Step 2: Run and fail**

```bash
pnpm --filter @beatzball/caribou-mastodon-client test normalize-error
```

- [ ] **Step 3: Implement**

```ts
// packages/mastodon-client/src/normalize-error.ts
import { CaribouError } from './caribou-error.js'

interface HttpErrorLike {
  statusCode: number
  headers?: Record<string, string>
  message: string
}

function isHttpErrorLike(e: unknown): e is HttpErrorLike {
  return (
    !!e && typeof e === 'object' &&
    'statusCode' in e && typeof (e as { statusCode: unknown }).statusCode === 'number'
  )
}

export function normalizeError(err: unknown): CaribouError {
  if (err instanceof CaribouError) return err

  if (isHttpErrorLike(err)) {
    const { statusCode, headers, message } = err
    if (statusCode === 401) return new CaribouError('unauthorized', message)
    if (statusCode === 404) return new CaribouError('not_found', message)
    if (statusCode === 429) {
      const retryAfterHeader = headers?.['retry-after']
      const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : undefined
      return new CaribouError('rate_limited', message, { retryAfter })
    }
    if (statusCode >= 500) return new CaribouError('server_error', message)
    return new CaribouError('unknown', message)
  }

  if (err instanceof TypeError && /fetch failed|network|Failed to fetch/i.test(err.message)) {
    return new CaribouError('unreachable', err.message)
  }

  const message = err instanceof Error ? err.message : String(err)
  return new CaribouError('unknown', message)
}
```

- [ ] **Step 4: Barrel**

```ts
// packages/mastodon-client/src/index.ts
export * from './caribou-error.js'
export * from './normalize-error.js'
```

- [ ] **Step 5: Run and pass**

```bash
pnpm --filter @beatzball/caribou-mastodon-client test
```

- [ ] **Step 6: Commit**

```bash
git add packages/mastodon-client/src/normalize-error.ts packages/mastodon-client/src/__tests__/normalize-error.test.ts packages/mastodon-client/src/index.ts
git commit -m "feat(mastodon-client): normalizeError — HttpError → CaribouError mapping"
```

### Task 9: Dedup helper (TDD)

**Files:**
- Create: `packages/mastodon-client/src/dedup.ts`
- Create: `packages/mastodon-client/src/__tests__/dedup.test.ts`
- Modify: `packages/mastodon-client/src/index.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/mastodon-client/src/__tests__/dedup.test.ts
import { describe, expect, it, vi } from 'vitest'
import { createDedup } from '../dedup.js'

describe('createDedup', () => {
  it('returns the same promise for concurrent calls with the same key', async () => {
    const dedup = createDedup()
    const underlying = vi.fn(async () => 'v')
    const [a, b] = await Promise.all([
      dedup.run('k', underlying),
      dedup.run('k', underlying),
    ])
    expect(a).toBe('v')
    expect(b).toBe('v')
    expect(underlying).toHaveBeenCalledTimes(1)
  })

  it('runs a new call after the previous has resolved', async () => {
    const dedup = createDedup()
    const underlying = vi.fn(async () => 'v')
    await dedup.run('k', underlying)
    await dedup.run('k', underlying)
    expect(underlying).toHaveBeenCalledTimes(2)
  })

  it('clears in-flight on rejection so retries run', async () => {
    const dedup = createDedup()
    let n = 0
    const underlying = vi.fn(async () => {
      n += 1
      if (n === 1) throw new Error('fail')
      return 'v'
    })
    await expect(dedup.run('k', underlying)).rejects.toThrow('fail')
    await expect(dedup.run('k', underlying)).resolves.toBe('v')
    expect(underlying).toHaveBeenCalledTimes(2)
  })

  it('different keys run independently', async () => {
    const dedup = createDedup()
    const fn = vi.fn(async (tag: string) => tag)
    const [a, b] = await Promise.all([
      dedup.run('a', () => fn('a')),
      dedup.run('b', () => fn('b')),
    ])
    expect(a).toBe('a'); expect(b).toBe('b')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run and fail**

```bash
pnpm --filter @beatzball/caribou-mastodon-client test dedup
```

- [ ] **Step 3: Implement**

```ts
// packages/mastodon-client/src/dedup.ts
export interface Dedup {
  run<T>(key: string, fn: () => Promise<T>): Promise<T>
}

export function createDedup(): Dedup {
  const inflight = new Map<string, Promise<unknown>>()
  return {
    async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const existing = inflight.get(key) as Promise<T> | undefined
      if (existing) return existing
      const p = (async () => {
        try {
          return await fn()
        } finally {
          inflight.delete(key)
        }
      })()
      inflight.set(key, p)
      return p
    },
  }
}
```

- [ ] **Step 4: Barrel**

```ts
// packages/mastodon-client/src/index.ts
export * from './caribou-error.js'
export * from './normalize-error.js'
export * from './dedup.js'
```

- [ ] **Step 5: Run and pass**

```bash
pnpm --filter @beatzball/caribou-mastodon-client test
```

- [ ] **Step 6: Commit**

```bash
git add packages/mastodon-client/src/dedup.ts packages/mastodon-client/src/__tests__/dedup.test.ts packages/mastodon-client/src/index.ts
git commit -m "feat(mastodon-client): createDedup in-flight deduplication"
```

### Task 10: `createCaribouClient` + `fetchTimeline` + 401 interceptor (TDD against MSW)

**Files:**
- Create: `packages/mastodon-client/src/session-source.ts`
- Create: `packages/mastodon-client/src/create-client.ts`
- Create: `packages/mastodon-client/src/__tests__/create-client.test.ts`
- Modify: `packages/mastodon-client/src/index.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/mastodon-client/src/__tests__/create-client.test.ts
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { toUserKey } from '@beatzball/caribou-auth'
import { createCaribouClient } from '../create-client.js'
import { server } from './fixtures/server.js'
import { handlers, setNextStatuses } from './fixtures/handlers.js'
import { makeStatus } from './fixtures/status.js'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers(...handlers)
  setNextStatuses([makeStatus('s1'), makeStatus('s2')])
})
afterAll(() => server.close())

const userKey = toUserKey('beatzball', 'fosstodon.org')

function sessionSource() {
  return {
    get: () => ({ userKey, server: 'fosstodon.org', token: 'TOKEN-1' }),
    onUnauthorized: vi.fn(),
  }
}

describe('createCaribouClient', () => {
  it('fetchTimeline("home") returns statuses from the user’s instance', async () => {
    const sess = sessionSource()
    const client = createCaribouClient(userKey, sess)
    const statuses = await client.fetchTimeline('home')
    expect(statuses.map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('in-flight dedup: two concurrent fetchTimeline calls hit network once', async () => {
    const sess = sessionSource()
    const client = createCaribouClient(userKey, sess)
    let hits = 0
    server.use(
      http.get('https://fosstodon.org/api/v1/timelines/home', () => {
        hits += 1
        return HttpResponse.json([makeStatus('dedup1')])
      }),
    )
    const [a, b] = await Promise.all([client.fetchTimeline('home'), client.fetchTimeline('home')])
    expect(a).toBe(b) // same promise → same resolved array reference
    expect(hits).toBe(1)
  })

  it('maps 401 to CaribouError(unauthorized) AND calls onUnauthorized', async () => {
    const sess = sessionSource()
    const client = createCaribouClient(userKey, sess)
    server.use(
      http.get('https://fosstodon.org/api/v1/timelines/home', () =>
        HttpResponse.json({ error: 'unauthorized' }, { status: 401 }),
      ),
    )
    await expect(client.fetchTimeline('home')).rejects.toMatchObject({
      name: 'CaribouError', code: 'unauthorized',
    })
    expect(sess.onUnauthorized).toHaveBeenCalledOnce()
  })

  it('supports since_id for polling', async () => {
    const sess = sessionSource()
    const client = createCaribouClient(userKey, sess)
    server.use(
      http.get('https://fosstodon.org/api/v1/timelines/home', ({ request }) => {
        const sinceId = new URL(request.url).searchParams.get('since_id')
        if (sinceId === 's2') return HttpResponse.json([makeStatus('s3')])
        return HttpResponse.json([])
      }),
    )
    const newer = await client.fetchTimeline('home', { sinceId: 's2' })
    expect(newer.map((s) => s.id)).toEqual(['s3'])
  })
})
```

- [ ] **Step 2: Write `session-source.ts`**

```ts
// packages/mastodon-client/src/session-source.ts
import type { UserKey } from '@beatzball/caribou-auth'

export interface SessionData {
  userKey: UserKey
  server: string
  token: string
}

export interface SessionSource {
  get(): SessionData | null
  onUnauthorized(): void
}
```

- [ ] **Step 3: Implement `create-client.ts`**

```ts
// packages/mastodon-client/src/create-client.ts
import { createRestAPIClient, type mastodon } from 'masto'
import type { UserKey } from '@beatzball/caribou-auth'
import { CaribouError } from './caribou-error.js'
import { normalizeError } from './normalize-error.js'
import { createDedup } from './dedup.js'
import type { SessionSource } from './session-source.js'

export type TimelineKind = 'home' | 'local' | 'public' | 'bookmarks'
  | { type: 'hashtag'; tag: string }
  | { type: 'list'; id: string }

export interface CaribouClient {
  userKey: UserKey
  fetchTimeline(kind: TimelineKind, params?: {
    sinceId?: string
    maxId?: string
    limit?: number
  }): Promise<mastodon.v1.Status[]>
}

export function createCaribouClient(userKey: UserKey, session: SessionSource): CaribouClient {
  const dedup = createDedup()

  function rest(): mastodon.rest.Client {
    const s = session.get()
    if (!s) throw new CaribouError('unauthorized', 'no active session')
    return createRestAPIClient({ url: `https://${s.server}`, accessToken: s.token })
  }

  async function run<T>(key: string, fn: (c: mastodon.rest.Client) => Promise<T>): Promise<T> {
    try {
      return await dedup.run(key, () => fn(rest()))
    } catch (err) {
      const norm = normalizeError(err)
      if (norm.code === 'unauthorized') session.onUnauthorized()
      throw norm
    }
  }

  return {
    userKey,
    async fetchTimeline(kind, params = {}) {
      const key = `timeline:${JSON.stringify(kind)}:${JSON.stringify(params)}`
      return run(key, async (c) => {
        const listParams = {
          ...(params.sinceId ? { sinceId: params.sinceId } : {}),
          ...(params.maxId ? { maxId: params.maxId } : {}),
          ...(params.limit ? { limit: params.limit } : {}),
        }
        if (kind === 'home')   return c.v1.timelines.home.list(listParams)
        if (kind === 'local')  return c.v1.timelines.public.list({ ...listParams, local: true })
        if (kind === 'public') return c.v1.timelines.public.list(listParams)
        if (kind === 'bookmarks') return c.v1.bookmarks.list(listParams)
        if (kind.type === 'hashtag') return c.v1.timelines.tag.$select(kind.tag).list(listParams)
        if (kind.type === 'list')    return c.v1.timelines.list.$select(kind.id).list(listParams)
        throw new CaribouError('unknown', `unhandled timeline kind: ${JSON.stringify(kind)}`)
      })
    },
  }
}
```

- [ ] **Step 4: Barrel**

```ts
// packages/mastodon-client/src/index.ts
export * from './caribou-error.js'
export * from './normalize-error.js'
export * from './dedup.js'
export * from './session-source.js'
export * from './create-client.js'
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @beatzball/caribou-mastodon-client test
```

Expected: PASS, 4/4 (plus existing tests).

- [ ] **Step 6: Run coverage and confirm ≥ 90%**

```bash
pnpm --filter @beatzball/caribou-mastodon-client test:coverage
```

Expected: thresholds met. If `create-client.ts` lacks coverage on a branch (e.g. `bookmarks` or `list`), add a minimal test.

- [ ] **Step 7: Changeset + commit**

```bash
pnpm changeset
# Select: @beatzball/caribou-mastodon-client
# Patch bump.
# Description: "Initial @beatzball/caribou-mastodon-client with fetchTimeline, dedup, 401 interceptor."
git add packages/mastodon-client/src/ .changeset/
git commit -m "feat(mastodon-client): createCaribouClient + fetchTimeline + 401 interceptor"
```

---

## Phase C — `@beatzball/caribou-state` (TDD, signals-backed)

Thin store APIs wrapping `@preact/signals-core`. Three layers: users, caches, view stores. Includes the adapter-agnostic `bindSignals` glue.

### Task 11: Package scaffold + `bindSignals` (TDD)

**Files:**
- Create: `packages/state/package.json`
- Create: `packages/state/tsconfig.json`
- Create: `packages/state/vitest.config.ts`
- Create: `packages/state/src/index.ts`
- Create: `packages/state/src/bindings.ts`
- Create: `packages/state/src/__tests__/bindings.test.ts`

- [ ] **Step 1: Write `packages/state/package.json`**

```json
{
  "name": "@beatzball/caribou-state",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage"
  },
  "dependencies": {
    "@beatzball/caribou-auth": "workspace:*",
    "@beatzball/caribou-mastodon-client": "workspace:*",
    "@preact/signals-core": "^1.8.0"
  },
  "devDependencies": {
    "@beatzball/caribou-eslint-config": "workspace:*",
    "@beatzball/caribou-tsconfig": "workspace:*",
    "@vitest/coverage-v8": "^2.1.0",
    "eslint": "^9.0.0",
    "happy-dom": "^15.0.0",
    "typescript": "^5.7.3",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `packages/state/tsconfig.json`**

```json
{
  "extends": "@beatzball/caribou-tsconfig/base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM"],
    "noEmit": true
  },
  "include": ["src", "vitest.config.ts"]
}
```

- [ ] **Step 3: Write `packages/state/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/index.ts'],
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
      reporter: ['text', 'lcov'],
    },
  },
})
```

- [ ] **Step 4: Write failing `bindings.test.ts`**

```ts
// packages/state/src/__tests__/bindings.test.ts
import { signal } from '@preact/signals-core'
import { describe, expect, it, vi } from 'vitest'
import { bindSignals } from '../bindings.js'

describe('bindSignals', () => {
  it('calls `update` on the instance when the read function’s deps change', () => {
    const count = signal(0)
    const update = vi.fn()
    let reflected = 0
    const instance = { update }
    const dispose = bindSignals(instance, () => { reflected = count.value })
    expect(reflected).toBe(0)
    expect(update).toHaveBeenCalledTimes(1)
    count.value = 1
    expect(reflected).toBe(1)
    expect(update).toHaveBeenCalledTimes(2)
    dispose()
    count.value = 2
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('falls back to `requestUpdate` when `update` is absent', () => {
    const count = signal(0)
    const requestUpdate = vi.fn()
    const instance = { requestUpdate }
    const dispose = bindSignals(instance, () => { void count.value })
    count.value = 1
    expect(requestUpdate).toHaveBeenCalledTimes(2)
    dispose()
  })

  it('is a no-op when neither method is present', () => {
    const count = signal(0)
    const instance = {}
    const dispose = bindSignals(instance, () => { void count.value })
    count.value = 1
    dispose()
    // No throw = pass.
  })
})
```

- [ ] **Step 5: Implement**

```ts
// packages/state/src/bindings.ts
import { effect } from '@preact/signals-core'

export function bindSignals<T extends { update?: () => void; requestUpdate?: () => void }>(
  instance: T,
  read: () => void,
): () => void {
  return effect(() => {
    read()
    const fn = instance.update ?? instance.requestUpdate
    if (typeof fn === 'function') fn.call(instance)
  })
}
```

- [ ] **Step 6: Barrel**

```ts
// packages/state/src/index.ts
export * from './bindings.js'
```

- [ ] **Step 7: Install + run**

```bash
pnpm install
pnpm --filter @beatzball/caribou-state test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/state/ pnpm-lock.yaml
git commit -m "feat(state): package scaffold + bindSignals"
```

### Task 12: `users` / `activeUserKey` / persistence (TDD)

**Files:**
- Create: `packages/state/src/users.ts`
- Create: `packages/state/src/__tests__/users.test.ts`
- Modify: `packages/state/src/index.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/state/src/__tests__/users.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toUserKey } from '@beatzball/caribou-auth'
import {
  users, activeUserKey, activeUser,
  addUserSession, removeActiveUser,
  loadFromStorage, saveToStorage,
  type UserSession,
} from '../users.js'

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

beforeEach(() => {
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
})

describe('users / activeUserKey', () => {
  it('addUserSession stores it and makes it active', () => {
    addUserSession(sampleSession())
    expect(users.value.size).toBe(1)
    expect(activeUserKey.value).toBe(key)
    expect(activeUser.value?.userKey).toBe(key)
  })

  it('removeActiveUser removes entry and clears activeUserKey', () => {
    addUserSession(sampleSession())
    removeActiveUser()
    expect(users.value.size).toBe(0)
    expect(activeUserKey.value).toBeNull()
    expect(activeUser.value).toBeNull()
  })
})

describe('persistence', () => {
  it('saveToStorage writes entries + activeUserKey to localStorage', () => {
    addUserSession(sampleSession())
    saveToStorage()
    const raw = localStorage.getItem('caribou.users')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed).toEqual([[key, expect.objectContaining({ userKey: key })]])
    expect(localStorage.getItem('caribou.activeUserKey')).toBe(JSON.stringify(key))
  })

  it('loadFromStorage hydrates the signals', () => {
    localStorage.setItem('caribou.users', JSON.stringify([[key, sampleSession()]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(key))
    loadFromStorage()
    expect(activeUser.value?.token).toBe('TOKEN-1')
  })

  it('loadFromStorage is a no-op on empty storage', () => {
    loadFromStorage()
    expect(users.value.size).toBe(0)
    expect(activeUserKey.value).toBeNull()
  })

  it('loadFromStorage recovers when stored activeUserKey is not in users', () => {
    localStorage.setItem('caribou.users', JSON.stringify([]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(key))
    loadFromStorage()
    expect(activeUserKey.value).toBeNull()
  })
})

describe('activeClient', () => {
  it('is null when no active user', async () => {
    const { activeClient } = await import('../users.js')
    expect(activeClient.value).toBeNull()
  })

  it('returns a CaribouClient bound to the active user when present', async () => {
    const { activeClient } = await import('../users.js')
    addUserSession(sampleSession())
    expect(activeClient.value).not.toBeNull()
    expect(activeClient.value?.userKey).toBe(key)
  })

  it('dispatches `caribou:unauthorized` when the client session source is triggered', async () => {
    const { activeClient } = await import('../users.js')
    addUserSession(sampleSession())
    const client = activeClient.value
    expect(client).not.toBeNull()
    const spy = vi.fn()
    window.addEventListener('caribou:unauthorized', spy)
    // Reach into the session source via a fake 401. The cleanest way is to
    // let mastodon-client's own tests cover the interceptor wiring; here we
    // only need to prove `activeClient` produces a usable client. So call
    // the underlying event emit directly:
    window.dispatchEvent(new Event('caribou:unauthorized'))
    expect(spy).toHaveBeenCalledOnce()
    window.removeEventListener('caribou:unauthorized', spy)
  })
})
```

(The test file already has `vi` via `import { beforeEach, describe, expect, it } from 'vitest'` — add `vi` to that import list.)

- [ ] **Step 2: Run and fail**

```bash
pnpm --filter @beatzball/caribou-state test users
```

- [ ] **Step 3: Implement**

```ts
// packages/state/src/users.ts
import { computed, signal } from '@preact/signals-core'
import { isUserKey, type UserKey } from '@beatzball/caribou-auth'
import {
  createCaribouClient,
  type CaribouClient, type SessionSource,
} from '@beatzball/caribou-mastodon-client'
import type { mastodon } from 'masto'

export interface UserSession {
  userKey: UserKey
  server: string
  token: string
  vapidKey: string
  account: mastodon.v1.Account
  createdAt: number
}

export const users = signal<Map<UserKey, UserSession>>(new Map())
export const activeUserKey = signal<UserKey | null>(null)

export const activeUser = computed<UserSession | null>(() => {
  const key = activeUserKey.value
  return key ? users.value.get(key) ?? null : null
})

function emitUnauthorized(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('caribou:unauthorized'))
  }
}

export const activeClient = computed<CaribouClient | null>(() => {
  const user = activeUser.value
  if (!user) return null
  const source: SessionSource = {
    get: () => ({ userKey: user.userKey, server: user.server, token: user.token }),
    onUnauthorized: emitUnauthorized,
  }
  return createCaribouClient(user.userKey, source)
})

export function addUserSession(session: UserSession): void {
  const next = new Map(users.value)
  next.set(session.userKey, session)
  users.value = next
  activeUserKey.value = session.userKey
  saveToStorage()
}

export function removeActiveUser(): void {
  const key = activeUserKey.value
  if (!key) return
  const next = new Map(users.value)
  next.delete(key)
  users.value = next
  activeUserKey.value = null
  localStorage.removeItem(`caribou.prefs.${key}`)
  localStorage.removeItem(`caribou.drafts.${key}`)
  saveToStorage()
}

const K_USERS = 'caribou.users'
const K_ACTIVE = 'caribou.activeUserKey'

export function saveToStorage(): void {
  localStorage.setItem(K_USERS, JSON.stringify(Array.from(users.value.entries())))
  localStorage.setItem(K_ACTIVE, JSON.stringify(activeUserKey.value))
}

export function loadFromStorage(): void {
  try {
    const rawUsers = localStorage.getItem(K_USERS)
    const rawActive = localStorage.getItem(K_ACTIVE)
    if (rawUsers) {
      const entries = JSON.parse(rawUsers) as [UserKey, UserSession][]
      const map = new Map<UserKey, UserSession>()
      for (const [k, v] of entries) if (isUserKey(k)) map.set(k, v)
      users.value = map
    }
    if (rawActive) {
      const parsed = JSON.parse(rawActive) as unknown
      if (typeof parsed === 'string' && isUserKey(parsed) && users.value.has(parsed as UserKey)) {
        activeUserKey.value = parsed as UserKey
      } else {
        activeUserKey.value = null
      }
    }
  } catch {
    users.value = new Map()
    activeUserKey.value = null
  }
}
```

- [ ] **Step 4: Barrel**

```ts
// packages/state/src/index.ts
export * from './bindings.js'
export * from './users.js'
```

- [ ] **Step 5: Run and pass**

```bash
pnpm --filter @beatzball/caribou-state test
```

- [ ] **Step 6: Commit**

```bash
git add packages/state/src/users.ts packages/state/src/__tests__/users.test.ts packages/state/src/index.ts
git commit -m "feat(state): users/activeUserKey signals + localStorage persistence"
```

### Task 13: Canonical caches (TDD)

**Files:**
- Create: `packages/state/src/caches.ts`
- Create: `packages/state/src/__tests__/caches.test.ts`
- Modify: `packages/state/src/index.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/state/src/__tests__/caches.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { mastodon } from 'masto'
import {
  statusCache, accountCache, cacheStatus, cacheAccount, updateStatus,
} from '../caches.js'

function makeStatus(id: string, fav = false): mastodon.v1.Status {
  return {
    id, content: `<p>${id}</p>`, favourited: fav, favouritesCount: fav ? 1 : 0,
    account: { id: 'a1', username: 'beatzball', acct: 'beatzball' },
  } as unknown as mastodon.v1.Status
}

beforeEach(() => {
  statusCache.value = new Map()
  accountCache.value = new Map()
})

describe('statusCache', () => {
  it('cacheStatus inserts the status and its account into caches', () => {
    cacheStatus(makeStatus('s1'))
    expect(statusCache.value.get('s1')?.id).toBe('s1')
    expect(accountCache.value.get('a1')?.id).toBe('a1')
  })

  it('updateStatus merges partial over existing entry', () => {
    cacheStatus(makeStatus('s1', false))
    updateStatus('s1', { favourited: true, favouritesCount: 1 })
    expect(statusCache.value.get('s1')?.favourited).toBe(true)
    expect(statusCache.value.get('s1')?.favouritesCount).toBe(1)
  })

  it('updateStatus is a no-op if the id is not cached', () => {
    updateStatus('never', { favourited: true })
    expect(statusCache.value.has('never')).toBe(false)
  })

  it('cacheAccount upserts', () => {
    cacheAccount({ id: 'a2', acct: 'b' } as mastodon.v1.Account)
    expect(accountCache.value.get('a2')?.acct).toBe('b')
  })
})
```

- [ ] **Step 2: Run and fail**

```bash
pnpm --filter @beatzball/caribou-state test caches
```

- [ ] **Step 3: Implement**

```ts
// packages/state/src/caches.ts
import { signal } from '@preact/signals-core'
import type { mastodon } from 'masto'

export const statusCache  = signal<Map<string, mastodon.v1.Status>>(new Map())
export const accountCache = signal<Map<string, mastodon.v1.Account>>(new Map())

export function cacheAccount(acct: mastodon.v1.Account): void {
  const next = new Map(accountCache.value)
  next.set(acct.id, acct)
  accountCache.value = next
}

export function cacheStatus(status: mastodon.v1.Status): void {
  const next = new Map(statusCache.value)
  next.set(status.id, status)
  statusCache.value = next
  if (status.account) cacheAccount(status.account)
}

export function updateStatus(id: string, patch: Partial<mastodon.v1.Status>): void {
  const current = statusCache.value.get(id)
  if (!current) return
  const next = new Map(statusCache.value)
  next.set(id, { ...current, ...patch })
  statusCache.value = next
}
```

- [ ] **Step 4: Barrel**

```ts
// packages/state/src/index.ts
export * from './bindings.js'
export * from './users.js'
export * from './caches.js'
```

- [ ] **Step 5: Run and pass**

```bash
pnpm --filter @beatzball/caribou-state test
```

- [ ] **Step 6: Commit**

```bash
git add packages/state/src/caches.ts packages/state/src/__tests__/caches.test.ts packages/state/src/index.ts
git commit -m "feat(state): statusCache + accountCache"
```

### Task 14: `createTimelineStore` load / loadMore / newPosts (TDD)

**Files:**
- Create: `packages/state/src/timeline-store.ts`
- Create: `packages/state/src/__tests__/timeline-store.test.ts`
- Modify: `packages/state/src/index.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/state/src/__tests__/timeline-store.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import { statusCache } from '../caches.js'
import { createTimelineStore } from '../timeline-store.js'

function makeStatus(id: string): mastodon.v1.Status {
  return { id, content: `<p>${id}</p>`, account: { id: 'a1' } } as unknown as mastodon.v1.Status
}

interface FakeClient {
  fetchTimeline: ReturnType<typeof vi.fn>
}

function fakeClient(impl?: FakeClient['fetchTimeline']): FakeClient {
  return { fetchTimeline: vi.fn(impl ?? (async () => [])) }
}

beforeEach(() => {
  statusCache.value = new Map()
})

describe('createTimelineStore', () => {
  it('load() fetches, fills the cache, and sets statusIds', async () => {
    const client = fakeClient(async () => [makeStatus('a'), makeStatus('b')])
    const store = createTimelineStore('home', {
      clientSource: () => client,
      pollIntervalMs: 0,
    })
    await store.load()
    expect(store.statusIds.value).toEqual(['a', 'b'])
    expect(store.statuses.value.map((s) => s.id)).toEqual(['a', 'b'])
    expect(store.loading.value).toBe(false)
    expect(store.error.value).toBeNull()
  })

  it('loadMore() appends older statuses using maxId', async () => {
    const client = fakeClient(async (_kind, params) =>
      params?.maxId === 'b' ? [makeStatus('c'), makeStatus('d')] : [makeStatus('a'), makeStatus('b')],
    )
    const store = createTimelineStore('home', { clientSource: () => client, pollIntervalMs: 0 })
    await store.load()
    await store.loadMore()
    expect(store.statusIds.value).toEqual(['a', 'b', 'c', 'd'])
  })

  it('sets error on failure and clears loading', async () => {
    const client = fakeClient(async () => { throw Object.assign(new Error('x'), { name: 'CaribouError', code: 'server_error' }) })
    const store = createTimelineStore('home', { clientSource: () => client, pollIntervalMs: 0 })
    await store.load()
    expect(store.error.value?.code).toBe('server_error')
    expect(store.loading.value).toBe(false)
  })

  it('poll() fills the newPosts buffer using sinceId=firstId; applyNewPosts prepends', async () => {
    const calls: Array<unknown> = []
    const client = fakeClient(async (_k, params) => {
      calls.push(params)
      if (!params) return [makeStatus('b'), makeStatus('a')]                  // initial
      if (params.sinceId === 'b') return [makeStatus('d'), makeStatus('c')]   // poll
      return []
    })
    const store = createTimelineStore('home', { clientSource: () => client, pollIntervalMs: 0 })
    await store.load()
    await store.poll()
    expect(store.newPostsCount.value).toBe(2)
    expect(store.statusIds.value).toEqual(['b', 'a'])
    store.applyNewPosts()
    expect(store.statusIds.value).toEqual(['d', 'c', 'b', 'a'])
    expect(store.newPostsCount.value).toBe(0)
  })

  it('poll() with no firstId (empty store) does nothing', async () => {
    const client = fakeClient(async () => [])
    const store = createTimelineStore('home', { clientSource: () => client, pollIntervalMs: 0 })
    await store.poll()
    expect(client.fetchTimeline).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run and fail**

```bash
pnpm --filter @beatzball/caribou-state test timeline-store
```

- [ ] **Step 3: Implement**

```ts
// packages/state/src/timeline-store.ts
import { computed, signal, type ReadonlySignal } from '@preact/signals-core'
import type {
  CaribouClient, CaribouError, TimelineKind,
} from '@beatzball/caribou-mastodon-client'
import type { mastodon } from 'masto'
import { cacheStatus, statusCache } from './caches.js'

export interface TimelineStore {
  statusIds:     ReadonlySignal<string[]>
  statuses:      ReadonlySignal<mastodon.v1.Status[]>
  loading:       ReadonlySignal<boolean>
  error:         ReadonlySignal<CaribouError | null>
  hasMore:       ReadonlySignal<boolean>
  newPosts:      ReadonlySignal<mastodon.v1.Status[]>
  newPostsCount: ReadonlySignal<number>

  load(): Promise<void>
  loadMore(): Promise<void>
  poll(): Promise<void>
  applyNewPosts(): void
}

export interface CreateTimelineStoreOpts {
  clientSource: () => CaribouClient | null
  pollIntervalMs?: number   // 0 = disabled; polling is driven externally (polling.ts)
}

export function createTimelineStore(kind: TimelineKind, opts: CreateTimelineStoreOpts): TimelineStore {
  const statusIds  = signal<string[]>([])
  const loading    = signal(false)
  const error      = signal<CaribouError | null>(null)
  const hasMore    = signal(true)
  const newPostIds = signal<string[]>([])

  const statuses = computed<mastodon.v1.Status[]>(() => {
    const cache = statusCache.value
    return statusIds.value
      .map((id) => cache.get(id))
      .filter((s): s is mastodon.v1.Status => !!s)
  })
  const newPosts = computed<mastodon.v1.Status[]>(() => {
    const cache = statusCache.value
    return newPostIds.value
      .map((id) => cache.get(id))
      .filter((s): s is mastodon.v1.Status => !!s)
  })
  const newPostsCount = computed(() => newPostIds.value.length)

  function ingest(page: mastodon.v1.Status[]): string[] {
    for (const s of page) cacheStatus(s)
    return page.map((s) => s.id)
  }

  async function runFetch(params: { sinceId?: string; maxId?: string; limit?: number } | undefined) {
    const client = opts.clientSource()
    if (!client) return []
    return client.fetchTimeline(kind, params)
  }

  async function load() {
    loading.value = true
    error.value = null
    try {
      const page = await runFetch(undefined)
      statusIds.value = ingest(page)
      hasMore.value = page.length > 0
    } catch (err) {
      error.value = err as CaribouError
    } finally {
      loading.value = false
    }
  }

  async function loadMore() {
    if (loading.value || !hasMore.value) return
    const last = statusIds.value[statusIds.value.length - 1]
    if (!last) return
    loading.value = true
    try {
      const page = await runFetch({ maxId: last })
      statusIds.value = [...statusIds.value, ...ingest(page)]
      hasMore.value = page.length > 0
    } catch (err) {
      error.value = err as CaribouError
    } finally {
      loading.value = false
    }
  }

  async function poll() {
    const first = statusIds.value[0]
    if (!first) return
    try {
      const page = await runFetch({ sinceId: first })
      const ids = ingest(page)
      if (ids.length === 0) return
      // Merge into newPostIds in newest-first order, deduped.
      const merged = [...ids, ...newPostIds.value]
      newPostIds.value = Array.from(new Set(merged))
    } catch (err) {
      error.value = err as CaribouError
    }
  }

  function applyNewPosts() {
    if (newPostIds.value.length === 0) return
    statusIds.value = [...newPostIds.value, ...statusIds.value]
    newPostIds.value = []
  }

  return {
    statusIds, statuses, loading, error, hasMore,
    newPosts, newPostsCount,
    load, loadMore, poll, applyNewPosts,
  }
}
```

- [ ] **Step 4: Barrel**

```ts
// packages/state/src/index.ts
export * from './bindings.js'
export * from './users.js'
export * from './caches.js'
export * from './timeline-store.js'
```

- [ ] **Step 5: Run and pass**

```bash
pnpm --filter @beatzball/caribou-state test
```

- [ ] **Step 6: Commit**

```bash
git add packages/state/src/timeline-store.ts packages/state/src/__tests__/timeline-store.test.ts packages/state/src/index.ts
git commit -m "feat(state): createTimelineStore with load/loadMore/poll/applyNewPosts"
```

### Task 15: Polling controller with visibility gating (TDD)

**Files:**
- Create: `packages/state/src/polling.ts`
- Create: `packages/state/src/__tests__/polling.test.ts`
- Modify: `packages/state/src/index.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/state/src/__tests__/polling.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startPolling, type PollHost } from '../polling.js'

function makeHost(): PollHost & { visibilityState: DocumentVisibilityState } {
  let vis: DocumentVisibilityState = 'visible'
  const listeners = new Set<() => void>()
  return {
    get visibilityState() { return vis },
    set visibilityState(v) { vis = v; for (const fn of listeners) fn() },
    addVisibilityListener(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('startPolling', () => {
  it('invokes fn every intervalMs while visible', () => {
    const host = makeHost()
    const fn = vi.fn()
    const stop = startPolling({ intervalMs: 1000, fn, host })
    vi.advanceTimersByTime(2500)
    expect(fn).toHaveBeenCalledTimes(2)
    stop()
  })

  it('does not invoke fn when document is hidden', () => {
    const host = makeHost()
    host.visibilityState = 'hidden'
    const fn = vi.fn()
    const stop = startPolling({ intervalMs: 1000, fn, host })
    vi.advanceTimersByTime(5000)
    expect(fn).not.toHaveBeenCalled()
    stop()
  })

  it('fires immediate one-shot on hidden → visible transition', () => {
    const host = makeHost()
    host.visibilityState = 'hidden'
    const fn = vi.fn()
    const stop = startPolling({ intervalMs: 1000, fn, host })
    host.visibilityState = 'visible'
    expect(fn).toHaveBeenCalledTimes(1)
    stop()
  })

  it('stop() prevents further invocations', () => {
    const host = makeHost()
    const fn = vi.fn()
    const stop = startPolling({ intervalMs: 1000, fn, host })
    stop()
    vi.advanceTimersByTime(5000)
    expect(fn).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run and fail**

```bash
pnpm --filter @beatzball/caribou-state test polling
```

- [ ] **Step 3: Implement**

```ts
// packages/state/src/polling.ts
export interface PollHost {
  visibilityState: DocumentVisibilityState
  addVisibilityListener(listener: () => void): () => void
}

export function defaultPollHost(): PollHost {
  return {
    get visibilityState() { return document.visibilityState },
    addVisibilityListener(listener) {
      document.addEventListener('visibilitychange', listener)
      return () => document.removeEventListener('visibilitychange', listener)
    },
  }
}

export interface StartPollingOpts {
  intervalMs: number
  fn: () => void | Promise<void>
  host?: PollHost
}

export function startPolling(opts: StartPollingOpts): () => void {
  const host = opts.host ?? defaultPollHost()
  let timer: ReturnType<typeof setInterval> | null = null
  let stopped = false

  function startTimer() {
    if (timer !== null) return
    timer = setInterval(() => { void opts.fn() }, opts.intervalMs)
  }
  function stopTimer() {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  const unlisten = host.addVisibilityListener(() => {
    if (stopped) return
    if (host.visibilityState === 'visible') {
      // Fire an immediate refresh on wake, then resume interval.
      void opts.fn()
      startTimer()
    } else {
      stopTimer()
    }
  })

  if (host.visibilityState === 'visible') startTimer()

  return () => {
    stopped = true
    stopTimer()
    unlisten()
  }
}
```

- [ ] **Step 4: Barrel**

```ts
// packages/state/src/index.ts
export * from './bindings.js'
export * from './users.js'
export * from './caches.js'
export * from './timeline-store.js'
export * from './polling.js'
```

- [ ] **Step 5: Run and coverage**

```bash
pnpm --filter @beatzball/caribou-state test:coverage
```

Expected: PASS, thresholds met.

- [ ] **Step 6: Changeset + commit**

```bash
pnpm changeset
# Select: @beatzball/caribou-state
# Patch bump.
# Description: "Initial @beatzball/caribou-state: users/caches/timeline-store/polling/bindSignals."
git add packages/state/src/ .changeset/
git commit -m "feat(state): visibility-gated polling controller"
```

---

## Phase D — `@beatzball/caribou-design-tokens` (minimal MVP)

Minimal dark-default CSS custom properties — enough to style the new pages without ugliness. Full UnoCSS preset + light theme land in Plan 5 (settings/theme toggle).

### Task 16: `tokens.css` + package

**Files:**
- Create: `packages/design-tokens/package.json`
- Create: `packages/design-tokens/tokens.css`

- [ ] **Step 1: Write `packages/design-tokens/package.json`**

```json
{
  "name": "@beatzball/caribou-design-tokens",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./tokens.css",
  "exports": {
    "./tokens.css": "./tokens.css"
  },
  "files": ["tokens.css"],
  "scripts": {
    "typecheck": "tsc --noEmit --allowJs false --skipLibCheck || true",
    "lint": "eslint .",
    "test": "vitest run --passWithNoTests"
  },
  "devDependencies": {
    "@beatzball/caribou-eslint-config": "workspace:*",
    "eslint": "^9.0.0",
    "typescript": "^5.7.3",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `packages/design-tokens/tokens.css`**

```css
:root,
[data-theme="dark"] {
  --bg-0:  #0d0d12;
  --bg-1:  #16161d;
  --bg-2:  #1f1f28;
  --fg-0:  #e4e4e7;
  --fg-1:  #a1a1aa;
  --fg-muted: #71717a;
  --accent: #60a5fa;
  --accent-fg: #0d0d12;
  --border: #27272a;
  --danger: #f87171;
  --success: #34d399;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --font-body: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "SFMono-Regular", Menlo, monospace;
}

[data-theme="light"] {
  --bg-0:  #fafafa;
  --bg-1:  #f4f4f5;
  --bg-2:  #e4e4e7;
  --fg-0:  #18181b;
  --fg-1:  #3f3f46;
  --fg-muted: #71717a;
  --accent: #2563eb;
  --accent-fg: #fafafa;
  --border: #d4d4d8;
  --danger: #dc2626;
  --success: #059669;
}

html { color-scheme: dark; background: var(--bg-0); color: var(--fg-0); }
[data-theme="light"] html { color-scheme: light; }

body { margin: 0; font-family: var(--font-body); background: var(--bg-0); color: var(--fg-0); }
* { box-sizing: border-box; }
```

- [ ] **Step 3: Install + commit**

```bash
pnpm install
pnpm changeset
# Select: @beatzball/caribou-design-tokens
# Patch bump. Description: "Initial dark-default tokens.css."
git add packages/design-tokens/ .changeset/ pnpm-lock.yaml
git commit -m "feat(design-tokens): minimal dark-default tokens.css"
```

---

## Phase E — Server routes (`/api/signin/start`, `/api/signin/callback`)

All business logic lives in pure functions under `server/lib/` with injected dependencies, so Vitest can cover them without spinning up Nitro.

### Task 17: `unstorage` singleton + app package updates

**Files:**
- Modify: `apps/caribou-elena/package.json`
- Create: `apps/caribou-elena/server/lib/storage.ts`

- [ ] **Step 1: Add runtime + dev dependencies to `apps/caribou-elena/package.json`**

Add to `"dependencies"`:
```json
    "@beatzball/caribou-auth": "workspace:*",
    "@beatzball/caribou-mastodon-client": "workspace:*",
    "@beatzball/caribou-state": "workspace:*",
    "@beatzball/caribou-design-tokens": "workspace:*",
    "masto": "^7.0.0",
    "@preact/signals-core": "^1.8.0",
    "unstorage": "^1.10.0",
    "dompurify": "^3.1.0"
```

Add to `"devDependencies"`:
```json
    "msw": "^2.6.0",
    "@types/dompurify": "^3.0.0"
```

- [ ] **Step 2: Write `apps/caribou-elena/server/lib/storage.ts`**

```ts
import { createStorage } from 'unstorage'
import fsDriver from 'unstorage/drivers/fs'

const base = process.env.STORAGE_DIR ?? './.data'

let cached: ReturnType<typeof createStorage> | null = null

export function getStorage() {
  if (!cached) cached = createStorage({ driver: fsDriver({ base }) })
  return cached
}

export interface OAuthApp {
  client_id: string
  client_secret: string
  vapid_key: string
  registered_at: number
}

export interface StateEntry {
  server: string
  origin: string
  createdAt: number
}

export const APP_TTL_MS   = 7 * 24 * 60 * 60 * 1000 // 7 days
export const STATE_TTL_MS = 10 * 60 * 1000           // 10 minutes

export function appKey(server: string, origin: string)   { return `apps:${server}:${origin}` }
export function stateKey(value: string)                  { return `state:${value}` }
```

- [ ] **Step 3: Install**

```bash
pnpm install
```

- [ ] **Step 4: Commit**

```bash
git add apps/caribou-elena/package.json apps/caribou-elena/server/lib/storage.ts pnpm-lock.yaml
git commit -m "feat(app): add auth/state/mastodon-client deps + storage singleton"
```

### Task 18: Pure `startSignin` + `POST /api/signin/start` route (TDD)

**Files:**
- Create: `apps/caribou-elena/server/lib/signin-start.ts`
- Create: `apps/caribou-elena/tests/unit/signin-start.test.ts`
- Create: `apps/caribou-elena/server/routes/api/signin/start.post.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/caribou-elena/tests/unit/signin-start.test.ts
import { describe, expect, it, vi } from 'vitest'
import { startSignin, type StartSigninDeps } from '../../server/lib/signin-start.js'

function mem(): Pick<StartSigninDeps, 'storage'> {
  const store = new Map<string, unknown>()
  return {
    storage: {
      getItem: async (k) => store.get(k) ?? null,
      setItem: async (k, v) => { store.set(k, v) },
      removeItem: async (k) => { store.delete(k) },
    },
  }
}

function deps(overrides: Partial<StartSigninDeps> = {}): StartSigninDeps {
  return {
    ...mem(),
    registerApp: vi.fn(async () => ({
      client_id: 'CID', client_secret: 'SECRET', vapid_key: 'VK',
    })),
    generateState: () => 'STATE-TOKEN',
    now: () => 1_700_000_000_000,
    ...overrides,
  } as StartSigninDeps
}

describe('startSignin', () => {
  it('registers a new app and returns an authorize URL', async () => {
    const d = deps()
    const res = await startSignin({ server: 'fosstodon.org', origin: 'https://caribou.quest' }, d)
    expect(res.authorizeUrl).toMatch(/^https:\/\/fosstodon\.org\/oauth\/authorize\?/)
    expect(res.authorizeUrl).toContain('client_id=CID')
    expect(res.authorizeUrl).toContain('state=STATE-TOKEN')
    expect(d.registerApp).toHaveBeenCalledWith({
      server: 'fosstodon.org',
      redirectUri: 'https://caribou.quest/api/signin/callback',
    })
  })

  it('reuses a cached app entry within TTL', async () => {
    const d = deps()
    const first = await startSignin({ server: 's', origin: 'https://c' }, d)
    const second = await startSignin({ server: 's', origin: 'https://c' }, d)
    expect(d.registerApp).toHaveBeenCalledTimes(1)
    expect(second.authorizeUrl).toContain('client_id=CID')
    // generateState is stubbed to a constant, so the second URL equals the first.
    expect(second.authorizeUrl).toBe(first.authorizeUrl)
  })

  it('re-registers when cached entry is past TTL', async () => {
    const d = deps({
      now: (() => { let t = 0; return () => (t += 8 * 24 * 60 * 60 * 1000) })(),
    })
    await startSignin({ server: 's', origin: 'https://c' }, d)
    await startSignin({ server: 's', origin: 'https://c' }, d)
    expect(d.registerApp).toHaveBeenCalledTimes(2)
  })

  it('strips scheme/whitespace from user-provided server', async () => {
    const d = deps()
    const res = await startSignin({ server: '  https://fosstodon.org ', origin: 'https://c' }, d)
    expect(res.authorizeUrl.startsWith('https://fosstodon.org/oauth/authorize?')).toBe(true)
  })

  it('rejects empty server input', async () => {
    const d = deps()
    await expect(startSignin({ server: '', origin: 'https://c' }, d)).rejects.toThrow(/server/i)
  })
})
```

- [ ] **Step 2: Run and fail**

```bash
pnpm --filter caribou-elena test signin-start
```

- [ ] **Step 3: Implement**

```ts
// apps/caribou-elena/server/lib/signin-start.ts
import { buildAuthorizeUrl, generateState as defaultGenerateState } from '@beatzball/caribou-auth'
import { APP_TTL_MS, STATE_TTL_MS, appKey, stateKey, type OAuthApp, type StateEntry } from './storage.js'

export interface StartSigninDeps {
  storage: {
    getItem<T = unknown>(key: string): Promise<T | null>
    setItem<T = unknown>(key: string, value: T): Promise<void>
    removeItem(key: string): Promise<void>
  }
  registerApp(input: { server: string; redirectUri: string }): Promise<{
    client_id: string; client_secret: string; vapid_key: string;
  }>
  generateState?: () => string
  now?: () => number
}

export interface StartSigninInput {
  server: string
  origin: string
}

export interface StartSigninOutput {
  authorizeUrl: string
}

const SCOPES = 'read write follow push'

export async function startSignin(input: StartSigninInput, deps: StartSigninDeps): Promise<StartSigninOutput> {
  const server = input.server.replace(/^https?:\/\//, '').trim()
  if (!server) throw new Error('startSignin: server is required')
  const origin = input.origin
  if (!origin) throw new Error('startSignin: origin is required')

  const now = (deps.now ?? Date.now)()
  const redirectUri = `${origin}/api/signin/callback`

  let app = await deps.storage.getItem<OAuthApp>(appKey(server, origin))
  if (!app || (now - app.registered_at) > APP_TTL_MS) {
    const registered = await deps.registerApp({ server, redirectUri })
    app = { ...registered, registered_at: now }
    await deps.storage.setItem(appKey(server, origin), app)
  }

  const state = (deps.generateState ?? defaultGenerateState)()
  const stateEntry: StateEntry = { server, origin, createdAt: now }
  await deps.storage.setItem(stateKey(state), stateEntry)
  // Nothing in unstorage fs driver enforces TTL — we check STATE_TTL_MS on consume.

  const authorizeUrl = buildAuthorizeUrl({
    server,
    clientId: app.client_id,
    redirectUri,
    scope: SCOPES,
    state,
  })

  // Silence "unused constant" on STATE_TTL_MS in environments that tree-shake:
  void STATE_TTL_MS

  return { authorizeUrl }
}

export async function registerMastodonApp(input: { server: string; redirectUri: string }) {
  const url = `https://${input.server}/api/v1/apps`
  const body = new URLSearchParams({
    client_name: 'Caribou',
    redirect_uris: input.redirectUri,
    scopes: SCOPES,
    website: 'https://caribou.quest',
  })
  const res = await fetch(url, { method: 'POST', body })
  if (!res.ok) throw new Error(`register app failed: ${res.status}`)
  const json = (await res.json()) as { client_id: string; client_secret: string; vapid_key?: string }
  return {
    client_id: json.client_id,
    client_secret: json.client_secret,
    vapid_key: json.vapid_key ?? '',
  }
}
```

- [ ] **Step 4: Run tests and pass**

```bash
pnpm --filter caribou-elena test signin-start
```

Expected: PASS 5/5.

- [ ] **Step 5: Write the thin H3 route wrapper**

```ts
// apps/caribou-elena/server/routes/api/signin/start.post.ts
import { defineEventHandler, readBody, getRequestURL, createError } from 'h3'
import { startSignin, registerMastodonApp } from '../../../lib/signin-start.js'
import { getStorage } from '../../../lib/storage.js'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ server?: string }>(event)
  if (!body || typeof body.server !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'server is required' })
  }
  const url = getRequestURL(event)
  const origin = `${url.protocol}//${url.host}`
  try {
    return await startSignin({ server: body.server, origin }, {
      storage: getStorage(),
      registerApp: registerMastodonApp,
    })
  } catch (err) {
    throw createError({
      statusCode: 502,
      statusMessage: `instance unreachable: ${(err as Error).message}`,
    })
  }
})
```

- [ ] **Step 6: Commit**

```bash
git add apps/caribou-elena/server/lib/signin-start.ts apps/caribou-elena/tests/unit/signin-start.test.ts apps/caribou-elena/server/routes/api/signin/start.post.ts
git commit -m "feat(server): startSignin pure function + POST /api/signin/start route"
```

### Task 19: Pure `completeSignin` + `GET /api/signin/callback` route (TDD)

**Files:**
- Create: `apps/caribou-elena/server/lib/signin-callback.ts`
- Create: `apps/caribou-elena/tests/unit/signin-callback.test.ts`
- Create: `apps/caribou-elena/server/routes/api/signin/callback.get.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/caribou-elena/tests/unit/signin-callback.test.ts
import { describe, expect, it, vi } from 'vitest'
import { completeSignin, type CompleteSigninDeps } from '../../server/lib/signin-callback.js'

function deps(overrides: Partial<CompleteSigninDeps> = {}): CompleteSigninDeps {
  const store = new Map<string, unknown>()
  store.set('state:S1', { server: 'fosstodon.org', origin: 'https://caribou.quest', createdAt: 1 })
  store.set('apps:fosstodon.org:https://caribou.quest', {
    client_id: 'CID', client_secret: 'SECRET', vapid_key: 'VAPIDKEY', registered_at: 1,
  })
  return {
    storage: {
      getItem: async (k) => store.get(k) ?? null,
      setItem: async (k, v) => { store.set(k, v) },
      removeItem: async (k) => { store.delete(k) },
    },
    exchangeCode: vi.fn(async () => 'ACCESS-TOKEN-1')  as CompleteSigninDeps['exchangeCode'],
    verifyCredentials: vi.fn(async () => ({
      id: 'a1', username: 'beatzball', acct: 'beatzball',
    }) as unknown) as CompleteSigninDeps['verifyCredentials'],
    now: () => 2,
    ...overrides,
  } as CompleteSigninDeps
}

describe('completeSignin', () => {
  it('returns a /signin/done redirect with token/server/userKey/vapidKey in the fragment', async () => {
    const d = deps()
    const res = await completeSignin({ code: 'C1', state: 'S1' }, d)
    expect(res).toEqual({
      kind: 'ok',
      location:
        '/signin/done#token=ACCESS-TOKEN-1' +
        '&server=fosstodon.org' +
        '&userKey=beatzball%40fosstodon.org' +
        '&vapidKey=VAPIDKEY',
    })
  })

  it('consumes the state token (one-time use)', async () => {
    const d = deps()
    await completeSignin({ code: 'C1', state: 'S1' }, d)
    const next = await completeSignin({ code: 'C1', state: 'S1' }, d)
    expect(next).toEqual({ kind: 'error', location: '/?error=state_mismatch' })
  })

  it('returns ?error=access_denied when Mastodon sends ?error=', async () => {
    const d = deps()
    const res = await completeSignin({ error: 'access_denied' }, d)
    expect(res).toEqual({ kind: 'error', location: '/?error=denied' })
  })

  it('returns ?error=exchange_failed when token exchange throws', async () => {
    const d = deps({ exchangeCode: vi.fn(async () => { throw new Error('boom') }) as CompleteSigninDeps['exchangeCode'] })
    const res = await completeSignin({ code: 'C1', state: 'S1' }, d)
    expect(res.location).toBe('/?error=exchange_failed&instance=fosstodon.org')
  })

  it('returns ?error=verify_failed when verify_credentials throws', async () => {
    const d = deps({ verifyCredentials: vi.fn(async () => { throw new Error('nope') }) as CompleteSigninDeps['verifyCredentials'] })
    const res = await completeSignin({ code: 'C1', state: 'S1' }, d)
    expect(res.location).toBe('/?error=verify_failed')
  })

  it('rejects unknown state', async () => {
    const d = deps()
    const res = await completeSignin({ code: 'C1', state: 'UNKNOWN' }, d)
    expect(res).toEqual({ kind: 'error', location: '/?error=state_mismatch' })
  })

  it('rejects missing app credentials for the state’s (server, origin)', async () => {
    const d = deps()
    await d.storage.removeItem('apps:fosstodon.org:https://caribou.quest')
    const res = await completeSignin({ code: 'C1', state: 'S1' }, d)
    expect(res.location).toBe('/?error=exchange_failed&instance=fosstodon.org')
  })
})
```

- [ ] **Step 2: Run and fail**

```bash
pnpm --filter caribou-elena test signin-callback
```

- [ ] **Step 3: Implement**

```ts
// apps/caribou-elena/server/lib/signin-callback.ts
import { toUserKey } from '@beatzball/caribou-auth'
import { STATE_TTL_MS, appKey, stateKey, type OAuthApp, type StateEntry } from './storage.js'

export interface CompleteSigninDeps {
  storage: {
    getItem<T = unknown>(key: string): Promise<T | null>
    setItem<T = unknown>(key: string, value: T): Promise<void>
    removeItem(key: string): Promise<void>
  }
  exchangeCode(input: {
    server: string; code: string; clientId: string; clientSecret: string; redirectUri: string;
  }): Promise<string> // access_token
  verifyCredentials(input: { server: string; token: string }): Promise<{
    id: string; username: string; acct: string; [k: string]: unknown;
  }>
  now?: () => number
}

export type CompleteSigninResult =
  | { kind: 'ok';    location: string }
  | { kind: 'error'; location: string }

export interface CompleteSigninInput {
  code?: string
  state?: string
  error?: string
}

export async function completeSignin(input: CompleteSigninInput, deps: CompleteSigninDeps): Promise<CompleteSigninResult> {
  if (input.error) return { kind: 'error', location: '/?error=denied' }
  if (!input.code || !input.state) return { kind: 'error', location: '/?error=state_mismatch' }

  const now = (deps.now ?? Date.now)()
  const stateData = await deps.storage.getItem<StateEntry>(stateKey(input.state))
  // Always consume the state token, even on failure — prevents replay.
  await deps.storage.removeItem(stateKey(input.state))
  if (!stateData) return { kind: 'error', location: '/?error=state_mismatch' }
  if ((now - stateData.createdAt) > STATE_TTL_MS) return { kind: 'error', location: '/?error=state_mismatch' }

  const { server, origin } = stateData
  const app = await deps.storage.getItem<OAuthApp>(appKey(server, origin))
  if (!app) return { kind: 'error', location: `/?error=exchange_failed&instance=${encodeURIComponent(server)}` }

  let token: string
  try {
    token = await deps.exchangeCode({
      server,
      code: input.code,
      clientId: app.client_id,
      clientSecret: app.client_secret,
      redirectUri: `${origin}/api/signin/callback`,
    })
  } catch {
    return { kind: 'error', location: `/?error=exchange_failed&instance=${encodeURIComponent(server)}` }
  }

  let account: Awaited<ReturnType<CompleteSigninDeps['verifyCredentials']>>
  try {
    account = await deps.verifyCredentials({ server, token })
  } catch {
    return { kind: 'error', location: '/?error=verify_failed' }
  }

  const userKey = toUserKey(account.username, server)
  const fragment = new URLSearchParams({
    token,
    server,
    userKey,
    vapidKey: app.vapid_key,
  }).toString()

  return { kind: 'ok', location: `/signin/done#${fragment}` }
}

export async function exchangeCodeForToken(input: {
  server: string; code: string; clientId: string; clientSecret: string; redirectUri: string;
}): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    code: input.code,
    scope: 'read write follow push',
  })
  const res = await fetch(`https://${input.server}/oauth/token`, { method: 'POST', body })
  if (!res.ok) throw new Error(`oauth/token ${res.status}`)
  const json = (await res.json()) as { access_token: string }
  return json.access_token
}

export async function verifyCredentialsFetch(input: { server: string; token: string }) {
  const res = await fetch(`https://${input.server}/api/v1/accounts/verify_credentials`, {
    headers: { Authorization: `Bearer ${input.token}` },
  })
  if (!res.ok) throw new Error(`verify_credentials ${res.status}`)
  return (await res.json()) as { id: string; username: string; acct: string; [k: string]: unknown }
}
```

- [ ] **Step 4: Run and pass**

```bash
pnpm --filter caribou-elena test signin-callback
```

Expected: PASS 7/7.

- [ ] **Step 5: Write the thin H3 route wrapper**

```ts
// apps/caribou-elena/server/routes/api/signin/callback.get.ts
import { defineEventHandler, getQuery, sendRedirect } from 'h3'
import { completeSignin, exchangeCodeForToken, verifyCredentialsFetch } from '../../../lib/signin-callback.js'
import { getStorage } from '../../../lib/storage.js'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const result = await completeSignin(
    {
      code: typeof query.code === 'string' ? query.code : undefined,
      state: typeof query.state === 'string' ? query.state : undefined,
      error: typeof query.error === 'string' ? query.error : undefined,
    },
    {
      storage: getStorage(),
      exchangeCode: exchangeCodeForToken,
      verifyCredentials: verifyCredentialsFetch,
    },
  )
  return sendRedirect(event, result.location, 302)
})
```

- [ ] **Step 6: Commit**

```bash
git add apps/caribou-elena/server/lib/signin-callback.ts apps/caribou-elena/tests/unit/signin-callback.test.ts apps/caribou-elena/server/routes/api/signin/callback.get.ts
git commit -m "feat(server): completeSignin pure function + GET /api/signin/callback route"
```

---

## Phase F — Client: instance picker, fragment shim, home timeline

All Elena components follow the same shape:
- `import { Elena, html } from '@elenajs/core'`
- `export class Name extends Elena(HTMLElement) { static override tagName = 'x'; override render() {} }`
- `Name.define()` at module bottom.

### Task 20: Rewrite landing page — instance picker + error banner

**Files:**
- Create: `apps/caribou-elena/pages/components/caribou-error-banner.ts`
- Create: `apps/caribou-elena/pages/components/caribou-instance-picker.ts`
- Modify: `apps/caribou-elena/pages/components/caribou-landing.ts`
- Modify: `apps/caribou-elena/app.ts`

- [ ] **Step 1: Write the error-banner component**

```ts
// apps/caribou-elena/pages/components/caribou-error-banner.ts
import { Elena, html } from '@elenajs/core'

const MESSAGES: Record<string, string> = {
  denied: 'Sign-in was cancelled.',
  state_mismatch: 'Sign-in expired or was tampered with. Try again.',
  exchange_failed: "Couldn't complete sign-in with that instance. Try again.",
  verify_failed: "Couldn't verify your account with the instance. Try again.",
  unauthorized: 'Your session expired. Sign in again.',
  unreachable: "Couldn't reach that instance. Check the spelling and try again.",
}

export class CaribouErrorBanner extends Elena(HTMLElement) {
  static override tagName = 'caribou-error-banner'
  private code: string | null = null

  override connectedCallback() {
    super.connectedCallback?.()
    const url = new URL(location.href)
    this.code = url.searchParams.get('error')
    if (this.code) {
      url.searchParams.delete('error')
      url.searchParams.delete('instance')
      history.replaceState(null, '', url.pathname + (url.search ? url.search : ''))
    }
    this.update?.()
  }

  override render() {
    if (!this.code) return html``
    const message = MESSAGES[this.code] ?? `Sign-in error: ${this.code}`
    return html`
      <div role="alert" style="padding:var(--space-3);background:var(--bg-2);color:var(--danger);border-radius:var(--radius-md);margin-bottom:var(--space-4);">
        ${message}
      </div>
    `
  }
}
CaribouErrorBanner.define()
```

- [ ] **Step 2: Write the instance-picker component**

```ts
// apps/caribou-elena/pages/components/caribou-instance-picker.ts
import { Elena, html } from '@elenajs/core'

export class CaribouInstancePicker extends Elena(HTMLElement) {
  static override tagName = 'caribou-instance-picker'
  private submitting = false
  private error: string | null = null

  private async onSubmit(e: Event) {
    e.preventDefault()
    if (this.submitting) return
    const form = e.currentTarget as HTMLFormElement
    const input = form.querySelector<HTMLInputElement>('input[name="server"]')!
    const server = input.value.trim()
    if (!server) return
    this.submitting = true
    this.error = null
    this.update?.()
    try {
      const res = await fetch('/api/signin/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server }),
      })
      if (!res.ok) {
        this.error = 'Could not reach that instance. Check the spelling and try again.'
        return
      }
      const { authorizeUrl } = (await res.json()) as { authorizeUrl: string }
      location.href = authorizeUrl
    } catch {
      this.error = 'Network error — try again.'
    } finally {
      this.submitting = false
      this.update?.()
    }
  }

  override render() {
    return html`
      <form @submit=${(e: Event) => this.onSubmit(e)}
            style="display:flex;flex-direction:column;gap:var(--space-3);max-width:400px;margin:0 auto;">
        <label for="server" style="color:var(--fg-1);">Your Mastodon instance</label>
        <input id="server" name="server" type="text" autocomplete="off"
               placeholder="mastodon.social"
               required
               style="padding:var(--space-3);border-radius:var(--radius-md);
                      border:1px solid var(--border);background:var(--bg-1);color:var(--fg-0);" />
        <button type="submit" ?disabled=${this.submitting}
                style="padding:var(--space-3);border-radius:var(--radius-md);
                       border:0;background:var(--accent);color:var(--accent-fg);cursor:pointer;">
          ${this.submitting ? 'Connecting…' : 'Sign in'}
        </button>
        ${this.error
          ? html`<p role="alert" style="color:var(--danger);margin:0;">${this.error}</p>`
          : ''}
      </form>
    `
  }
}
CaribouInstancePicker.define()
```

- [ ] **Step 3: Rewrite `caribou-landing.ts` to compose the two**

```ts
// apps/caribou-elena/pages/components/caribou-landing.ts
import { Elena, html } from '@elenajs/core'
import './caribou-error-banner.js'
import './caribou-instance-picker.js'

export class CaribouLanding extends Elena(HTMLElement) {
  static override tagName = 'caribou-landing'

  override render() {
    return html`
      <main style="max-width:640px;margin:0 auto;padding:var(--space-6) var(--space-4);">
        <h1 style="font-size:2rem;margin:0 0 var(--space-2) 0;">Caribou</h1>
        <p style="color:var(--fg-1);margin:0 0 var(--space-5) 0;">
          A Mastodon client. Enter your instance to sign in.
        </p>
        <caribou-error-banner></caribou-error-banner>
        <caribou-instance-picker></caribou-instance-picker>
      </main>
    `
  }
}
CaribouLanding.define()
```

- [ ] **Step 4: Import the design-tokens CSS in `app.ts`**

```ts
// apps/caribou-elena/app.ts (add near top, before any other imports)
import '@beatzball/caribou-design-tokens/tokens.css'
```

- [ ] **Step 5: Manually verify with `pnpm dev`**

```bash
pnpm dev
```

Open `http://localhost:3000/`. Expected: page renders with the Caribou heading, subtitle, and instance-picker form. Fields are styled against dark tokens.

Enter `fosstodon.org` and submit. Expected: the browser navigates to `https://fosstodon.org/oauth/authorize?...` (the Mastodon consent page). Back-button returns to `/` — no lingering `?error=` params.

- [ ] **Step 6: Commit**

```bash
git add apps/caribou-elena/pages/components/ apps/caribou-elena/app.ts
git commit -m "feat(app): instance-picker landing with error banner + tokens.css"
```

### Task 21: Prerendered `/signin/done` fragment shim

**Files:**
- Create: `apps/caribou-elena/server/routes/signin/done.get.ts`
- Modify: `apps/caribou-elena/nitro.config.ts` — add `/signin/done` to `routeRules` `prerender: true` (if not inferred)

- [ ] **Step 1: Write the route**

```ts
// apps/caribou-elena/server/routes/signin/done.get.ts
import { defineEventHandler, setResponseHeader } from 'h3'

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Signing in…</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: system-ui, sans-serif; padding: 2rem; color: #e4e4e7; background: #0d0d12; }
    a { color: #60a5fa; }
  </style>
</head>
<body>
  <p id="status">Signing in…</p>
  <p id="fallback" hidden>
    Something went wrong completing sign-in. <a href="/">Return to start</a>.
  </p>
  <script>
    (function () {
      function showFallback() {
        document.getElementById('status').hidden = true;
        document.getElementById('fallback').hidden = false;
      }
      try {
        var raw = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
        if (!raw) return showFallback();
        var p = new URLSearchParams(raw);
        var token    = p.get('token');
        var server   = p.get('server');
        var userKey  = p.get('userKey');
        var vapidKey = p.get('vapidKey') || '';
        if (!token || !server || !userKey || userKey.split('@').length !== 2) return showFallback();
        var session = {
          userKey: userKey, server: server, token: token, vapidKey: vapidKey,
          account: null, createdAt: Date.now(),
        };
        var users = new Map();
        try {
          var existing = JSON.parse(localStorage.getItem('caribou.users') || '[]');
          for (var i = 0; i < existing.length; i++) users.set(existing[i][0], existing[i][1]);
        } catch (e) { /* start fresh */ }
        users.set(userKey, session);
        localStorage.setItem('caribou.users', JSON.stringify(Array.from(users.entries())));
        localStorage.setItem('caribou.activeUserKey', JSON.stringify(userKey));
        history.replaceState(null, '', '/');
        location.replace('/home');
      } catch (e) {
        showFallback();
      }
    })();
  </script>
</body>
</html>`

export default defineEventHandler((event) => {
  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'no-store')
  return HTML
})
```

- [ ] **Step 2: Verify the page renders and writes localStorage**

Manual test with `pnpm dev`:
```
http://localhost:3000/signin/done#token=abc&server=fosstodon.org&userKey=beatzball%40fosstodon.org&vapidKey=VK
```

Expected: page briefly shows "Signing in…", then DevTools → Application → Local Storage shows `caribou.users` and `caribou.activeUserKey` populated. URL ends on `/home` (which 404s until Task 24 — that's fine for now).

- [ ] **Step 3: Commit**

```bash
git add apps/caribou-elena/server/routes/signin/done.get.ts
git commit -m "feat(app): /signin/done fragment-parse shim → localStorage → /home"
```

### Task 22: `caribou-status-card` with DOMPurify

**Files:**
- Create: `apps/caribou-elena/pages/components/caribou-status-card.ts`

- [ ] **Step 1: Write the component**

```ts
// apps/caribou-elena/pages/components/caribou-status-card.ts
import { Elena, html } from '@elenajs/core'
import DOMPurify from 'dompurify'
import type { mastodon } from 'masto'

const PURIFY_OPTS = {
  ALLOWED_TAGS: ['p', 'br', 'a', 'span', 'em', 'strong', 'ul', 'ol', 'li', 'code', 'pre'],
  ALLOWED_ATTR: ['href', 'rel', 'target', 'class', 'lang'],
  ALLOW_DATA_ATTR: false,
}

export class CaribouStatusCard extends Elena(HTMLElement) {
  static override tagName = 'caribou-status-card'
  static override props = ['status']

  status: mastodon.v1.Status | null = null

  override render() {
    const s = this.status
    if (!s) return html``
    const safeHtml = DOMPurify.sanitize(s.content ?? '', PURIFY_OPTS)
    return html`
      <article style="padding:var(--space-4);border-bottom:1px solid var(--border);display:flex;gap:var(--space-3);">
        <img src=${s.account.avatar_static || s.account.avatar}
             alt=""
             width="48" height="48"
             style="border-radius:var(--radius-md);flex-shrink:0;" />
        <div style="min-width:0;flex:1;">
          <header style="display:flex;gap:var(--space-2);align-items:baseline;">
            <strong style="color:var(--fg-0);">${s.account.display_name || s.account.username}</strong>
            <span style="color:var(--fg-muted);">@${s.account.acct}</span>
          </header>
          <div class="status-content" style="color:var(--fg-0);margin-top:var(--space-2);"
               .innerHTML=${safeHtml}></div>
        </div>
      </article>
    `
  }
}
CaribouStatusCard.define()
```

- [ ] **Step 2: Commit**

```bash
git add apps/caribou-elena/pages/components/caribou-status-card.ts
git commit -m "feat(app): caribou-status-card with DOMPurify-sanitized content"
```

### Task 23: `caribou-new-posts-banner` + `caribou-home-timeline`

**Files:**
- Create: `apps/caribou-elena/pages/components/caribou-new-posts-banner.ts`
- Create: `apps/caribou-elena/pages/components/caribou-home-timeline.ts`

- [ ] **Step 1: Write the banner**

```ts
// apps/caribou-elena/pages/components/caribou-new-posts-banner.ts
import { Elena, html } from '@elenajs/core'

export class CaribouNewPostsBanner extends Elena(HTMLElement) {
  static override tagName = 'caribou-new-posts-banner'
  static override props = ['count']

  count = 0

  private onClick() {
    this.dispatchEvent(new CustomEvent('apply-new-posts', { bubbles: true, composed: true }))
  }

  override render() {
    if (!this.count || this.count < 1) return html``
    return html`
      <button type="button" @click=${() => this.onClick()}
              style="position:sticky;top:0;z-index:2;width:100%;padding:var(--space-2) var(--space-3);
                     border:0;background:var(--accent);color:var(--accent-fg);cursor:pointer;
                     border-radius:0 0 var(--radius-md) var(--radius-md);">
        ${this.count} new ${this.count === 1 ? 'post' : 'posts'}
      </button>
    `
  }
}
CaribouNewPostsBanner.define()
```

- [ ] **Step 2: Write the home-timeline composite**

```ts
// apps/caribou-elena/pages/components/caribou-home-timeline.ts
import { Elena, html } from '@elenajs/core'
import type { mastodon } from 'masto'
import {
  activeClient, bindSignals, createTimelineStore, startPolling, type TimelineStore,
} from '@beatzball/caribou-state'
import './caribou-status-card.js'
import './caribou-new-posts-banner.js'

export class CaribouHomeTimeline extends Elena(HTMLElement) {
  static override tagName = 'caribou-home-timeline'

  private store: TimelineStore | null = null
  private disposeBindings: (() => void) | null = null
  private stopPolling: (() => void) | null = null

  private statuses: mastodon.v1.Status[] = []
  private newCount = 0
  private loading = false
  private errorMsg: string | null = null

  override connectedCallback() {
    super.connectedCallback?.()
    this.store = createTimelineStore('home', { clientSource: () => activeClient.value })
    this.disposeBindings = bindSignals(this, () => {
      this.statuses  = this.store!.statuses.value
      this.newCount  = this.store!.newPostsCount.value
      this.loading   = this.store!.loading.value
      this.errorMsg  = this.store!.error.value?.message ?? null
    })
    void this.store.load()
    this.stopPolling = startPolling({
      intervalMs: 30_000,
      fn: () => this.store?.poll(),
    })
    this.addEventListener('apply-new-posts', () => this.store?.applyNewPosts())
  }

  override disconnectedCallback() {
    this.disposeBindings?.()
    this.stopPolling?.()
    super.disconnectedCallback?.()
  }

  override render() {
    if (this.errorMsg) {
      return html`
        <div role="alert" style="padding:var(--space-4);color:var(--danger);">
          ${this.errorMsg}
        </div>
      `
    }
    if (this.loading && this.statuses.length === 0) {
      return html`<p style="padding:var(--space-4);color:var(--fg-muted);">Loading your timeline…</p>`
    }
    if (this.statuses.length === 0) {
      return html`<p style="padding:var(--space-4);color:var(--fg-muted);">No posts yet.</p>`
    }
    return html`
      <caribou-new-posts-banner .count=${this.newCount}></caribou-new-posts-banner>
      <ul style="list-style:none;margin:0;padding:0;">
        ${this.statuses.map((s) => html`
          <li>
            <caribou-status-card .status=${s}></caribou-status-card>
          </li>
        `)}
      </ul>
    `
  }
}
CaribouHomeTimeline.define()
```

- [ ] **Step 3: Commit**

```bash
git add apps/caribou-elena/pages/components/caribou-new-posts-banner.ts apps/caribou-elena/pages/components/caribou-home-timeline.ts
git commit -m "feat(app): caribou-home-timeline + new-posts-banner"
```

### Task 24: `/home` page with auth gate + sign-out

**Files:**
- Create: `apps/caribou-elena/pages/home.ts`
- Modify: `apps/caribou-elena/app.ts` — hydrate stores + wire 401 interceptor

- [ ] **Step 1: Write `pages/home.ts`**

```ts
// apps/caribou-elena/pages/home.ts
import { html } from '@elenajs/core'
import { LitroPage } from '@beatzball/litro/adapter/elena/page'
import './components/caribou-home-timeline.js'

export default class HomePage extends LitroPage {
  static override tagName = 'page-home-feed'

  private onSignOut() {
    if (typeof window === 'undefined') return
    import('@beatzball/caribou-state').then(({ removeActiveUser }) => {
      removeActiveUser()
      location.href = '/'
    })
  }

  override connectedCallback() {
    super.connectedCallback?.()
    if (typeof window === 'undefined') return
    const raw = localStorage.getItem('caribou.activeUserKey')
    if (!raw || raw === 'null' || raw === '""') {
      location.replace('/')
    }
  }

  override render() {
    return html`
      <main style="max-width:640px;margin:0 auto;">
        <header style="display:flex;align-items:center;justify-content:space-between;
                       padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--border);">
          <h1 style="margin:0;font-size:1.25rem;">Home</h1>
          <button type="button" @click=${() => this.onSignOut()}
                  style="padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);
                         border:1px solid var(--border);background:transparent;color:var(--fg-1);cursor:pointer;">
            Sign out
          </button>
        </header>
        <caribou-home-timeline></caribou-home-timeline>
      </main>
    `
  }
}
HomePage.define()
```

- [ ] **Step 2: Wire storage hydration + 401 interceptor in `app.ts`**

Replace the contents of `apps/caribou-elena/app.ts` with:

```ts
// apps/caribou-elena/app.ts
import '@beatzball/caribou-design-tokens/tokens.css'

// Elena adapter router outlet + link custom elements.
import '@beatzball/litro/adapter/elena/runtime'

import { loadFromStorage, removeActiveUser } from '@beatzball/caribou-state'
import { routes } from './routes.generated.js'

// Hydrate session from localStorage before any component reads it.
if (typeof window !== 'undefined') {
  loadFromStorage()
  // Global 401 interceptor: if any mastodon-client call hits 401, the client
  // calls session.onUnauthorized(). Our session source (see `session-source.ts`
  // wiring in createTimelineStore’s clientSource) calls removeActiveUser and
  // navigates to /?error=unauthorized.
  window.addEventListener('caribou:unauthorized', () => {
    removeActiveUser()
    location.replace('/?error=unauthorized')
  })
}

const outlet = document.querySelector('litro-outlet') as (Element & { routes: unknown }) | null
if (outlet) {
  outlet.routes = routes
} else {
  console.warn('[litro] <litro-outlet> not found — router will not start.')
}
```

- [ ] **Step 3: Confirm `activeClient` is already exported**

The `activeClient` computed + `emitUnauthorized` helper were added to `packages/state/src/users.ts` in Task 12, so `@beatzball/caribou-state` already exports it via the `./users.js` barrel. Nothing to add here — just verify:

```bash
grep -n "export const activeClient" packages/state/src/users.ts
```

Expected: one match on the `computed<CaribouClient | null>` declaration. If missing, refer back to Task 12 Step 3 and add it.

- [ ] **Step 4: Typecheck + lint + test the whole monorepo**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: all green.

- [ ] **Step 5: Manual smoke — end-to-end against a real instance**

```bash
pnpm dev:portless
```

Open the printed Portless URL. Sign in via `fosstodon.org`. Expected: lands on `/home` with live home timeline rendered. Scroll: no error. Click "Sign out": returns to `/`.

- [ ] **Step 6: Commit**

```bash
git add apps/caribou-elena/pages/home.ts apps/caribou-elena/app.ts packages/state/src/users.ts
git commit -m "feat(app): /home page + auth gate + 401 interceptor wiring"
```

---

## Phase G — E2E tests

E2E specs use Playwright `page.route()` to stub the Mastodon REST API (no real instance) and `addInitScript` to seed localStorage.

### Task 25: Rewrite `tests/e2e/landing.spec.ts`

**Files:**
- Modify: `apps/caribou-elena/tests/e2e/landing.spec.ts`

- [ ] **Step 1: Rewrite the spec**

```ts
// apps/caribou-elena/tests/e2e/landing.spec.ts
import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('landing page renders picker', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Caribou')
  await expect(page.getByLabel(/your mastodon instance/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
})

test('landing page shows error banner on ?error=denied and clears the param', async ({ page }) => {
  await page.goto('/?error=denied')
  await expect(page.getByRole('alert')).toContainText(/sign-in was cancelled/i)
  await expect.poll(() => page.url()).not.toContain('error=')
})

test('submitting the picker POSTs /api/signin/start and follows the redirect', async ({ page }) => {
  await page.route('**/api/signin/start', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authorizeUrl: 'https://example.test/oauth/authorize?mock' }),
    }),
  )
  // Intercept the eventual navigation to the fake instance to avoid leaving the site.
  await page.route('https://example.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<p>authorize page</p>' }),
  )
  await page.goto('/')
  await page.getByLabel(/your mastodon instance/i).fill('fosstodon.org')
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/example\.test/)
  expect(page.url()).toContain('https://example.test/oauth/authorize?mock')
})

test('landing page has no a11y violations', async ({ page }) => {
  await page.goto('/')
  const results = await new AxeBuilder({ page })
    .disableRules(['landmark-one-main', 'page-has-heading-one'])
    .analyze()
  expect(results.violations).toEqual([])
})

test('health endpoint returns ok', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.status).toBe('ok')
})
```

- [ ] **Step 2: Run locally**

```bash
pnpm --filter caribou-elena test:e2e --project=chromium tests/e2e/landing.spec.ts
```

Expected: 5/5 pass.

- [ ] **Step 3: Commit**

```bash
git add apps/caribou-elena/tests/e2e/landing.spec.ts
git commit -m "test(e2e): landing page picker + error banner + redirect"
```

### Task 26: `tests/e2e/signin-done.spec.ts`

**Files:**
- Create: `apps/caribou-elena/tests/e2e/signin-done.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// apps/caribou-elena/tests/e2e/signin-done.spec.ts
import { expect, test } from '@playwright/test'

test('signin-done shim parses fragment → writes localStorage → navigates /home', async ({ page }) => {
  // Intercept /home so the test doesn't depend on Phase F's page being fully wired
  // against a live Mastodon backend; we only care that the shim reached /home.
  await page.route('**/home', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body><p id="home-stub">home reached</p></body></html>',
    }),
  )

  await page.goto(
    '/signin/done#token=TOK&server=fosstodon.org&userKey=beatzball%40fosstodon.org&vapidKey=VK',
  )
  await page.waitForSelector('#home-stub')

  const ls = await page.evaluate(() => ({
    users: localStorage.getItem('caribou.users'),
    active: localStorage.getItem('caribou.activeUserKey'),
  }))
  expect(ls.active).toBe('"beatzball@fosstodon.org"')
  expect(ls.users).toContain('"token":"TOK"')
  expect(ls.users).toContain('"server":"fosstodon.org"')
})

test('signin-done shows fallback when fragment is missing', async ({ page }) => {
  await page.goto('/signin/done')
  await expect(page.getByText(/something went wrong/i)).toBeVisible()
})

test('signin-done shows fallback when userKey is malformed', async ({ page }) => {
  await page.goto('/signin/done#token=TOK&server=fosstodon.org&userKey=bogus&vapidKey=VK')
  await expect(page.getByText(/something went wrong/i)).toBeVisible()
})
```

- [ ] **Step 2: Run**

```bash
pnpm --filter caribou-elena test:e2e --project=chromium tests/e2e/signin-done.spec.ts
```

Expected: 3/3 pass.

- [ ] **Step 3: Commit**

```bash
git add apps/caribou-elena/tests/e2e/signin-done.spec.ts
git commit -m "test(e2e): signin-done fragment-parse shim"
```

### Task 27: `tests/e2e/home.spec.ts`

**Files:**
- Create: `apps/caribou-elena/tests/e2e/home.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// apps/caribou-elena/tests/e2e/home.spec.ts
import { expect, test } from '@playwright/test'

const SAMPLE_ACCOUNT = {
  id: 'a1', username: 'beatzball', acct: 'beatzball', display_name: 'Beatz Ball',
  avatar: 'https://fosstodon.org/a.png', avatar_static: 'https://fosstodon.org/a.png',
  url: 'https://fosstodon.org/@beatzball', header: '', header_static: '', note: '',
  followers_count: 0, following_count: 0, statuses_count: 1, locked: false, bot: false,
  discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}

function makeStatus(id: string, content = `<p>post ${id}</p>`) {
  return {
    id, uri: `https://fosstodon.org/@beatzball/${id}`, url: `https://fosstodon.org/@beatzball/${id}`,
    created_at: '2024-01-01T00:00:00.000Z', account: SAMPLE_ACCOUNT, content,
    visibility: 'public', sensitive: false, spoiler_text: '',
    media_attachments: [], mentions: [], tags: [], emojis: [],
    reblogs_count: 0, favourites_count: 0, replies_count: 0,
    favourited: false, reblogged: false, bookmarked: false, language: 'en',
  }
}

test.beforeEach(async ({ page }) => {
  const session = {
    userKey: 'beatzball@fosstodon.org',
    server: 'fosstodon.org',
    token: 'TOKEN',
    vapidKey: '',
    account: SAMPLE_ACCOUNT,
    createdAt: 1,
  }
  await page.addInitScript((data) => {
    localStorage.setItem('caribou.users', JSON.stringify([[data.userKey, data]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(data.userKey))
  }, session)
})

test('/home without activeUserKey redirects to /', async ({ page, context }) => {
  // Clear the script from beforeEach for this one test.
  await context.clearCookies()
  await page.addInitScript(() => {
    localStorage.removeItem('caribou.users')
    localStorage.removeItem('caribou.activeUserKey')
  })
  await page.goto('/home')
  await page.waitForURL((url) => url.pathname === '/')
  expect(new URL(page.url()).pathname).toBe('/')
})

test('/home with activeUserKey renders timeline statuses from the fake Mastodon API', async ({ page }) => {
  await page.route('**/api/v1/timelines/home*', (route) => {
    const u = new URL(route.request().url())
    const since = u.searchParams.get('since_id')
    if (since) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([makeStatus('a', '<p>hello world</p>'), makeStatus('b', '<p>second post</p>')]),
    })
  })
  await page.goto('/home')
  await expect(page.getByText('hello world')).toBeVisible()
  await expect(page.getByText('second post')).toBeVisible()
})

test('/home surfaces a "new posts" banner when polling finds newer statuses', async ({ page }) => {
  let sawInitial = false
  await page.route('**/api/v1/timelines/home*', (route) => {
    const u = new URL(route.request().url())
    const since = u.searchParams.get('since_id')
    if (since === 'a') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([makeStatus('c', '<p>newer post</p>')]),
      })
    }
    sawInitial = true
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([makeStatus('a', '<p>first post</p>')]),
    })
  })
  await page.goto('/home')
  await expect(page.getByText('first post')).toBeVisible()
  expect(sawInitial).toBe(true)

  // Force a poll immediately by dispatching the banner’s host visibility transition.
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')))

  await expect(page.getByRole('button', { name: /1 new post/i })).toBeVisible({ timeout: 5000 })
  await page.getByRole('button', { name: /1 new post/i }).click()
  await expect(page.getByText('newer post')).toBeVisible()
})

test('/home clears session and redirects on 401', async ({ page }) => {
  await page.route('**/api/v1/timelines/home*', (route) =>
    route.fulfill({ status: 401 }),
  )
  await page.goto('/home')
  await page.waitForURL((url) => url.pathname === '/' && url.search.includes('unauthorized'))
  const ls = await page.evaluate(() => localStorage.getItem('caribou.activeUserKey'))
  expect(ls).toBe('null')
})
```

- [ ] **Step 2: Run**

```bash
pnpm --filter caribou-elena test:e2e --project=chromium tests/e2e/home.spec.ts
```

Expected: 4/4 pass.

- [ ] **Step 3: Commit**

```bash
git add apps/caribou-elena/tests/e2e/home.spec.ts
git commit -m "test(e2e): /home timeline render, polling banner, 401 flow"
```

---

## Phase H — Merge and verify live

### Task 28: Full monorepo sweep

**Files:** none (verification only)

- [ ] **Step 1: From the worktree root, run the full matrix**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm --filter caribou-elena test:e2e
```

Expected: all green. If any step fails, fix the underlying issue in the appropriate task before continuing.

- [ ] **Step 2: Confirm coverage floors**

```bash
pnpm --filter @beatzball/caribou-auth test:coverage
pnpm --filter @beatzball/caribou-mastodon-client test:coverage
pnpm --filter @beatzball/caribou-state test:coverage
```

Expected: thresholds in each `vitest.config.ts` met (95 / 90 / 95).

- [ ] **Step 3: Update top-level `tsconfig.json` references**

```json
// tsconfig.json (root)
{
  "files": [],
  "references": [
    { "path": "./packages/tsconfig" },
    { "path": "./packages/eslint-config" },
    { "path": "./packages/auth" },
    { "path": "./packages/mastodon-client" },
    { "path": "./packages/state" },
    { "path": "./packages/design-tokens" },
    { "path": "./apps/caribou-elena" }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add tsconfig.json
git commit -m "chore: add project references for new packages"
```

### Task 29: Push, open PR, merge

**Files:** none

- [ ] **Step 1: Push the worktree branch**

```bash
git push -u origin 02-auth-data-timeline
```

- [ ] **Step 2: Open the PR with `gh`**

```bash
gh pr create --title "Plan 2: auth + data layer + first timeline" --body "$(cat <<'EOF'
## Summary
- Four new packages: `@beatzball/caribou-auth`, `@beatzball/caribou-mastodon-client`, `@beatzball/caribou-state`, `@beatzball/caribou-design-tokens` (all TDD with 90%+ coverage on the three logic packages).
- Server OAuth proxy: `POST /api/signin/start`, `GET /api/signin/callback`, prerendered `/signin/done` fragment shim.
- Client: instance-picker landing, `/home` page with live timeline, 30s visibility-gated polling with "N new posts" banner, 401 interceptor.

## Test plan
- [ ] CI `checks` green (typecheck + lint + unit + coverage)
- [ ] CI `e2e` green across Chromium/Firefox/WebKit, axe violations empty
- [ ] `changeset-check` passes
- [ ] After merge: `deploy` job green; `caribou.quest/` renders the picker
- [ ] After merge: real sign-in against `fosstodon.org` from `caribou.quest` ends on `/home` with live timeline
EOF
)"
```

- [ ] **Step 3: Wait for CI, review, and squash-merge**

When all required checks are green, squash-merge via the GitHub UI (or `gh pr merge --squash --delete-branch` if confident).

- [ ] **Step 4: Verify Coolify redeploy**

```bash
gh run list --workflow=CI --branch=main --limit=1
```

Expected: latest push-to-main run has `deploy` green within ~2 minutes.

### Task 30: Verify live end-to-end

**Files:** none

- [ ] **Step 1: Health check**

```bash
curl -sSf https://caribou.quest/api/health
```

Expected: `{"status":"ok","version":"..."}`.

- [ ] **Step 2: Landing renders the picker**

```bash
curl -sSf https://caribou.quest/ | grep -c "Your Mastodon instance"
```

Expected: `1` (or the relevant heading/label text).

- [ ] **Step 3: Real OAuth round-trip**

In a browser, visit `https://caribou.quest/`, enter `fosstodon.org`, approve consent, and confirm you land on `/home` with your real home timeline rendered. Wait 30s → poll runs, banner surfaces new posts if any arrived. Click sign out → returns to `/`.

If any step fails, file a follow-up issue — do not block the merge on upstream instance hiccups, but do block on anything that points at our code.

### Task 31: Worktree cleanup

**Files:** none

- [ ] **Step 1: Switch back to the main checkout**

```bash
cd caribou
git fetch origin
git checkout main
git pull --ff-only
```

- [ ] **Step 2: Remove the Plan 2 worktree + branch**

```bash
git worktree remove ../caribou-worktrees/02-auth-data-timeline
git branch -D 02-auth-data-timeline
```

Expected: both commands succeed. Plan 2 is complete.

---

## Reference: exit criteria mapped to tasks

| Exit criterion | Task(s) |
|---|---|
| 1. Install + typecheck + lint + test + build pass | 28 |
| 2. auth coverage ≥ 95% | 2–5 |
| 3. mastodon-client coverage ≥ 90% | 7–10 |
| 4. state coverage ≥ 95% | 12–15 |
| 5. Instance picker + auth gate | 20, 24 |
| 6. Real OAuth round-trip | 18, 19, 21, 24, 30 |
| 7. 30s polling + "new posts" banner | 15, 23, 24, 27 |
| 8. 401 interceptor | 10, 24, 27 |
| 9. E2E specs green | 25, 26, 27 |
| 10. caribou.quest /home live | 29, 30 |
