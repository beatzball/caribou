import { computed, effect, signal, type ReadonlySignal } from '@preact/signals-core'
import type { UserKey } from '@beatzball/caribou-auth'
import type {
  CaribouClient, CaribouError, GroupedNotificationsPage, Notification, NotificationPage,
  NotificationType,
} from '@beatzball/caribou-mastodon-client'
import { cacheAccount, cacheStatus, readSource, statusCache, type CopySource } from './caches.js'
import {
  appendOlderGroups, byIndexedAt, compareNotificationIds, groupBlueskyNotifications, groupNotifications,
  groupsFromPage, prependNewerGroups,
  type NotificationGroup,
} from './notification-groups.js'
import { ownerGeneration } from './keep-alive.js'
import { startPolling, type PollHost } from './polling.js'
import { readPrefs, updatePrefs } from './prefs.js'
import { isBlueskySession } from './bluesky-session.js'
import { activeClient, activeUser, type UserSession } from './users.js'

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
  /** Whether "Load older" has more: the last page's `nextCursor` is not null. */
  hasMore:       ReadonlySignal<boolean>
  /**
   * Bluesky: what the list has read from the top (load and polls), skipped
   * notifications included: the newest `indexedAt`, and whether any was
   * unread. `updateSeen` is sent from it. Null for Mastodon.
   */
  seen:          ReadonlySignal<BlueskySeenHint | null>

  load(): Promise<void>
  loadMore(): Promise<void>
  /** Prepends what is newer than the first notification, or loads an empty list. */
  poll(): Promise<void>
}

