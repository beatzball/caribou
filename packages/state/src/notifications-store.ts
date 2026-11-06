import { computed, effect, signal, type ReadonlySignal } from '@preact/signals-core'
import type { UserKey } from '@beatzball/caribou-auth'
import type {
  CaribouClient, CaribouError, GroupedNotificationsPage, Notification,
  NotificationType,
} from '@beatzball/caribou-mastodon-client'
import { cacheAccount, cacheStatus, statusCache } from './caches.js'
import {
  appendOlderGroups, compareNotificationIds, groupNotifications, groupsFromPage, prependNewerGroups,
  type NotificationGroup,
} from './notification-groups.js'
import { ownerGeneration } from './keep-alive.js'
import { startPolling, type PollHost } from './polling.js'
import { readPrefs, updatePrefs } from './prefs.js'
import { activeClient, activeUser } from './users.js'

export type NotificationFilter = 'all' | 'mentions'

/** `types[]` for each filter; empty asks the server for every type. */
export const NOTIFICATION_FILTER_TYPES: Record<NotificationFilter, readonly NotificationType[]> = {
  all: [],
  mentions: ['mention'],
}

export const NOTIFICATIONS_POLL_MS = 60_000

export { compareNotificationIds }

// --- the list -------------------------------------------------------------

export interface NotificationsStore {
  /** The single notifications, from a server without grouping. Empty otherwise. */
  notifications: ReadonlySignal<Notification[]>
  /** The rows to show, newest first, from the server's groups or grouped here. */
  groups:        ReadonlySignal<NotificationGroup[]>
  loading:       ReadonlySignal<boolean>
  /** The last failure. Rows already shown stay; the next success clears it. */
  error:         ReadonlySignal<CaribouError | null>
  hasMore:       ReadonlySignal<boolean>

  load(): Promise<void>
  loadMore(): Promise<void>
  /** Prepends what is newer than the first notification, or loads an empty list. */
  poll(): Promise<void>
}

export interface CreateNotificationsStoreOpts {
  clientSource: () => CaribouClient | null
  filter?: NotificationFilter
}

/** Mastodon's default and largest page of notifications. */
export const NOTIFICATIONS_PAGE = 40

/** A poll pages forward this many times at most. The next poll goes on from there. */
export const NOTIFICATIONS_POLL_MAX_PAGES = 5

// The accounts whose server has no grouped notifications (Mastodon before
// 4.3). Their lists ask for single ones and group them here.
const withoutGrouped = new Set<string>()

// How a server says it has no such path. Mastodon, GoToSocial, Akkoma and
// Pleroma answer 404; some proxies and servers answer one of the others.
const NO_SUCH_PATH = new Set([400, 404, 405, 410, 501])

function isMissingEndpoint(err: unknown): boolean {
  const e = err as Partial<CaribouError>
  return e.code === 'not_found' || (e.status !== undefined && NO_SUCH_PATH.has(e.status))
}

/** For tests: forget which servers have no grouped notifications. */
export function resetGroupedSupport(): void {
  withoutGrouped.clear()
}

function usesGrouped(client: CaribouClient): boolean {
  return typeof client.fetchGroupedNotifications === 'function' && !withoutGrouped.has(client.userKey)
}

type PageParams = { minId?: string; maxId?: string; limit?: number }

