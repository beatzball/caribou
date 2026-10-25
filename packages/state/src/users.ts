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

function emitUnauthorized(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('caribou:unauthorized'))
  }
}

export const activeClient = computed<CaribouClient | null>(() => {
  const user = activeUser.value
  if (!user) return null
  const source: SessionSource = {
    get: () => ({ userKey: user.userKey, server: user.server, token: user.token }),
    onUnauthorized: emitUnauthorized,
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
  const current = users.value.get(user.userKey)
  if (!current || current.account) return
  const next = new Map(users.value)
  next.set(user.userKey, { ...current, account })
  users.value = next
  saveToStorage()
}

export function removeActiveUser(): void {
  const key = activeUserKey.value
  if (!key) return
  const next = new Map(users.value)
  next.delete(key)
  users.value = next
  activeUserKey.value = null
  localStorage.removeItem(`caribou.prefs.${key}`)
  localStorage.removeItem(`caribou.drafts.${key}`)
  saveToStorage()
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
      for (const [k, v] of entries) if (isUserKey(k)) map.set(k, v)
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
