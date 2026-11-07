import { batch, computed, signal } from '@preact/signals-core'
import { isUserKey, type UserKey } from '@beatzball/caribou-auth'
import {
  createCaribouClient,
  type CaribouClient, type SessionSource,
  type Account,
} from '@beatzball/caribou-mastodon-client'
import { prefsKey } from './prefs.js'
import { blueskyDriver, deferredBlueskyClient, isBlueskySession } from './bluesky-session.js'

// The rules for `generation` and `expired`, and for what a failure may do to
// a session, are in this package's README ("Session rules"). The numbers in
// the comments below name them.
interface SessionBase {
  userKey: UserKey
  // A random id made at each sign-in (rule 1). It names the sign-in, not the
  // token; every failure event carries it (rule 2).
  generation: string
  // Null until it is loaded: sign-in stores the session before the app has
  // the account (`server/lib/signin-complete-page.ts`). `loadActiveAccount`
  // fills it in. Code that needs the user's handle uses `userName()`.
  account: Account | null
  createdAt: number
  // Set when the network says the credentials are gone (rule 3). The session
  // stays, with its prefs and drafts. Only a new sign-in clears it.
  expired?: true
}

export interface MastodonSession extends SessionBase {
  // Absent on Mastodon entries, also on those stored before Bluesky.
  network?: 'mastodon'
  server: string
  token: string
  vapidKey: string
}

/** A Bluesky sign-in (rules 8 to 12). The SDK keeps its tokens in IndexedDB under the DID. */
export interface BlueskySession extends SessionBase {
  network: 'bluesky'
  did: string
  // For display; refreshed from `getProfile`.
  handle: string
  // From the DID document; it can change.
  pds: string
  // A Bluesky session has none of these. They are here so code that reads
  // them from any session gets `undefined` and not a type error.
  server?: undefined
  token?: undefined
  vapidKey?: undefined
}

export type UserSession = MastodonSession | BlueskySession

type New<S extends SessionBase> = Omit<S, 'generation' | 'expired'> & { generation?: string }

/** A session as a sign-in hands it over: its `generation` is made if absent. */
export type NewUserSession = New<MastodonSession> | New<BlueskySession>

/** A new sign-in id: 128 random bits as hex. */
export function newGeneration(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export const users = signal<Map<UserKey, UserSession>>(new Map())
export const activeUserKey = signal<UserKey | null>(null)

export const activeUser = computed<UserSession | null>(() => {
  const key = activeUserKey.value
  return key ? users.value.get(key) ?? null : null
})

/**
 * Detail of `caribou:unauthorized` (a Mastodon 401, rule 4) and of
 * `caribou:session-expired` (credentials gone, rule 3): the sign-in of the
 * client that saw it.
 */
export interface SessionFailureDetail {
  userKey: UserKey
  generation: string
}
export type UnauthorizedDetail = SessionFailureDetail
export type SessionExpiredDetail = SessionFailureDetail

// The detail names the client's own session, not the active one: a request
// started before a switch or a re-sign-in can fail after it.
function emit(type: string, detail: SessionFailureDetail): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<SessionFailureDetail>(type, { detail }))
  }
}

/** What a client sends when the network says its credentials are gone (rule 3). */
export function emitSessionExpired(detail: SessionExpiredDetail): void {
  emit('caribou:session-expired', detail)
}

export const activeClient = computed<CaribouClient | null>(() => {
  const user = activeUser.value
  if (!user) return null
  if (isBlueskySession(user)) {
    // Rule 8: made at once; it restores the OAuth session on first use.
    return deferredBlueskyClient(user, () => {
      emit('caribou:session-expired', { userKey: user.userKey, generation: user.generation })
    })
  }
  const source: SessionSource = {
    get: () => ({ userKey: user.userKey, server: user.server, token: user.token }),
    onUnauthorized: () => { emit('caribou:unauthorized', { userKey: user.userKey, generation: user.generation }) },
  }
  return createCaribouClient(user.userKey, source)
})

/** A sign-in (rule 1): it replaces any entry under the key, without `expired`. */
export function addUserSession(session: NewUserSession): void {
  const { expired: _, ...rest } = session as NewUserSession & { expired?: true }
  const next = new Map(users.value)
  next.set(session.userKey, { ...rest, generation: session.generation ?? newGeneration() })
  users.value = next
  activeUserKey.value = session.userKey
  saveToStorage()
}

