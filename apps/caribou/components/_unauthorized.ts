import { removeSession, type UnauthorizedDetail } from '@beatzball/caribou-state'

/**
 * Handles `caribou:unauthorized`, which a client fires when its request gets
 * a 401. The event names that client's session; it is removed only while it
 * is still stored with the same token, and the user is sent to the landing
 * page only when it was the active session. A 401 for a session that was
 * replaced, or for another stored session, changes nothing on screen.
 */
export function installUnauthorizedHandler(target: EventTarget, redirect: () => void): void {
  // More than one timeline can be alive during a route swap, and each one
  // fires `caribou:unauthorized` when its fetch hits 401. The token check in
  // `removeSession` is what stops the second redirect: once the first event
  // removes the session, the others are 'stale'. The flag is a second guard,
  // for a session made active after a redirect started: a second
  // `location.replace` interrupts the first navigation, which Chromium
  // reports as `net::ERR_ABORTED`. It is set only when a redirect starts, so
  // an ignored stale 401 never blocks a later real one.
  let redirecting = false
  target.addEventListener('caribou:unauthorized', (event) => {
    const detail = (event as CustomEvent<UnauthorizedDetail | null>).detail
    if (!detail) return
    if (removeSession(detail.userKey, detail.token) !== 'active') return
    if (redirecting) return
    redirecting = true
    // Signal the error via sessionStorage instead of `?error=` on the
    // replace target. Firefox + webkit race the query param between
    // `location.replace` and navigation commit (firefox sometimes drops
    // it entirely; webkit observes the banner's post-load URL cleanup).
    // sessionStorage survives the same-tab navigation atomically and is
    // browser-agnostic.
    try { sessionStorage.setItem('caribou.error', 'unauthorized') } catch { /* ignore */ }
    redirect()
  })
}