export function createNotificationsStore(opts: CreateNotificationsStoreOpts): NotificationsStore {
  const types = NOTIFICATION_FILTER_TYPES[opts.filter ?? 'all']
  // A list holds either single notifications (an older server) or the
  // server's groups. load() picks which, and the list keeps it until the
  // next load().
  const items   = signal<Notification[]>([])
  const serverGroups = signal<NotificationGroup[] | null>(null)
  const loading = signal(false)
  const error   = signal<CaribouError | null>(null)
  const hasMore = signal(true)
  // A load() replaces the list. A reply to a request made before it is
  // dropped, and so is one that comes back under another account (also
  // A -> B -> A). Nothing from a dropped reply reaches the shared caches.
  let generation = 0
  const current = (mine: number, owner: number) => mine === generation && owner === ownerGeneration()
  let polling: Promise<void> | null = null

  // The post inside a notification comes from the status cache, so a
  // favourite or boost from its card shows here as in every timeline.
  const notifications = computed<Notification[]>(() => {
    const cache = statusCache.value
    return items.value.map((n) => {
      const cached = n.status ? cache.get(n.status.id) : undefined
      return cached && cached !== n.status ? { ...n, status: cached } as Notification : n
    })
  })

  const groups = computed<NotificationGroup[]>(() => {
    const list = serverGroups.value
    if (!list) return groupNotifications(notifications.value)
    const cache = statusCache.value
    return list.map((g) => {
      const cached = g.status ? cache.get(g.status.id) : undefined
      return cached && cached !== g.status ? { ...g, status: cached } : g
    })
  })

  function ingest(page: Notification[]): Notification[] {
    for (const n of page) {
      if (n.status) cacheStatus(n.status)
      if (n.account) cacheAccount(n.account)
    }
    return page
  }

  function ingestGroups(page: GroupedNotificationsPage): NotificationGroup[] {
    for (const s of page.statuses) cacheStatus(s)
    for (const a of page.accounts) cacheAccount(a)
    return groupsFromPage(page)
  }

  // A poll that returns after the list was extended must not put back what
  // is already there.
  function withoutKnown(page: Notification[]): Notification[] {
    const known = new Set(items.value.map((n) => n.id))
    return page.filter((n) => !known.has(n.id))
  }

  async function fetchPage(params: PageParams) {
    const client = opts.clientSource()
    if (!client) return []
    return client.fetchNotifications({ types, ...params })
  }

  async function fetchGroups(client: CaribouClient, params: PageParams) {
    return client.fetchGroupedNotifications({ types, ...params })
  }

  // The first page, from the grouped endpoint when the server has it.
  // Nothing is cached here: the caller checks the reply is still wanted.
  async function fetchFirst(): Promise<{ grouped: GroupedNotificationsPage | null; page: Notification[] }> {
    const client = opts.clientSource()
    if (!client) return { grouped: null, page: [] }
    if (usesGrouped(client)) {
      try {
        return { grouped: await fetchGroups(client, {}), page: [] }
      } catch (err) {
        if (!isMissingEndpoint(err)) throw err
        // A 400 can be a passing proxy fault or a bad query: fall back for
        // this load only, and ask the grouped endpoint again next time.
        if ((err as Partial<CaribouError>).status !== 400) withoutGrouped.add(client.userKey)
      }
    }
    return { grouped: null, page: await client.fetchNotifications({ types }) }
  }

  async function load() {
    const mine = ++generation
    const owner = ownerGeneration()
    loading.value = true
    error.value = null
    try {
      const first = await fetchFirst()
      if (!current(mine, owner)) return
      if (first.grouped) {
        const groups = ingestGroups(first.grouped)
        serverGroups.value = groups
        items.value = []
        hasMore.value = groups.length > 0
      } else {
        serverGroups.value = null
        items.value = ingest(first.page)
        hasMore.value = first.page.length > 0
      }
    } catch (err) {
      if (mine === generation) error.value = err as CaribouError
    } finally {
      if (mine === generation) loading.value = false
    }
  }

  function oldestGroupId(list: NotificationGroup[]): string | undefined {
    let oldest: string | undefined
    for (const g of list) if (!oldest || compareNotificationIds(g.oldestId, oldest) < 0) oldest = g.oldestId
    return oldest
  }

  function newestGroupId(list: NotificationGroup[]): string | undefined {
    let newest: string | undefined
    for (const g of list) if (!newest || compareNotificationIds(g.newestId, newest) > 0) newest = g.newestId
    return newest
  }

  async function loadMore() {
    if (loading.value || !hasMore.value) return
    const grouped = serverGroups.value
    const anchor = grouped ? oldestGroupId(grouped) : items.value[items.value.length - 1]?.id
    if (!anchor) return
    const mine = generation
    const owner = ownerGeneration()
    loading.value = true
    try {
      if (grouped) {
        const client = opts.clientSource()
        if (!client) return
        const raw = await fetchGroups(client, { maxId: anchor })
        if (!current(mine, owner)) return
        const older = ingestGroups(raw)
        serverGroups.value = appendOlderGroups(serverGroups.value ?? [], older)
        hasMore.value = older.length > 0
      } else {
        const page = await fetchPage({ maxId: anchor })
        if (!current(mine, owner)) return
        items.value = [...items.value, ...withoutKnown(ingest(page))]
        hasMore.value = page.length > 0
      }
      error.value = null
    } catch (err) {
      if (mine === generation) error.value = err as CaribouError
    } finally {
      if (mine === generation) loading.value = false
    }
  }

  async function pollGroups(mine: number, owner: number, first: string) {
    const client = opts.clientSource()
    if (!client) return
    // Page forward from the newest one shown, and merge once every page is
    // in, as for single notifications below.
    const pages: GroupedNotificationsPage[] = []
    let cursor = first
    for (let i = 0; i < NOTIFICATIONS_POLL_MAX_PAGES; i++) {
      const raw = await fetchGroups(client, { minId: cursor, limit: NOTIFICATIONS_PAGE })
      if (!current(mine, owner)) return
      pages.push(raw)
      for (const g of raw.notificationGroups) {
        const top = g.pageMaxId ?? g.mostRecentNotificationId
        if (compareNotificationIds(top, cursor) > 0) cursor = top
      }
      if (raw.notificationGroups.length < NOTIFICATIONS_PAGE) break
    }
    // Each page is newer than the one before it.
    let list = serverGroups.value ?? []
    for (const page of pages) list = prependNewerGroups(list, ingestGroups(page))
    serverGroups.value = list
    error.value = null
  }

  async function pollOnce() {
    const mine = generation
    const owner = ownerGeneration()
    const grouped = serverGroups.value
    const first = grouped ? newestGroupId(grouped) : items.value[0]?.id
    try {
      if (!first) {
        // Nothing to page from yet: ask for the first page.
        const firstPage = await fetchFirst()
        if (!current(mine, owner)) return
        if ((serverGroups.value?.length ?? 0) > 0 || items.value.length > 0) return
        const groups = firstPage.grouped ? ingestGroups(firstPage.grouped) : null
        serverGroups.value = groups
        items.value = groups ? [] : ingest(firstPage.page)
        hasMore.value = (groups?.length ?? firstPage.page.length) > 0
        error.value = null
        return
      }
      if (grouped) {
        await pollGroups(mine, owner, first)
        return
      }
      // Page forward from the newest one shown. `since_id` would give the
      // newest page and leave a hole under it when more than a page came in.
      const fresh = new Map<string, Notification>()
      let cursor = first
      for (let i = 0; i < NOTIFICATIONS_POLL_MAX_PAGES; i++) {
        const page = await fetchPage({ minId: cursor, limit: NOTIFICATIONS_PAGE })
        if (!current(mine, owner)) return
        for (const n of page) {
          fresh.set(n.id, n)
          if (compareNotificationIds(n.id, cursor) > 0) cursor = n.id
        }
        if (page.length < NOTIFICATIONS_PAGE) break
      }
      // Merge only once every page is in. What is merged always joins the
      // old first one, so the list has no hole.
      const merged = withoutKnown(ingest([...fresh.values()]))
        .sort((a, b) => compareNotificationIds(b.id, a.id))
      if (merged.length > 0) items.value = [...merged, ...items.value]
      error.value = null
    } catch (err) {
      if (mine === generation) error.value = err as CaribouError
    }
  }

  // The timer, a visibility change and a new unread count can all ask at
  // once. One poll at a time.
  function poll(): Promise<void> {
    polling ??= pollOnce().finally(() => { polling = null })
    return polling
  }

  return { notifications, groups, loading, error, hasMore, load, loadMore, poll }
}

