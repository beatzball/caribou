import { activeUser, loadFromStorage, switchAccount } from '@beatzball/caribou-state'
import type { UserKey } from '@beatzball/caribou-auth'

// Pages that show the same thing for whichever account is active: they read
// the active account (or none) when they load. Any other path names a post or
// a person on the old account's server, which the new server may not know.
// `/@me` is "my profile", whoever "me" is.
const NEUTRAL = new Set(['/home', '/notifications', '/bookmarks', '/local', '/public', '/about', '/privacy', '/@me'])

// Query parameters that hold a post id as a page cursor. Ids are per server,
// so they mean nothing on another one.
const CURSORS = ['max_id', 'min_id', 'since_id']

/**
 * Where to land after the active account changed while the reader was on
 * `path`. `path` may carry a query string; it is kept when the page is kept,
 * less the page cursors when `serverChanged`.
 */
export function pathAfterSwitch(path: string, serverChanged = false): string {
  const q = path.indexOf('?')
  const pathname = q < 0 ? path : path.slice(0, q)
  const kept = NEUTRAL.has(pathname) || pathname === '/blog' || pathname.startsWith('/blog/')
    // A fully qualified profile (`/@name@host`) is the same person from any
    // server. A post id (`/@name/<id>`) is not: ids are per server.
    || /^\/@[^/@]+@[^/@]+$/.test(pathname)
  if (!kept) return '/home'
  if (!serverChanged || q < 0) return path
  const params = new URLSearchParams(path.slice(q + 1))
  for (const name of CURSORS) params.delete(name)
  const rest = params.toString()
  return rest ? `${pathname}?${rest}` : pathname
}

// Kept pages whose SSR content comes from the instance cookie's server, not
// only the shell label. Landing on one with a stale cookie mixes two servers:
// SSR gives the old server's first page, then the client pages on with the
// new account's server. (`/@me`, `/home` and the other kept pages render on
// the client from the active account; `/@name@host` uses the path's host.)
function readsCookieServer(path: string): boolean {
  const pathname = path.split('?')[0]
  return pathname === '/local' || pathname === '/public'
}

export interface LandDeps {
  fetch?: typeof fetch
  replace?: (url: string) => void
  /** The path to keep, with its query string. Defaults to the current one. */
  path?: string
}

export interface LandRequest {
  /** The active account's server before this change. */
  from?: string | null
  /** Do not write the cookie or navigate before this settles (the sign-out POST). */
  after?: Promise<unknown>
  /** A 401 removed the active account. If none is left, `/` shows the banner. */
  expired?: boolean
}

async function setInstanceCookie(server: string, doFetch: typeof fetch): Promise<boolean> {
  try {
    const res = await doFetch('/api/instance', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ server }),
    })
    return res.ok
  } catch {
    return false
  }
}

// One landing per document. Sign-out, a 401 and a switch each change the
// state at once and then ask for a landing; while one runs, a new request
// only adds to it. The landing reads the active account when it writes the
// cookie and again before it navigates, so a change made while a cookie
// write was in flight is written too, and there is one navigation, built
// from the final state.
interface Landing {
  run: Promise<void> | null
  from: string | null
  expired: boolean
  gates: Set<Promise<unknown>>
  deps: LandDeps
}
let landing: Landing | null = null
let signingOut = false

async function settle(gates: Set<Promise<unknown>>): Promise<void> {
  // A gate can be added while we wait for the others.
  while (gates.size > 0) {
    const all = [...gates]
    await Promise.all(all)
    for (const g of all) gates.delete(g)
  }
}

async function drive(l: Landing): Promise<void> {
  const doFetch = l.deps.fetch ?? fetch
  const replace = l.deps.replace ?? ((url: string) => location.replace(url))
  let written: string | null = null
  let ok = true
  for (;;) {
    await settle(l.gates)
    const server = activeUser.value?.server
    if (!server || server === written) break
    ok = await setInstanceCookie(server, doFetch) || await setInstanceCookie(server, doFetch)
    written = server
  }
  // Nothing awaits from here on, so this is the final state.
  const session = activeUser.value
  if (!session) {
    if (l.expired) {
      // Signal the error via sessionStorage instead of `?error=` on the
      // replace target. Firefox + webkit race the query param between
      // `location.replace` and navigation commit. sessionStorage survives
      // the same-tab navigation atomically and is browser-agnostic.
      try { sessionStorage.setItem('caribou.error', 'unauthorized') } catch { /* ignore */ }
    }
    replace('/')
    return
  }
  let target = pathAfterSwitch(l.deps.path ?? location.pathname + location.search, session.server !== l.from)
  if (!ok) {
    // The account change is already saved, so the page still loads as this
    // account, but never on a page that renders from the cookie's server.
    console.warn(`[caribou] could not set the instance cookie to ${session.server}`)
    if (readsCookieServer(target)) target = '/home'
  }
  replace(target)
}

/**
 * Loads the page as the active account, after the caller changed the state.
 * The instance cookie is set to its server first (tried twice), so SSR of
 * /local, /public and profiles uses that server. With no active account it
 * lands on `/`. Every request in one document joins the first landing; the
 * `from` and `deps` of the first request are used. Resolves when the landing
 * has navigated.
 */
export function land(req: LandRequest = {}, deps: LandDeps = {}): Promise<void> {
  const l = landing ??= { run: null, from: req.from ?? null, expired: false, gates: new Set(), deps }
  if (req.expired) l.expired = true
  if (req.after) l.gates.add(req.after.then(() => {}, () => {}))
  return l.run ??= drive(l)
}

/**
 * Switches to the stored account `userKey`: saves it as active, points the
 * instance cookie at its server, and reloads. The owner chose a reload over a
 * live store reset; `switchAccount` in the state package is the part a live
 * switch would reuse. Returns false when there is no such account.
 */
export async function switchToAccount(userKey: UserKey, deps: LandDeps = {}): Promise<boolean> {
  const from = activeUser.value?.server ?? null
  if (!switchAccount(userKey)) return false
  await land({ from }, deps)
  return true
}

/**
 * One sign-out per document. The first call returns true; later ones return
 * false. A second sign-out while the first waits for the network (a double
 * click, a repeated Enter, or another mounted sign-out form) would sign out
 * of the survivor too.
 */
export function claimSignOut(): boolean {
  if (signingOut) return false
  signingOut = true
  return true
}

/** Forgets the landing and the sign-out. For a restored page, and for tests. */
export function resetLanding(): void {
  landing = null
  signingOut = false
}

/**
 * A page left with `location.replace` can come back from the back-forward
 * cache with its module state: a finished landing and sign-out would make
 * sign-out dead there, and the in-memory accounts may be older than storage,
 * so a later save would write them back. On such a restore, forget both and
 * read the accounts again.
 */
export function installRestoreHandler(target: EventTarget): void {
  target.addEventListener('pageshow', (event) => {
    if (!(event as PageTransitionEvent).persisted) return
    resetLanding()
    loadFromStorage()
  })
}