/** The user's own handle on their server, with or without the account. */
export function userName(user: Pick<UserSession, 'userKey' | 'account'> & { network?: string; handle?: string }): string {
  if (user.network === 'bluesky' && user.handle) return user.handle
  return user.account?.acct ?? user.userKey.slice(0, user.userKey.lastIndexOf('@'))
}

/**
 * Whether `account`, as the user's own server returns it, is the user. Without
 * the stored account it compares handles: a local account's `acct` is its
 * bare username.
 */
export function isOwnAccount(
  user: Pick<UserSession, 'userKey' | 'account'>, account: Pick<Account, 'id' | 'acct'>,
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
  let account: Account
  try {
    account = await client.verifyCredentials()
  } catch {
    return
  }
  // Store it only on the sign-in that asked (rule 7): after a sign-out and a
  // new sign-in under the same key, the entry has a new generation.
  const current = users.value.get(user.userKey)
  if (!current || current.account || current.generation !== user.generation) return
  const next = new Map(users.value)
  next.set(user.userKey, { ...current, account })
  users.value = next
  saveToStorage()
}

// Drops a session and the local data kept for it (rule 6: sign-out only). It
// does not touch `activeUserKey`; the caller decides what is active next.
function dropSession(key: UserKey): void {
  const next = new Map(users.value)
  next.delete(key)
  users.value = next
  localStorage.removeItem(prefsKey(key))
  localStorage.removeItem(`caribou.drafts.${key}`)
}

/**
 * Signs out of a Bluesky account (rule 12): revokes at the PDS, then drops
 * the entry, its prefs and drafts while it still has `generation`. When it
 * was active, the next account becomes active, as `signOutActive` picks it.
 * Returns the active session after it, or null.
 */
