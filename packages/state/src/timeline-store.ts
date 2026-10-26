import { batch, computed, signal, type ReadonlySignal } from '@preact/signals-core'
import type {
  CaribouClient, CaribouError, TimelineKind, TimelinePage,
} from '@beatzball/caribou-mastodon-client'
import type { mastodon } from 'masto'
import { cacheStatus, mergeStatus, statusCache } from './caches.js'
import { ownerGeneration } from './keep-alive.js'

export interface TimelineStore {
  statusIds:     ReadonlySignal<string[]>
  statuses:      ReadonlySignal<mastodon.v1.Status[]>
  loading:       ReadonlySignal<boolean>
  error:         ReadonlySignal<CaribouError | null>
  hasMore:       ReadonlySignal<boolean>
  /** True while `refresh()` is fetching in the background. */
  refreshing:    ReadonlySignal<boolean>
  /** When the list was last fetched or seeded (epoch ms), or 0 before. */
  syncedAt:      ReadonlySignal<number>
  newPosts:      ReadonlySignal<mastodon.v1.Status[]>
  newPostsCount: ReadonlySignal<number>

  load(): Promise<void>
  loadMore(): Promise<void>
  poll(): Promise<void>
  applyNewPosts(): void
  /**
   * Checks for newer posts behind a list the reader may already be looking
   * at: they go to the new-posts buffer, never into the list. An empty store
   * loads instead.
   */
  refresh(): Promise<void>
  /**
   * Takes a fresh first page from the network by another route (the page's
   * server data). Posts above the newest one the store knows go to the
   * new-posts buffer; known posts only update the status cache. Never pass
   * a cached snapshot: it would count as a sync. Into an empty list the
   * page goes as the list itself, and `nextMaxId` says where the next page
   * starts (its last post when not given).
   */
  offer(page: mastodon.v1.Status[], nextMaxId?: string | null): void
  /** Runs the last fetch that failed again, if any. */
  retry(): Promise<void>

  /** Test-only — do not use in production code. Injects statuses directly
   *  into the new-posts buffer so integration tests can drive applyNewPosts
   *  without a real Mastodon client. */
  _testOnlyPrepend(xs: mastodon.v1.Status[]): void
}

export interface CreateTimelineStoreOpts {
  clientSource: () => CaribouClient | null
  pollIntervalMs?: number
  initial?: { statuses: mastodon.v1.Status[]; nextMaxId: string | null }
}

