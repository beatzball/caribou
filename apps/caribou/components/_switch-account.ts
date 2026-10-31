import { activeUser, switchAccount, type UserSession } from '@beatzball/caribou-state'
import type { UserKey } from '@beatzball/caribou-auth'

// Pages that show the same thing for whichever account is active: they read
// the active account (or none) when they load. Any other path names a post or
// a person on the old account's server, which the new server may not know.
const NEUTRAL = new Set(['/home', '/notifications', '/bookmarks', '/local', '/public', '/about', '/privacy'])

/** Where to land after the active account changed while the reader was on `path`. */
export function pathAfterSwitch(path: string): string {
  if (NEUTRAL.has(path) || path === '/blog' || path.startsWith('/blog/')) return path
  // A fully qualified profile (`/@name@host`) is the same person from any
  // server. A post id (`/@name/<id>`) is not: ids are per server.
  if (/^\/@[^/@]+@[^/@]+$/.test(path)) return path
  return '/home'
}

export interface LandDeps {
  fetch?: typeof fetch
  replace?: (url: string) => void
  path?: string
}

/**
 * Loads the page as `session`. The instance cookie is set to its server
 * first, so SSR of /local, /public and profiles uses that server; a failed
 * cookie write still loads the page (the client reads the active account
 * from storage). With no session it lands on `/`.
 */
export async function landAs(session: Pick<UserSession, 'server'> | null, deps: LandDeps = {}): Promise<void> {
  const replace = deps.replace ?? ((url: string) => location.replace(url))
  if (!session) {
    replace('/')
    return
  }
  const doFetch = deps.fetch ?? fetch
  await doFetch('/api/instance', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ server: session.server }),
  }).catch(() => {})
  replace(pathAfterSwitch(deps.path ?? location.pathname))
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