export async function signOutBluesky(userKey: UserKey, generation: string): Promise<UserSession | null> {
  const entry = users.value.get(userKey)
  if (entry && isBlueskySession(entry) && entry.generation === generation) {
    try {
      await blueskyDriver()?.signOut(entry.did)
    } catch {
      // Offline or refused: the reader asked to sign out, so the entry goes.
    }
  }
  const current = users.value.get(userKey)
  if (current?.generation === generation) {
    const wasActive = activeUserKey.value === userKey
    const nextKey = wasActive ? nextAccountKey(Array.from(users.value.keys()), userKey) : activeUserKey.value
    dropSession(userKey)
    activeUserKey.value = nextKey
    saveToStorage()
  }
  return activeUser.value
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
 * The account that follows `removed` in `keys` (the list before removal):
 * the next one, or the first one when `removed` was the last. Null when no
 * other account is in the list.
 */
export function nextAccountKey(keys: readonly UserKey[], removed: UserKey): UserKey | null {
  const at = keys.indexOf(removed)
  const rest = keys.filter((k) => k !== removed)
  if (rest.length === 0) return null
  return rest[at < 0 ? 0 : at % rest.length]!
}

/**
 * Signs out of the active account only. The account after it in the list
 * becomes active, or the first one when it was the last; with no account left
 * nothing is active. Returns the new active session, or null.
 */
export function signOutActive(): UserSession | null {
  const key = activeUserKey.value
  if (!key) return null
  const nextKey = nextAccountKey(Array.from(users.value.keys()), key)
  dropSession(key)
  activeUserKey.value = nextKey
  saveToStorage()
  return nextKey ? users.value.get(nextKey) ?? null : null
}

/**
 * A Mastodon 401 (rule 4). Removes the session `userKey` only while the
 * stored entry, and this tab's, have `generation` (rule 2): a 401 from an
 * earlier sign-in, here or in another tab, must not remove a later one. Its
 * prefs and drafts stay, for the next sign-in. Returns whether the removed
 * session was the active one here, or `'stale'` when nothing changed.
 */
export function removeSession(userKey: UserKey, generation: string): 'active' | 'inactive' | 'stale' {
  const stored = matchingStored(userKey, generation)
  if (!stored) return 'stale'
  stored.delete(userKey)
  const wasActive = activeUserKey.value === userKey
  writeStored(stored)
  if (readStoredActive() === userKey) localStorage.setItem(K_ACTIVE, JSON.stringify(null))
  batch(() => {
    adoptStored(stored)
    if (wasActive) activeUserKey.value = null
  })
  return wasActive ? 'active' : 'inactive'
}

/**
 * Credentials gone (rule 3). Marks the session `userKey` expired only while
 * the stored entry, and this tab's, have `generation` (rule 2). The session,
 * its prefs, its drafts and the active account all stay. Returns `'stale'`
 * when nothing matched.
 */
export function markExpired(userKey: UserKey, generation: string): 'marked' | 'stale' {
  const stored = matchingStored(userKey, generation)
  if (!stored) return 'stale'
  const entry = stored.get(userKey)!
  if (!entry.expired) {
    stored.set(userKey, { ...entry, expired: true })
    writeStored(stored)
  }
  adoptStored(stored)
  return 'marked'
}

// Rule 2: the stored accounts, read fresh, when both the stored entry for
// `userKey` and this tab's have `generation`; else null (stale). Another tab
// may have signed in again, signed out or added an account since this tab
// last read storage.
function matchingStored(userKey: UserKey, generation: string): Map<UserKey, UserSession> | null {
  if (users.value.get(userKey)?.generation !== generation) return null
  const stored = readStoredUsers()
  return stored?.get(userKey)?.generation === generation ? stored : null
}

function writeStored(map: Map<UserKey, UserSession>): void {
  localStorage.setItem(K_USERS, JSON.stringify(Array.from(map.entries())))
}

// This tab's accounts become the stored ones. An entry that did not change
// keeps its object, so the active client is not made again for nothing.
// When another tab signed out of the account active here, the active key
// follows storage: the stored active key when it is in the map, else null.
function adoptStored(stored: Map<UserKey, UserSession>): void {
  const before = users.value
  const next = new Map<UserKey, UserSession>()
  for (const [k, v] of stored) {
    const had = before.get(k)
    next.set(k, had && JSON.stringify(had) === JSON.stringify(v) ? had : v)
  }
  const same = next.size === before.size && [...next].every(([k, v]) => before.get(k) === v)
  if (!same) users.value = next
  const active = activeUserKey.value
  if (active && !next.has(active)) {
    const storedActive = readStoredActive()
    activeUserKey.value = storedActive && next.has(storedActive) ? storedActive : null
  }
}

const K_USERS = 'caribou.users'
const K_ACTIVE = 'caribou.activeUserKey'

export function saveToStorage(): void {
  localStorage.setItem(K_USERS, JSON.stringify(Array.from(users.value.entries())))
  localStorage.setItem(K_ACTIVE, JSON.stringify(activeUserKey.value))
}

/**
 * The stored accounts, as `loadFromStorage` reads them. An empty map when
 * nothing is stored; null when the stored value cannot be read.
 */
function readStoredUsers(): Map<UserKey, UserSession> | null {
  try {
    const raw = localStorage.getItem(K_USERS)
    if (!raw) return new Map()
    const entries = JSON.parse(raw) as unknown
    if (!Array.isArray(entries)) return null
    const map = new Map<UserKey, UserSession>()
    // Older entries can lack `userKey` or `generation`; a failure event needs
    // both to find its session again. Take the key from the map key and the
    // generation from the token: a new sign-in has a new token.
    for (const [k, v] of entries as [UserKey, UserSession][]) {
      if (!isUserKey(k)) continue
      const generation = typeof v.generation === 'string' && v.generation !== ''
        ? v.generation
        : typeof v.token === 'string' && v.token !== '' ? v.token : newGeneration()
      map.set(k, { ...v, userKey: v.userKey ?? k, generation })
    }
    return map
  } catch {
    return null
  }
}

function readStoredActive(): UserKey | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(K_ACTIVE) ?? 'null') as unknown
    return typeof parsed === 'string' && isUserKey(parsed) ? parsed as UserKey : null
  } catch {
    return null
  }
}

export function loadFromStorage(): void {
  try {
    const rawUsers = localStorage.getItem(K_USERS)
    const rawActive = localStorage.getItem(K_ACTIVE)
    if (rawUsers) {
      const map = readStoredUsers()
      if (!map) throw new Error('unreadable caribou.users')
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
