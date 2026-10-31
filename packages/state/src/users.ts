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
  // Null until it is loaded: sign-in stores the session before the app has
  // the account (`server/routes/signin/done.get.ts`). `loadActiveAccount`
  // fills it in. Code that needs the user's handle uses `userName()`.
  account: mastodon.v1.Account | null
  createdAt: number
}

export const users = signal<Map<UserKey, UserSession>>(new Map())
export const activeUserKey = signal<UserKey | null>(null)

export const activeUser = computed<UserSession | null>(() => {
  const key = activeUserKey.value
  return key ? users.value.get(key) ?? null : null
})

/** Detail of `caribou:unauthorized`: the session whose request got the 401. */
export interface UnauthorizedDetail {
  userKey: UserKey
  token: string
}

// The detail names the client's own session, not the active one: a request
// started before a switch or a re-sign-in can return 401 after it.
function emitUnauthorized(detail: UnauthorizedDetail): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<UnauthorizedDetail>('caribou:unauthorized', { detail }))
  }
}

export const activeClient = computed<CaribouClient | null>(() => {
  const user = activeUser.value
  if (!user) return null
  const source: SessionSource = {
    get: () => ({ userKey: user.userKey, server: user.server, token: user.token }),
    onUnauthorized: () => { emitUnauthorized({ userKey: user.userKey, token: user.token }) },
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

/** The user's own handle on their server, with or without the account. */
export function userName(user: Pick<UserSession, 'userKey' | 'account'>): string {
  return user.account?.acct ?? user.userKey.slice(0, user.userKey.lastIndexOf('@'))
}

/**
 * Whether `account`, as the user's own server returns it, is the user. Without
 * the stored account it compares handles: a local account's `acct` is its
 * bare username.
 */
export function isOwnAccount(
  user: Pick<UserSession, 'userKey' | 'account'>, account: Pick<mastodon.v1.Account, 'id' | 'acct'>,
): boolean {
  return user.account ? user.account.id === account.id : account.acct === userName(user)
}

/**
 * Loads the active user's account when the session has none yet, and stores
 * it. A failure leaves `account` null; every reader copes with that.
 */
export async function loadActiveAccount(): Promise<void> {
  const user = activeUser.value
  const client = activeClient.value
  if (!user || !client || user.account) return
  let account: mastodon.v1.Account
  try {
    account = await client.verifyCredentials()
  } catch {
    return
  }
  // Store it only on the session that asked: after a sign-out and a new
  // sign-in under the same key, the entry is a new session with a new token.
  const current = users.value.get(user.userKey)
  if (!current || current.account || current.token !== user.token) return
  const next = new Map(users.value)
  next.set(user.userKey, { ...current, account })
  users.value = next
  saveToStorage()
}

// Drops a session and the local data kept for it. It does not touch
// `activeUserKey`; the caller decides what is active next.
function dropSession(key: UserKey): void {
  const next = new Map(users.value)
  next.delete(key)
  users.value = next
  localStorage.removeItem(`caribou.prefs.${key}`)
  localStorage.removeItem(`caribou.drafts.${key}`)
}

export function removeActiveUser(): void {
  const key = activeUserKey.value
  if (!key) return
  dropSession(key)
  activeUserKey.value = null
  saveToStorage()
}

/**
 * Makes `userKey` the active account and saves it. This is the state part of
 * a switch only: the app then sets the instance cookie and reloads the page
 * (`apps/caribou/components/_switch-account.ts`), so nothing here resets the
 * stores. Returns false, and changes nothing, when there is no such session.
 *
 * A live switch (no reload) can be built on this later: `ownerGeneration()`
 * already changes with the active key, so keep-alive caches and in-flight
 * results drop themselves.
 */
export function switchAccount(userKey: UserKey): boolean {
  if (!users.value.has(userKey)) return false
  activeUserKey.value = userKey
  saveToStorage()
  return true
}

/**
 * Signs out of the active account only. The account after it in the list
 * becomes active, or the first one when it was the last; with no account left
 * nothing is active. Returns the new active session, or null.
 */
export function signOutActive(): UserSession | null {
  const key = activeUserKey.value
  if (!key) return null
  const keys = Array.from(users.value.keys())
  const at = keys.indexOf(key)
  dropSession(key)
  const rest = keys.filter((k) => k !== key)
  const nextKey = rest.length === 0 ? null : rest[at < 0 ? 0 : at % rest.length]!
  activeUserKey.value = nextKey
  saveToStorage()
  return nextKey ? users.value.get(nextKey) ?? null : null
}

/**
 * Removes the session `userKey` only if it still has `token`; a 401 from an
 * older token must not remove the session that replaced it. Returns whether
 * the removed session was the active one, or `'stale'` when nothing changed.
 */
export function removeSession(userKey: UserKey, token: string): 'active' | 'inactive' | 'stale' {
  const current = users.value.get(userKey)
  if (!current || current.token !== token) return 'stale'
  dropSession(userKey)
  const wasActive = activeUserKey.value === userKey
  if (wasActive) activeUserKey.value = null
  saveToStorage()
  return wasActive ? 'active' : 'inactive'
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
      // Older entries can lack `userKey`; the 401 event needs it to find the
      // session again, so take it from the map key.
      for (const [k, v] of entries) if (isUserKey(k)) map.set(k, v.userKey ? v : { ...v, userKey: k })
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
