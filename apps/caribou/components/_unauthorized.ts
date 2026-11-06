import {
  markExpired, nextAccountKey, removeSession, switchAccount, users,
  type SessionExpiredDetail, type UnauthorizedDetail,
} from '@beatzball/caribou-state'
import type { LandRequest } from './_switch-account.js'

// The two failure events and what each may do follow the session rules in
// `packages/state/README.md`. Both name the sign-in (`generation`) of the
// client that saw the failure, and both change nothing when the stored
// session has another one.

/**
 * Handles `caribou:unauthorized`, which a Mastodon client fires when its
 * request gets a 401. The event names that client's session; it is removed
 * only while it is still stored with the same generation. Its prefs and
 * drafts stay. When it was the active session, the next stored account
 * becomes active (as sign-out picks it) and `land` is asked to load the page
 * as it; with none left the landing goes to `/` with the "signed out" banner.
 * A 401 for a session that was replaced, or for another stored session,
 * changes nothing on screen.
 *
 * The state change always happens at once, even while a landing is already
 * running: `land` joins that landing, which reads the final state before it
 * writes the cookie and navigates (`_switch-account.ts`). So a second 401
 * during a landing still picks the next account, and there is one navigation.
 */
export function installUnauthorizedHandler(
  target: EventTarget,
  land: (req: LandRequest) => void,
): void {
  target.addEventListener('caribou:unauthorized', (event) => {
    const detail = (event as CustomEvent<UnauthorizedDetail | null>).detail
    if (!detail) return
    const order = Array.from(users.value.keys())
    const from = users.value.get(detail.userKey)?.server ?? null
    if (removeSession(detail.userKey, detail.generation) !== 'active') return
    const nextKey = nextAccountKey(order, detail.userKey)
    const switched = nextKey !== null && switchAccount(nextKey)
    land({ from, expired: !switched })
  })
}

/**
 * Handles `caribou:session-expired`, which a client fires when the network
 * says its credentials are gone. The session is marked `expired` while it
 * still has the same generation. Nothing else changes: the session, its prefs
 * and drafts, the active account and the page all stay, and nothing
 * navigates. A new sign-in clears it.
 */
export function installSessionExpiredHandler(target: EventTarget): void {
  target.addEventListener('caribou:session-expired', (event) => {
    const detail = (event as CustomEvent<SessionExpiredDetail | null>).detail
    if (!detail) return
    markExpired(detail.userKey, detail.generation)
  })
}
