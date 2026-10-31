import { activeUser, switchAccount, type UserSession } from '@beatzball/caribou-state'
import type { UserKey } from '@beatzball/caribou-auth'

// Pages that show the same thing for whichever account is active: they read
// the active account (or none) when they load. Any other path names a post or
// a person on the old account's server, which the new server may not know.
// `/@me` is "my profile", whoever "me" is.
const NEUTRAL = new Set(['/home', '/notifications', '/bookmarks', '/local', '/public', '/about', '/privacy', '/@me'])

/**
 * Where to land after the active account changed while the reader was on
 * `path`. `path` may carry a query string; it is kept when the page is kept.
 */
export function pathAfterSwitch(path: string): string {
  const q = path.indexOf('?')
  const pathname = q < 0 ? path : path.slice(0, q)
  if (NEUTRAL.has(pathname) || pathname === '/blog' || pathname.startsWith('/blog/')) return path
  // A fully qualified profile (`/@name@host`) is the same person from any
  // server. A post id (`/@name/<id>`) is not: ids are per server.
  if (/^\/@[^/@]+@[^/@]+$/.test(pathname)) return path
  return '/home'
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

/**
 * Loads the page as `session`. The instance cookie is set to its server
 * first, so SSR of /local, /public and profiles uses that server. With no
 * session it lands on `/`.
 *
 * When the cookie write fails (a rejected fetch or any non-2xx) it is tried
 * once more. If that fails too, the page still loads as `session`, because
 * the account change is already saved, but never on a page that renders from
 * the cookie's server: such a page goes to `/home` instead, where only the
 * shell's server label can be stale. A warning names the server.
 */
export async function landAs(session: Pick<UserSession, 'server'> | null, deps: LandDeps = {}): Promise<void> {
  const replace = deps.replace ?? ((url: string) => location.replace(url))
  if (!session) {
    replace('/')
    return
  }
  const doFetch = deps.fetch ?? fetch
  const ok = await setInstanceCookie(session.server, doFetch)
    || await setInstanceCookie(session.server, doFetch)
  let target = pathAfterSwitch(deps.path ?? location.pathname + location.search)
  if (!ok) {
    console.warn(`[caribou] could not set the instance cookie to ${session.server}`)
    if (readsCookieServer(target)) target = '/home'
  }
  replace(target)
}

/**
 * Switches to the stored account `userKey`: saves it as active, points the
 * instance cookie at its server, and reloads. The owner chose a reload over a
 * live store reset; `switchAccount` in the state package is the part a live
 * switch would reuse. Returns false when there is no such account.
 */
export async function switchToAccount(userKey: UserKey, deps: LandDeps = {}): Promise<boolean> {
  if (!switchAccount(userKey)) return false
  await landAs(activeUser.value, deps)
  return true
}