export function createTimelineStore(kind: TimelineKind, opts: CreateTimelineStoreOpts): TimelineStore {
  const statusIds  = signal<string[]>([])
  const loading    = signal(false)
  const error      = signal<CaribouError | null>(null)
  const hasMore    = signal(true)
  const newPostIds = signal<string[]>([])
  const refreshing = signal(false)
  const syncedAt   = signal(0)

  const statuses = computed<mastodon.v1.Status[]>(() => {
    const cache = statusCache.value
    return statusIds.value
      .map((id) => cache.get(id))
      .filter((s): s is mastodon.v1.Status => !!s)
  })
  const newPosts = computed<mastodon.v1.Status[]>(() => {
    const cache = statusCache.value
    return newPostIds.value
      .map((id) => cache.get(id))
      .filter((s): s is mastodon.v1.Status => !!s)
  })
  const newPostsCount = computed(() => newPostIds.value.length)

  function ingest(page: mastodon.v1.Status[]): string[] {
    batch(() => { for (const s of page) cacheStatus(s) })
    return page.map((s) => s.id)
  }

  // Track whether the SSR-seeded first page has been "consumed". Two
  // distinct invariants:
  //   1. load() — the first call after construction is a no-op when seeded
  //      (the SSR pageData already paid for that fetch). Subsequent load()s
  //      run normally.
  //   2. loadMore() — the first call uses opts.initial.nextMaxId as the
  //      anchor (the SSR fetcher knows where the next page starts).
  //      Subsequent calls fall through to last-status-id behavior.
  let firstLoadConsumed = false
  let nextMaxIdForFirstLoadMore: string | null = null
  // The cursor the last page named, for timelines whose next page is not
  // found by the last status id (bookmarks). It lives here and not in the
  // client, because `activeClient` is a new client whenever `users` changes.
  let nextCursor: string | undefined

  if (opts.initial) {
    for (const s of opts.initial.statuses) cacheStatus(s)
    statusIds.value = opts.initial.statuses.map((s) => s.id)
    hasMore.value = opts.initial.nextMaxId != null
    firstLoadConsumed = true
    nextMaxIdForFirstLoadMore = opts.initial.nextMaxId
    syncedAt.value = Date.now()
  }

  async function runFetch(
    params: { sinceId?: string; maxId?: string; limit?: number } | undefined,
  ): Promise<TimelinePage> {
    const client = opts.clientSource()
    if (!client) return []
    return client.fetchTimeline(kind, params)
  }

  // A page that names its cursor also says whether there is a next page, so
  // the store does not ask once more only to learn the list has ended.
  function setPaging(page: TimelinePage) {
    nextCursor = page.nextMaxId ?? undefined
    hasMore.value = page.length > 0 && page.nextMaxId !== null
  }

  // The operation `retry()` runs again: the last one that failed.
  let failed: (() => Promise<void>) | null = null
  function fail(err: unknown, op: () => Promise<void>) {
    error.value = err as CaribouError
    failed = op
  }
  function succeed() {
    error.value = null
    failed = null
  }

  // Posts go to the buffer only when the list does not show them yet; a
  // post can come back from the page data and from a check at once.
  function buffer(ids: string[]) {
    const shown = new Set(statusIds.value)
    newPostIds.value = Array.from(new Set([...ids, ...newPostIds.value])).filter((id) => !shown.has(id))
  }

  // Each fetch reads the owner generation before its request and checks it
  // again right before it writes anything: a page for an account that is no
  // longer active must not reach the caches or a kept store.

  async function load() {
    if (firstLoadConsumed) {
      firstLoadConsumed = false
      return
    }
    const generation = ownerGeneration()
    loading.value = true
    error.value = null
    try {
      const page = await runFetch(undefined)
      if (generation !== ownerGeneration()) return
      batch(() => {
        statusIds.value = ingest(page)
        setPaging(page)
        syncedAt.value = Date.now()
        succeed()
      })
    } catch (err) {
      if (generation === ownerGeneration()) fail(err, load)
    } finally {
      loading.value = false
    }
  }

  async function loadMore() {
    if (loading.value || !hasMore.value) return
    const anchor = nextMaxIdForFirstLoadMore ?? nextCursor ?? statusIds.value[statusIds.value.length - 1]
    if (!anchor) return
    const generation = ownerGeneration()
    nextMaxIdForFirstLoadMore = null
    loading.value = true
    try {
      const page = await runFetch({ maxId: anchor })
      if (generation !== ownerGeneration()) return
      batch(() => {
        statusIds.value = [...statusIds.value, ...ingest(page)]
        setPaging(page)
        succeed()
      })
    } catch (err) {
      if (generation !== ownerGeneration()) return
      // The next try asks from the same place.
      nextMaxIdForFirstLoadMore = anchor
      fail(err, loadMore)
    } finally {
      loading.value = false
    }
  }

  async function poll() {
    // The buffer holds posts newer than the list, so ask from its top.
    const first = newPostIds.value[0] ?? statusIds.value[0]
    if (!first) return
    const generation = ownerGeneration()
    try {
      const page = await runFetch({ sinceId: first })
      if (generation !== ownerGeneration()) return
      batch(() => {
        syncedAt.value = Date.now()
        // A failed check earlier left an error; this one worked.
        succeed()
        const ids = ingest(page)
        if (ids.length > 0) buffer(ids)
      })
    } catch (err) {
      if (generation === ownerGeneration()) fail(err, poll)
    }
  }

  async function refresh() {
    if (loading.value || refreshing.value) return
    if (statusIds.value.length === 0) {
      // A store the server seeded with an empty page skips its first load;
      // a refresh is asked for on purpose, so it fetches.
      firstLoadConsumed = false
      return load()
    }
    refreshing.value = true
    try {
      await poll()
    } finally {
      refreshing.value = false
    }
  }

  async function retry() {
    const op = failed
    if (!op) return
    error.value = null
    await op()
  }

  function offer(page: mastodon.v1.Status[], nextMaxId?: string | null) {
    batch(() => {
      // Page data comes from the public API, which knows nothing of the
      // reader: its copy of a post the reader favourited says it is not.
      // `mergeStatus` takes edits and counts from it and keeps the flags.
      const ids = page.map((s) => mergeStatus(s).id)
      syncedAt.value = Date.now()
      if (statusIds.value.length === 0) {
        statusIds.value = ids
        // The page names where the next one starts.
        const next = nextMaxId === undefined ? ids[ids.length - 1] ?? null : nextMaxId
        hasMore.value = next != null
        nextMaxIdForFirstLoadMore = next
        nextCursor = undefined
        firstLoadConsumed = false
        return
      }
      // The page is newest first, so everything above the first post the
      // list already shows is new to the reader, including posts below one
      // a check has already put in the buffer.
      const shown = new Set(statusIds.value)
      const cut = ids.findIndex((id) => shown.has(id))
      const fresh = cut === -1 ? ids : ids.slice(0, cut)
      if (fresh.length > 0) buffer(fresh)
    })
  }

  function applyNewPosts() {
    if (newPostIds.value.length === 0) return
    statusIds.value = Array.from(new Set([...newPostIds.value, ...statusIds.value]))
    newPostIds.value = []
  }

  // test-only — do not use in production code
  function _testOnlyPrepend(xs: mastodon.v1.Status[]): void {
    buffer(ingest(xs))
  }

  return {
    statusIds, statuses, loading, error, hasMore, refreshing, syncedAt,
    newPosts, newPostsCount,
    load, loadMore, poll, applyNewPosts, refresh, retry, offer, _testOnlyPrepend,
  }
}
