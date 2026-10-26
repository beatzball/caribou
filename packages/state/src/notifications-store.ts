import { computed, effect, signal, type ReadonlySignal } from '@preact/signals-core'
import type { UserKey } from '@beatzball/caribou-auth'
import type { CaribouClient, CaribouError } from '@beatzball/caribou-mastodon-client'
import type { mastodon } from 'masto'
import { cacheAccount, cacheStatus, statusCache } from './caches.js'
import { startPolling, type PollHost } from './polling.js'
import { activeClient, activeUser } from './users.js'

export type NotificationFilter = 'all' | 'mentions'

/** `types[]` for each filter; empty asks the server for every type. */
export const NOTIFICATION_FILTER_TYPES: Record<NotificationFilter, readonly mastodon.v1.NotificationType[]> = {
  all: [],
  mentions: ['mention'],
}

export const NOTIFICATIONS_POLL_MS = 60_000

/**
 * Mastodon ids are numbers in a string and grow over time; a longer id is a
 * newer one. Comparing them as numbers would lose precision past 2^53.
 */
export function compareNotificationIds(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length
  return a < b ? -1 : a > b ? 1 : 0
}

// --- the list -------------------------------------------------------------

export interface NotificationsStore {
  notifications: ReadonlySignal<mastodon.v1.Notification[]>
  loading:       ReadonlySignal<boolean>
  error:         ReadonlySignal<CaribouError | null>
  hasMore:       ReadonlySignal<boolean>

  load(): Promise<void>
  loadMore(): Promise<void>
  /** Prepends what is newer than the first notification. */
  poll(): Promise<void>
}

export interface CreateNotificationsStoreOpts {
  clientSource: () => CaribouClient | null
  filter?: NotificationFilter
}

export function createNotificationsStore(opts: CreateNotificationsStoreOpts): NotificationsStore {
  const types = NOTIFICATION_FILTER_TYPES[opts.filter ?? 'all']
  const items   = signal<mastodon.v1.Notification[]>([])
  const loading = signal(false)
  const error   = signal<CaribouError | null>(null)
  const hasMore = signal(true)

  // The post inside a notification comes from the status cache, so a
  // favourite or boost from its card shows here as in every timeline.
  const notifications = computed<mastodon.v1.Notification[]>(() => {
    const cache = statusCache.value
    return items.value.map((n) => {
      const cached = n.status ? cache.get(n.status.id) : undefined
      return cached && cached !== n.status ? { ...n, status: cached } as mastodon.v1.Notification : n
    })
  })

  function ingest(page: mastodon.v1.Notification[]): mastodon.v1.Notification[] {
    for (const n of page) {
      if (n.status) cacheStatus(n.status)
      if (n.account) cacheAccount(n.account)
    }
    return page
  }

  // A poll that returns after the list was reloaded or extended must not
  // put back what is already there.
  function withoutKnown(page: mastodon.v1.Notification[]): mastodon.v1.Notification[] {
    const known = new Set(items.value.map((n) => n.id))
    return page.filter((n) => !known.has(n.id))
  }

  async function fetchPage(params: { sinceId?: string; maxId?: string }) {
    const client = opts.clientSource()
    if (!client) return []
    return client.fetchNotifications({ types, ...params })
  }

  async function load() {
    loading.value = true
    error.value = null
    try {
      const page = await fetchPage({})
      items.value = ingest(page)
      hasMore.value = page.length > 0
    } catch (err) {
      error.value = err as CaribouError
    } finally {
      loading.value = false
    }
  }

  async function loadMore() {
    if (loading.value || !hasMore.value) return
    const anchor = items.value[items.value.length - 1]?.id
    if (!anchor) return
    loading.value = true
    try {
      const page = await fetchPage({ maxId: anchor })
      items.value = [...items.value, ...withoutKnown(ingest(page))]
      hasMore.value = page.length > 0
    } catch (err) {
      error.value = err as CaribouError
    } finally {
      loading.value = false
    }
  }

  async function poll() {
    const first = items.value[0]?.id
    if (!first) return
    try {
      const page = await fetchPage({ sinceId: first })
      const fresh = withoutKnown(ingest(page))
      if (fresh.length > 0) items.value = [...fresh, ...items.value]
    } catch (err) {
      error.value = err as CaribouError
    }
  }

  return { notifications, loading, error, hasMore, load, loadMore, poll }
}