export interface BlueskySeenHint {
  newestAt: string | null
  unread: boolean
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

function isBlueskyClient(client: CaribouClient | null): boolean {
  return client?.capabilities?.network === 'bluesky'
}

function usesGrouped(client: CaribouClient): boolean {
  if (isBlueskyClient(client)) return false
  return typeof client.fetchGroupedNotifications === 'function' && !withoutGrouped.has(client.userKey)
}

type PageParams = { minId?: string; cursor?: string; sinceId?: string; sinceAt?: string; limit?: number }

function laterHint(a: BlueskySeenHint | null, b: BlueskySeenHint | undefined): BlueskySeenHint | null {
  if (!b) return a
  if (!a) return { ...b }
  const newer = b.newestAt !== null && (a.newestAt === null || Date.parse(b.newestAt) > Date.parse(a.newestAt))
  return { newestAt: newer ? b.newestAt : a.newestAt, unread: a.unread || b.unread }
}

const EMPTY_PAGE = (): NotificationPage => Object.assign([] as Notification[], { nextCursor: null })

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
  // The next older page, as the last page named it. Null: the list ended.
  let olderCursor: string | null = null
  // Bluesky: no server groups and no id order (README, "Notifications").
  const bluesky = signal(false)
  const seen = signal<BlueskySeenHint | null>(null)
  function setCursor(next: string | null) {
    olderCursor = next
    hasMore.value = next !== null
  }
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
    if (!list) return bluesky.value ? groupBlueskyNotifications(notifications.value) : groupNotifications(notifications.value)
    const cache = statusCache.value
    return list.map((g) => {
      const cached = g.status ? cache.get(g.status.id) : undefined
      return cached && cached !== g.status ? { ...g, status: cached } : g
    })
  })

  // The source of a fetch that starts now (the slot rule needs the start).
  function startRead(): CopySource {
    return readSource(opts.clientSource()?.userKey ?? null)
  }

  function ingest(page: Notification[], source: CopySource): Notification[] {
    for (const n of page) {
      if (n.status) cacheStatus(n.status, source)
      if (n.account) cacheAccount(n.account)
    }
    return page
  }

  function ingestGroups(page: GroupedNotificationsPage, source: CopySource): NotificationGroup[] {
    for (const s of page.statuses) cacheStatus(s, source)
    for (const a of page.accounts) cacheAccount(a)
    return groupsFromPage(page)
  }

  // A poll that returns after the list was extended must not put back what
  // is already there.
  function withoutKnown(page: Notification[]): Notification[] {
    const known = new Set(items.value.map((n) => n.id))
    return page.filter((n) => !known.has(n.id))
  }

  async function fetchPage(params: PageParams): Promise<NotificationPage> {
    const client = opts.clientSource()
    if (!client) return EMPTY_PAGE()
    return client.fetchNotifications({ types, ...params })
  }

  async function fetchGroups(client: CaribouClient, params: PageParams) {
    return client.fetchGroupedNotifications({ types, ...params })
  }

  // The first page, from the grouped endpoint when the server has it.
  // Nothing is cached here: the caller checks the reply is still wanted.
  async function fetchFirst(): Promise<{ grouped: GroupedNotificationsPage | null; page: NotificationPage; bluesky: boolean }> {
    const client = opts.clientSource()
    if (!client) return { grouped: null, page: EMPTY_PAGE(), bluesky: false }
    if (isBlueskyClient(client)) return { grouped: null, page: await client.fetchNotifications({ types }), bluesky: true }
    if (usesGrouped(client)) {
      try {
        return { grouped: await fetchGroups(client, {}), page: EMPTY_PAGE(), bluesky: false }
      } catch (err) {
        if (!isMissingEndpoint(err)) throw err
        // A 400 can be a passing proxy fault or a bad query: fall back for
        // this load only, and ask the grouped endpoint again next time.
        if ((err as Partial<CaribouError>).status !== 400) withoutGrouped.add(client.userKey)
      }
    }
    return { grouped: null, page: await client.fetchNotifications({ types }), bluesky: false }
  }

  async function load() {
    const mine = ++generation
    firstApplied = false
    const owner = ownerGeneration()
    loading.value = true
    error.value = null
    const source = startRead()
    try {
      const first = await fetchFirst()
      if (!current(mine, owner)) return
      applyFirst(first, source)
    } catch (err) {
      if (mine === generation) error.value = err as CaribouError
    } finally {
      if (mine === generation) loading.value = false
    }
  }

  // A poll that replaces the list or its cursor starts a new generation, as
  // load() does: an answer to a request made before it writes nothing. The
  // request it drops no longer holds the list as loading.
  function restart() {
    generation++
    loading.value = false
  }

  // Whether a first page has come in since the last load(). After it, only
  // a first page with rows may replace the list: an empty one must not
  // bring back a cursor the list has already read past.
  let firstApplied = false

  // The first page replaces the list. Only the client's cursor ends it.
  function applyFirst(first: Awaited<ReturnType<typeof fetchFirst>>, source: CopySource) {
    firstApplied = true
    bluesky.value = first.bluesky
    seen.value = first.bluesky ? laterHint(null, first.page.bluesky) : null
    if (first.grouped) {
      serverGroups.value = ingestGroups(first.grouped, source)
      items.value = []
      setCursor(first.grouped.nextCursor)
    } else {
      serverGroups.value = null
      items.value = ingest(first.page, source)
      setCursor(first.page.nextCursor)
    }
  }

  function newestGroupId(list: NotificationGroup[]): string | undefined {
    let newest: string | undefined
    for (const g of list) if (!newest || compareNotificationIds(g.newestId, newest) > 0) newest = g.newestId
    return newest
  }

  async function loadMore() {
    if (loading.value || !hasMore.value) return
    const grouped = serverGroups.value
    // The cursor the last page named, as it came. An empty page with a
    // cursor is not the end (README, "Notifications").
    const anchor = olderCursor
    if (anchor === null) return
    const mine = generation
    const owner = ownerGeneration()
    loading.value = true
    const source = startRead()
    try {
      if (grouped) {
        const client = opts.clientSource()
        if (!client) return
        const raw = await fetchGroups(client, { cursor: anchor })
        if (!current(mine, owner)) return
        const older = ingestGroups(raw, source)
        serverGroups.value = appendOlderGroups(serverGroups.value ?? [], older)
        setCursor(raw.nextCursor)
      } else {
        const page = await fetchPage({ cursor: anchor })
        if (!current(mine, owner)) return
        items.value = [...items.value, ...withoutKnown(ingest(page, source))]
        setCursor(page.nextCursor)
      }
      error.value = null
    } catch (err) {
      if (mine === generation) error.value = err as CaribouError
    } finally {
      if (mine === generation) loading.value = false
    }
  }

  async function pollGroups(mine: number, owner: number, first: string, source: CopySource) {
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
    for (const page of pages) list = prependNewerGroups(list, ingestGroups(page, source))
    serverGroups.value = list
    error.value = null
  }

  // Bluesky has no min_id: the client reads from the top until it meets the
  // newest one shown. Met: merge what is above it. Not met (a gap): the list
  // starts again from what was read, and pages on from there.
  async function pollBluesky(mine: number, owner: number, first: Notification, source: CopySource) {
    // The time too: the client stops at the first one older than it, so a
    // deleted anchor is not read past (README, "Notifications").
    const page = await fetchPage({ sinceId: first.id, sinceAt: first.createdAt })
    if (!current(mine, owner)) return
    seen.value = laterHint(seen.value, page.bluesky)
    if (page.nextCursor === null) {
      const fresh = withoutKnown(ingest(page, source))
      if (fresh.length > 0) items.value = [...fresh, ...items.value]
    } else {
      restart()
      items.value = ingest(page, source)
      setCursor(page.nextCursor)
    }
    error.value = null
  }

  async function pollOnce() {
    const mine = generation
    const owner = ownerGeneration()
    const grouped = serverGroups.value
    const newestBluesky = bluesky.value ? byIndexedAt(items.value)[0] : undefined
    const first = grouped
      ? newestGroupId(grouped)
      : bluesky.value ? newestBluesky?.id : items.value[0]?.id
    const source = startRead()
    try {
      if (!first) {
        // Nothing to page from yet: ask for the first page.
        const firstPage = await fetchFirst()
        if (!current(mine, owner)) return
        if ((serverGroups.value?.length ?? 0) > 0 || items.value.length > 0) return
        const rows = firstPage.grouped ? firstPage.grouped.notificationGroups.length : firstPage.page.length
        if (firstApplied && rows === 0) {
          if (firstPage.bluesky) seen.value = laterHint(seen.value, firstPage.page.bluesky)
        } else {
          restart()
          applyFirst(firstPage, source)
        }
        error.value = null
        return
      }
      if (grouped) {
        await pollGroups(mine, owner, first, source)
        return
      }
      if (bluesky.value && newestBluesky) {
        await pollBluesky(mine, owner, newestBluesky, source)
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
      const merged = withoutKnown(ingest([...fresh.values()], source))
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

  return { notifications, groups, loading, error, hasMore, seen, load, loadMore, poll }
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

// --- Bluesky: updateSeen (README, "Notifications") ------------------------

/** The last `seenAt` this browser sent for a Bluesky account, from its prefs. */
export function lastSeenNotificationAt(userKey: UserKey): string | null {
  const at = readPrefs(userKey).lastSeenNotificationAt
  return typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? at : null
}

// Each successful updateSeen bumps its account's number. A count whose
// request started before it can still count what the reader just saw.
const seenLanded = new Map<UserKey, number>()
function landedFor(userKey: UserKey): number {
  return seenLanded.get(userKey) ?? 0
}

// One updateSeen per account at a time. A newer `seenAt` asked for while one
// is in flight waits, and is sent after it.
const seenInFlight = new Map<UserKey, Promise<void>>()
const seenQueued = new Map<UserKey, { generation: string; seenAt: string }>()

function sessionMatches(user: UserSession | null, userKey: UserKey, generation: string): boolean {
  return !!user && user.userKey === userKey && user.generation === generation
}

/** For tests: forget what is in flight. */
export function resetBlueskySeen(): void {
  seenLanded.clear()
  seenInFlight.clear()
  seenQueued.clear()
}

export interface MarkBlueskySeenInput {
  userKey: UserKey
  /** The sign-in the list was loaded for. */
  generation: string
  hint: BlueskySeenHint | null
}

/**
 * Sends `updateSeen` for the Bluesky list the reader has seen. Only when the
 * list read an unread notification, and its newest time is newer than the
 * last one this browser sent for the account; only to the active client of
 * that same sign-in. Resolves when done; never throws.
 */
export function markBlueskyNotificationsSeen(input: MarkBlueskySeenInput): Promise<void> {
  const { userKey, generation, hint } = input
  if (!hint || !hint.unread || !hint.newestAt) return Promise.resolve()
  if (!sessionMatches(activeUser.peek(), userKey, generation)) return Promise.resolve()
  const last = lastSeenNotificationAt(userKey)
  if (last && Date.parse(hint.newestAt) <= Date.parse(last)) return Promise.resolve()
  const running = seenInFlight.get(userKey)
  if (running) {
    const queued = seenQueued.get(userKey)
    if (!queued || Date.parse(hint.newestAt) > Date.parse(queued.seenAt)) {
      seenQueued.set(userKey, { generation, seenAt: hint.newestAt })
    }
    return running
  }
  const run = sendSeen(userKey, generation, hint.newestAt).finally(() => {
    seenInFlight.delete(userKey)
    const next = seenQueued.get(userKey)
    seenQueued.delete(userKey)
    if (next) void markBlueskyNotificationsSeen({ userKey, generation: next.generation, hint: { newestAt: next.seenAt, unread: true } })
  })
  seenInFlight.set(userKey, run)
  return run
}

async function sendSeen(userKey: UserKey, generation: string, seenAt: string): Promise<void> {
  const client = activeClient.peek()
  // Never for another account, and never for another sign-in of this one.
  if (!client || client.userKey !== userKey || typeof client.updateSeen !== 'function') return
  if (!sessionMatches(activeUser.peek(), userKey, generation)) return
  try {
    await client.updateSeen(seenAt)
  } catch {
    // Nothing changes; the next view or poll tries again.
    return
  }
  // Another tab may have sent a newer one meanwhile.
  const last = lastSeenNotificationAt(userKey)
  if (!last || Date.parse(seenAt) > Date.parse(last)) updatePrefs(userKey, { lastSeenNotificationAt: seenAt })
  seenLanded.set(userKey, landedFor(userKey) + 1)
  if (sessionMatches(activeUser.peek(), userKey, generation)) unreadNotificationCount.value = 0
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
  // A Bluesky session has no token: its sign-in is its `generation`.
  const session = computed(() => {
    const user = activeUser.value
    if (!user) return null
    return `${user.userKey}\n${isBlueskySession(user) ? user.generation : user.token}`
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

    const fetchBlueskyCount = async (client: CaribouClient) => {
      // Only the client of this account: a switch drops the old count.
      if (client.userKey !== user.userKey || typeof client.getUnreadCount !== 'function') return
      const landed = landedFor(user.userKey)
      let count: number
      try {
        count = await client.getUnreadCount()
      } catch {
        return
      }
      if (disposed || mine !== activation) return
      // An updateSeen landed while this was in flight: this count is older.
      if (landedFor(user.userKey) !== landed) return
      unreadNotificationCount.value = Math.min(Math.max(0, count), UNREAD_CAP)
    }

    const fetchCount = async () => {
      const client = activeClient.peek()
      if (!client) return
      if (isBlueskySession(user)) {
        await fetchBlueskyCount(client)
        return
      }
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