// --- seen marker and unread count ------------------------------------------

// The marker shares `caribou.prefs.<userKey>` with the other per-account
// preferences (`prefs.ts`), so signing out (which removes that key) clears it too.

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
 * The count goes to 0 only when the marker moves: a poll that failed or
 * found nothing has not shown what the count is about.
 * With `userKey`, it does nothing unless that user is still the active one.
 */
export function markNotificationsSeen(id: string, userKey?: UserKey): void {
  const user = activeUser.peek()
  if (!user || (userKey && userKey !== user.userKey)) return
  const prefs = readPrefs(user.userKey)
  const current = typeof prefs.lastSeenNotificationId === 'string' ? prefs.lastSeenNotificationId : null
  if (current && compareNotificationIds(id, current) <= 0) return
  updatePrefs(user.userKey, { lastSeenNotificationId: id })
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
  let disposed = false

  // Restart on a new session only. Loading the account replaces the session
  // object, and with it `activeClient`; that is not a reason to ask again.
  const session = computed(() => {
    const user = activeUser.value
    return user ? `${user.userKey}\n${user.token}` : null
  })

  // Every new session starts a new activation. A reply from an older one is
  // dropped, also for the same key and token after A -> B -> A.
  let activation = 0

  const dispose = effect(() => {
    const current = session.value
    const mine = ++activation
    stopPolling?.()
    stopPolling = null
    unreadNotificationCount.value = 0
    const user = activeUser.peek()
    if (!current || !user) return

    const fetchCount = async () => {
      const client = activeClient.peek()
      if (!client) return
      const since = lastSeenNotificationId(user.userKey)
      let page: Notification[]
      try {
        page = await client.fetchNotifications({ ...(since ? { sinceId: since } : {}), limit: UNREAD_CAP })
      } catch {
        return
      }
      if (disposed || mine !== activation) return
      // The page may have marked newer ones seen while this was in flight.
      const seen = lastSeenNotificationId(user.userKey)
      unreadNotificationCount.value = seen
        ? page.filter((n) => compareNotificationIds(n.id, seen) > 0).length
        : page.length
    }

    // One refresh at a time, so an older reply can not land after a newer
    // one. Loading the account makes a new client for the same session, and
    // the two do not share a request. A refresh asked for during one runs
    // once more after it.
    let running: Promise<void> | null = null
    let again = false
    const refresh = (): Promise<void> => {
      if (running) {
        again = true
        return running
      }
      running = (async () => {
        do {
          again = false
          await fetchCount()
        } while (again && !disposed && mine === activation)
      })().finally(() => { running = null })
      return running
    }

    void refresh()
    stopPolling = startPolling({
      intervalMs: opts.intervalMs ?? NOTIFICATIONS_POLL_MS,
      fn: refresh,
      ...(opts.host ? { host: opts.host } : {}),
    })
  })

  return () => {
    disposed = true
    dispose()
    stopPolling?.()
    stopPolling = null
  }
}