// --- seen marker and unread count ------------------------------------------

// The marker shares `caribou.prefs.<userKey>` with the other per-account
// preferences, so signing out (which removes that key) clears it too.
function prefsKey(userKey: UserKey): string {
  return `caribou.prefs.${userKey}`
}

function readPrefs(userKey: UserKey): Record<string, unknown> {
  try {
    const parsed = JSON.parse(localStorage.getItem(prefsKey(userKey)) ?? 'null') as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

export function lastSeenNotificationId(userKey: UserKey): string | null {
  const id = readPrefs(userKey).lastSeenNotificationId
  return typeof id === 'string' && id !== '' ? id : null
}

/** The number of notifications newer than the seen marker, up to `UNREAD_CAP`. */
export const unreadNotificationCount = signal(0)

/** One page: the badge says "40+" past it rather than paging to count. */
export const UNREAD_CAP = 40

/**
 * Moves the active user's seen marker to `id`. Never moves it back: a page
 * shown with an old filter or an old poll must not bring back the badge.
 */
export function markNotificationsSeen(id: string): void {
  const user = activeUser.value
  if (!user) return
  const prefs = readPrefs(user.userKey)
  const current = typeof prefs.lastSeenNotificationId === 'string' ? prefs.lastSeenNotificationId : null
  if (!current || compareNotificationIds(id, current) > 0) {
    localStorage.setItem(prefsKey(user.userKey), JSON.stringify({ ...prefs, lastSeenNotificationId: id }))
  }
  unreadNotificationCount.value = 0
}

export interface StartUnreadNotificationsOpts {
  intervalMs?: number
  host?: PollHost
}

/**
 * Keeps `unreadNotificationCount` up to date for the active user: one fetch
 * now, then one a minute while the tab is visible. Call it once for the whole
 * app. Every page has its own nav rail, and two pages are mounted during a
 * swap, so a poll per rail would ask twice.
 */
export function startUnreadNotifications(opts: StartUnreadNotificationsOpts = {}): () => void {
  let stopPolling: (() => void) | null = null

  // Restart on a new session only. Loading the account replaces the session
  // object, and with it `activeClient`; that is not a reason to ask again.
  const session = computed(() => {
    const user = activeUser.value
    return user ? `${user.userKey}\n${user.token}` : null
  })

  const dispose = effect(() => {
    const current = session.value
    stopPolling?.()
    stopPolling = null
    unreadNotificationCount.value = 0
    const user = activeUser.peek()
    if (!current || !user) return

    const refresh = async () => {
      const client = activeClient.peek()
      if (!client) return
      const since = lastSeenNotificationId(user.userKey)
      let page: mastodon.v1.Notification[]
      try {
        page = await client.fetchNotifications({ ...(since ? { sinceId: since } : {}), limit: UNREAD_CAP })
      } catch {
        return
      }
      // A reply for a session that is no longer the active one is dropped.
      if (session.peek() !== current) return
      // The page may have marked newer ones seen while this was in flight.
      const seen = lastSeenNotificationId(user.userKey)
      unreadNotificationCount.value = seen
        ? page.filter((n) => compareNotificationIds(n.id, seen) > 0).length
        : page.length
    }
    void refresh()
    stopPolling = startPolling({
      intervalMs: opts.intervalMs ?? NOTIFICATIONS_POLL_MS,
      fn: refresh,
      ...(opts.host ? { host: opts.host } : {}),
    })
  })

  return () => {
    dispose()
    stopPolling?.()
    stopPolling = null
  }
}
