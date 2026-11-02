// `/` goes to `/home` when an account is active (issue 135).
//
// Two checks share these rules. The inline script in the head of `/`
// (`server/lib/root-forward-head.ts`) decides on a full page load, before the
// first paint. This one decides when the router enters `/` by a client-side
// navigation (`pages/index.ts`). The tests run both on one table of cases,
// so they must agree.
//
// `/` stays for `/?add` (add an account), for a sign-in error (the reader
// must see the banner), and with no active account. Blocked storage or bad
// JSON means no account: `/` stays the sign-in page.

/**
 * The head script puts this on `<html>` when it kept the reader on `/`. The
 * full load is then decided; the router must not check again.
 */
export const DECIDED_ATTR = 'data-caribou-root'

export function forwardsToHome(
  search: string,
  local: Pick<Storage, 'getItem'>,
  session: Pick<Storage, 'getItem'>,
): boolean {
  try {
    const q = new URLSearchParams(search)
    if (q.has('add') || q.has('error') || session.getItem('caribou.error')) return false
    const key: unknown = JSON.parse(local.getItem('caribou.activeUserKey') ?? 'null')
    const users: unknown = JSON.parse(local.getItem('caribou.users') ?? '[]')
    if (typeof key !== 'string' || !Array.isArray(users)) return false
    // The same test as `isUserKey` in the auth package: `name@server`, both
    // parts non-empty. `loadFromStorage` drops any other key.
    const [name, server, ...rest] = key.split('@')
    if (!name || !server || rest.length > 0) return false
    return users.some((entry) => Array.isArray(entry) && entry[0] === key)
  } catch {
    return false
  }
}

/**
 * Replaces `/` with `/home` in the router: no history entry for `/`, so Back
 * does not return to it. The router reads the synthetic popstate as a
 * navigation and drops the `/` render it was making.
 *
 * Two known limits. A link to `/` from `/home` leaves two `/home` entries, so
 * one Back press seems to do nothing; no signed-in page links to `/` today.
 * The router has no replace navigation, so it treats this as Back/Forward
 * and restores the saved scroll offset of `/home` instead of the top.
 */
export function replaceWithHome(): void {
  // The SSR data of the first page is read once, by the first page the
  // router enters. If any is left, it is not `/home`'s: Home must not read it.
  document.getElementById('__litro_data__')?.remove()
  history.replaceState(null, '', '/home')
  window.dispatchEvent(new PopStateEvent('popstate'))
}
