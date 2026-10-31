import {
  nextAccountKey, removeSession, switchAccount, users, type UnauthorizedDetail,
} from '@beatzball/caribou-state'
import type { LandRequest } from './_switch-account.js'

/**
 * Handles `caribou:unauthorized`, which a client fires when its request gets
 * a 401. The event names that client's session; it is removed only while it
 * is still stored with the same token. When it was the active session, the
 * next stored account becomes active (as sign-out picks it) and `land` is
 * asked to load the page as it; with none left the landing goes to `/` with
 * the "signed out" banner. A 401 for a session that was replaced, or for
 * another stored session, changes nothing on screen.
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
    if (removeSession(detail.userKey, detail.token) !== 'active') return
    const nextKey = nextAccountKey(order, detail.userKey)
    const switched = nextKey !== null && switchAccount(nextKey)
    land({ from, expired: !switched })
  })
}
