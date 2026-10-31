import { activeUser, activeUserKey, loadFromStorage, switchAccount } from '@beatzball/caribou-state'
import type { UserKey } from '@beatzball/caribou-auth'
import type { ShellInfo } from '../server/lib/page-data-types.js'

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

// One landing at a time. Sign-out, a 401 and a switch each change the state
// at once and then ask for a landing; while one runs, a new request only adds
// to it. The landing reads the active account when it writes the cookie and
// again before it navigates, so a change made while a cookie write was in
// flight is written too, and there is one navigation, built from the final
// state.
//
// `replace()` only asks for a navigation. The old document stays until the
// new one commits (one SSR round trip), and stays for good when the reader
// stops the load. A request in that window that follows a real state change
// (a sign-out, a 401 for the account it landed as) starts a fresh landing,
// which writes the cookie for the new state and navigates again; the second
// navigation wins. A request with no state change since then (a repeat 401
// already dropped by the token check, a repeat call) joins the finished one
// and does nothing.
interface Landing {
  run: Promise<void> | null
  from: string | null
  expired: boolean
  gates: Set<Promise<unknown>>
  deps: LandDeps
  /** The active key when this landing navigated; undefined before that. */
  navigatedAs?: string | null
}
let landing: Landing | null = null
let signingOut = false
// The start-up cookie repair while its POST is in flight. A landing waits for
// it before its first cookie write, so the landing's write is the last one.
// The wait is bounded: a repair that hangs must not hold a sign-out.
let healing: Promise<unknown> | null = null
const HEAL_WAIT_MS = 5000

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
  // After every await: stop when this landing is no longer the current one.
  // `resetLanding` (a page restored from the back-forward cache) drops it,
  // and the restore handler starts a new landing for the state it reads
  // again; this one must not write a cookie or navigate after that.
  const owned = () => landing === l
  let written: string | null = null
  let ok = true
  for (;;) {
    await settle(l.gates)
    if (!owned()) return
    const server = activeUser.value?.server
    if (!server || server === written) break
    ok = await setInstanceCookie(server, doFetch)
    if (!owned()) return
    if (!ok) {
      ok = await setInstanceCookie(server, doFetch)
      if (!owned()) return
    }
    written = server
  }
  // Nothing awaits from here on, so this is the final state.
  const session = activeUser.value
  l.navigatedAs = activeUserKey.value
  // The document is leaving, but until the new one commits its rail still
  // shows the old account. A Sign out click there would act on the account
  // this landing chose, which the reader never saw, so it does nothing.
  signingOut = true
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
 * lands on `/`. A request while a landing runs joins it; the `from` and
 * `deps` of the first request are used. After the landing navigated, a
 * request that follows a state change starts a fresh landing; any other
 * request joins the finished one. Resolves when the landing has navigated.
 */
export function land(req: LandRequest = {}, deps: LandDeps = {}): Promise<void> {
  if (landing?.navigatedAs !== undefined && landing.navigatedAs !== activeUserKey.value) {
    landing = null
  }
  const l = landing ??= { run: null, from: req.from ?? null, expired: false, gates: new Set(), deps }
  if (req.expired) l.expired = true
  if (req.after) l.gates.add(req.after.then(() => {}, () => {}))
  if (healing) l.gates.add(healing)
  return l.run ??= drive(l)
}

/** The shell info of the page data SSR put in the document, if any. */
export function readShellInfo(doc: Document): ShellInfo | null {
  const text = doc.getElementById('__litro_data__')?.textContent
  if (!text) return null
  try {
    const shell = (JSON.parse(text) as { shell?: ShellInfo } | null)?.shell
    return shell && typeof shell === 'object' ? shell : null
  } catch {
    return null
  }
}

/**
 * At app start: when this page's server took its instance from the cookie
 * and that names another server than the active account's, point the cookie
 * at the active account's server, once. A landing whose two cookie writes
 * failed, or a cookie changed in another tab, leaves it stale, and the next
 * full load of /local or /public would show the old server. This page is not
 * reloaded; the next full load uses the healed cookie. Nothing happens while
 * a landing runs, since the landing writes the cookie itself. A landing that
 * starts while this POST is in flight waits for it, so the landing's cookie
 * write comes after it. Resolves true when it wrote the cookie.
 */
export async function healInstanceCookie(
  shell: ShellInfo | null,
  deps: { fetch?: typeof fetch } = {},
): Promise<boolean> {
  const session = activeUser.value
  if (!session || landing || shell?.source !== 'cookie' || !shell.instance) return false
  if (shell.instance.toLowerCase() === session.server.toLowerCase()) return false
  const post = setInstanceCookie(session.server, deps.fetch ?? fetch)
  const gate = Promise.race([post, new Promise((r) => setTimeout(r, HEAL_WAIT_MS))])
  healing = gate
  try {
    return await post
  } finally {
    if (healing === gate) healing = null
  }
}

/**
 * Switches to the stored account `userKey`: saves it as active, points the
 * instance cookie at its server, and reloads. The owner chose a reload over a
 * live store reset; `switchAccount` in the state package is the part a live
 * switch would reuse. Returns false when there is no such account, and when
 * a transition already runs.
 *
 * One transition per document. While a landing runs (a sign-out, a 401, an
 * earlier switch) or after it navigated, the active account may already be
 * one the reader did not choose, and the document is about to leave; a switch
 * then does nothing. A switch also claims sign-out: a Sign out click while
 * its cookie write is pending would sign out of the account just switched to,
 * which the page has not loaded yet.
 */
export async function switchToAccount(userKey: UserKey, deps: LandDeps = {}): Promise<boolean> {
  if (landing || signingOut) return false
  const from = activeUser.value?.server ?? null
  if (!switchAccount(userKey)) return false
  signingOut = true
  await land({ from }, deps)
  return true
}

/**
 * One sign-out per document. The first call returns true; later ones return
 * false. A second sign-out while the first waits for the network (a double
 * click, a repeated Enter, or another mounted sign-out form) would sign out
 * of the survivor too.
 *
 * Any landing that navigated (sign-out, 401 or switch) claims it too. Until
 * the new document commits, the old one still shows the account it had, so
 * a Sign out click there means that account, which is gone already; acting
 * on it would sign out of the account the landing chose. A 401 for that
 * account still starts a new landing (see `land`).
 */
export function claimSignOut(): boolean {
  if (signingOut) return false
  signingOut = true
  return true
}

/**
 * Forgets the landing and the sign-out. For a restored page, and for tests.
 * A running landing stops at its next await (see `drive`). Returns what it
 * needs to start again: its request when it had not navigated, else null.
 */
export function resetLanding(): LandRequest | null {
  const l = landing
  landing = null
  signingOut = false
  healing = null
  if (!l || l.navigatedAs !== undefined) return null
  return { from: l.from, expired: l.expired }
}

/**
 * A page left with `location.replace` can come back from the back-forward
 * cache with its module state: a finished landing and sign-out would make
 * sign-out dead there, and the in-memory accounts may be older than storage,
 * so a later save would write them back. On such a restore, forget both and
 * read the accounts again. A landing that was still running is stopped and
 * started again for the state just read, without its gates (a request from
 * before the restore may never settle).
 */
export function installRestoreHandler(target: EventTarget, deps: LandDeps = {}): void {
  target.addEventListener('pageshow', (event) => {
    if (!(event as PageTransitionEvent).persisted) return
    const unfinished = resetLanding()
    loadFromStorage()
    if (unfinished) void land(unfinished, deps)
  })
}
