// `/` goes to `/home` when an account is active (issue 135).
//
// Two checks share these rules. The inline script in the head of `/`
// (`server/lib/root-forward-head.ts`) runs on a full page load, before the
// first paint. This one runs when the router enters `/` (`pages/index.ts`):
// a client-side navigation, or a full load the head script did not forward.
// The tests run both on one table of cases, so they must agree.
//
// `/` stays for `/?add` (add an account), for a sign-in error (the reader
// must see the banner), and with no active account. Blocked storage or bad
// JSON means no account: `/` stays the sign-in page.

/** The attribute the head script puts on `<html>` while it forwards. */
export const FORWARD_ATTR = 'data-caribou-forward'

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
    // The same test as `isUserKey` in the auth package: `name@server`.
    if (typeof key !== 'string' || key.split('@').length !== 2 || !Array.isArray(users)) return false
    return users.some((entry) => Array.isArray(entry) && entry[0] === key)
  } catch {
    return false
  }
}

/**
 * Replaces `/` with `/home` in the router: no history entry for `/`, so Back
 * does not return to it. The router reads the synthetic popstate as a
 * navigation and drops the `/` render it was making.
 */
export function replaceWithHome(): void {
  history.replaceState(null, '', '/home')
  window.dispatchEvent(new PopStateEvent('popstate'))
}
