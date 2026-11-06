import { batch, computed, signal, type ReadonlySignal } from '@preact/signals-core'
import {
  mastodonTimelineOrder,
  type CaribouClient, type CaribouError, type TimelineKind, type TimelineOrder, type TimelinePage,
  type Status,
} from '@beatzball/caribou-mastodon-client'
import { cacheStatus, mergeStatus, readAs, readerNow, statusCache, type CopySource } from './caches.js'
import { ownerGeneration } from './keep-alive.js'

export interface TimelineStore {
  statusIds:     ReadonlySignal<string[]>
  statuses:      ReadonlySignal<Status[]>
  loading:       ReadonlySignal<boolean>
  error:         ReadonlySignal<CaribouError | null>
  /**
   * Which fetch set `error`, so the view can show it where it belongs. It is
   * set and cleared together with `error`: null whenever `error` is null.
   */
  failedOp:      ReadonlySignal<TimelineOp | null>
  hasMore:       ReadonlySignal<boolean>
  /**
   * Where the next older page starts, as the last page named it: opaque,
   * passed back to the client as it came. Null before the first page and
   * after the last.
   */
  nextCursor:    ReadonlySignal<string | null>
  /** True while `refresh()` is fetching in the background. */
  refreshing:    ReadonlySignal<boolean>
  /** When the list was last fetched or seeded (epoch ms), or 0 before. */
  syncedAt:      ReadonlySignal<number>
  newPosts:      ReadonlySignal<Status[]>
  newPostsCount: ReadonlySignal<number>
  /**
   * In a timeline kept in feed order (`timelineOrder()` is null): true when
   * the last check's answer did not reach the top post the list shows, so
   * nothing joins it to the list. `newPosts` then holds that answer, and
   * `applyNewPosts()` replaces the list with it instead of adding it on
   * top. Never true for a sorted timeline. No view shows it yet.
   */
  gap:           ReadonlySignal<boolean>

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
   * page goes as the list itself, and `nextCursor` says where the next page
   * starts (null: there is none).
   */
  offer(page: Status[], nextCursor: string | null): void
  /** Runs the last fetch that failed again, if any. */
  retry(): Promise<void>

  /** Test-only — do not use in production code. Injects statuses directly
   *  into the new-posts buffer so integration tests can drive applyNewPosts
   *  without a real Mastodon client. */
  _testOnlyPrepend(xs: Status[]): void
}

export type TimelineOp = 'load' | 'loadMore' | 'poll'

export interface CreateTimelineStoreOpts {
  clientSource: () => CaribouClient | null
  pollIntervalMs?: number
  initial?: { statuses: Status[]; nextCursor: string | null }
}

export function createTimelineStore(kind: TimelineKind, opts: CreateTimelineStoreOpts): TimelineStore {
  const statusIds  = signal<string[]>([])
  const loading    = signal(false)
  const error      = signal<CaribouError | null>(null)
  const failedOp   = signal<TimelineOp | null>(null)
  const hasMore    = signal(true)
  const newPostIds = signal<string[]>([])
  const refreshing = signal(false)
  const syncedAt   = signal(0)
  // The cursor the last page named. It lives here and not in the client,
  // because `activeClient` is a new client whenever `users` changes. It is
  // never derived from a status id: on another network it is not one.
  const cursor     = signal<string | null>(null)
  const gap        = signal(false)
  // Where the page after the gap answer starts, for when it becomes the list.
  let gapCursor: string | null = null

  const statuses = computed<Status[]>(() => {
    const cache = statusCache.value
    return statusIds.value
      .map((id) => cache.get(id))
      .filter((s): s is Status => !!s)
  })
  const newPosts = computed<Status[]>(() => {
    const cache = statusCache.value
    return newPostIds.value
      .map((id) => cache.get(id))
      .filter((s): s is Status => !!s)
  })
  const newPostsCount = computed(() => newPostIds.value.length)

  function ingest(page: Status[], source: CopySource): string[] {
    batch(() => { for (const s of page) cacheStatus(s, source) })
    return page.map((s) => s.id)
  }

  // Track whether the SSR-seeded first page has been "consumed": the first
  // load() after construction is a no-op when seeded (the SSR pageData
  // already paid for that fetch). Subsequent load()s run normally. The
  // first loadMore() starts from `opts.initial.nextCursor`: the SSR fetcher
  // knows where the next page starts.
  let firstLoadConsumed = false

  if (opts.initial) {
    // A merge: a copy cached earlier with the reader's token keeps its
    // reader state (filters, flags) over the server's token-less one.
    for (const s of opts.initial.statuses) mergeStatus(s)
    statusIds.value = opts.initial.statuses.map((s) => s.id)
    hasMore.value = opts.initial.nextCursor != null
    firstLoadConsumed = true
    cursor.value = opts.initial.nextCursor
    syncedAt.value = Date.now()
  }

  // Counts each time the list starts again from a new top: a load, a page
  // into an empty list, a gap applied. A fetch that started before then
  // asked about a list that is gone, and is dropped.
  let listEpoch = 0
  // The check in flight, if any. A check while one is in flight joins it,
  // so the last check to finish is always the last one started.
  let inFlightPoll: Promise<void> | null = null

  // The client says how this timeline is ordered: Mastodon sorts by post
  // id, newest first, except bookmarks; a feed whose ids say nothing of age
  // keeps the order it was sent in. With no client the page came from a
  // Mastodon server's public API.
  function order(): TimelineOrder {
    const client = opts.clientSource()
    return client ? client.timelineOrder(kind) : mastodonTimelineOrder(kind)
  }

  async function runFetch(
    params: { sinceId?: string; cursor?: string; limit?: number } | undefined,
    client = opts.clientSource(),
  ): Promise<[TimelinePage, CopySource]> {
    if (!client) return [Object.assign([], { nextCursor: null }), readerNow()]
    return readAs(client, () => client.fetchTimeline(kind, params))
  }

  // A page that names no cursor is the last one, so the store does not ask
  // once more only to learn the list has ended.
  function setPaging(page: TimelinePage) {
    cursor.value = page.nextCursor ?? null
    hasMore.value = page.length > 0 && cursor.value !== null
  }

  // The operation `retry()` runs again: the last one that failed.
  const ops: Record<TimelineOp, () => Promise<void>> = {
    load: () => load(), loadMore: () => loadMore(), poll: () => poll(),
  }
  function fail(err: unknown, op: TimelineOp) {
    batch(() => {
      error.value = err as CaribouError
      failedOp.value = op
    })
  }
  function succeed() {
    batch(() => {
      error.value = null
      failedOp.value = null
    })
  }

  // A failed older page waits for the reader. The reader is at the bottom,
  // looking at its Retry, so a background check neither takes that place
  // when it fails nor clears it when it works. A check that works says
  // nothing about the older page, and clearing the error would start
  // infinite scroll again on its own: an automatic retry the reader did not
  // ask for. The error stays until the reader presses Retry (or a reload
  // starts the list again). While that Retry runs the error is cleared, but
  // the older page is still pending, so a check in that window keeps out
  // of the way too.
  let retryingOlder = false
  const olderPagePending = () => failedOp.value === 'loadMore' || retryingOlder

  // A sorted timeline. Posts go to the buffer only when the list does not
  // show them yet; a post can come back from the page data and from a check
  // at once. A page can also bring posts older than one a check already
  // found, so the buffer is kept in the client's order.
  function buffer(ids: string[], compare: NonNullable<TimelineOrder>) {
    const shown = new Set(statusIds.value)
    const next = Array.from(new Set([...ids, ...newPostIds.value])).filter((id) => !shown.has(id))
    newPostIds.value = next.sort(compare)
  }

  // A timeline in feed order. Ids say nothing of age, so two pages cannot
  // be put in order by their posts, nor by when they arrived. So there is
  // one source and one answer: each check asks from the top post the list
  // shows, its answer is every new entry, and the newest answer replaces the
  // last (spec 6.3, seam 7). An answer that reaches the top shown post puts
  // the entries above it in the buffer. One that does not is a gap: nothing
  // joins it to the list, so applying it replaces the list.
  function answer(page: TimelinePage, ids: string[]) {
    const top = statusIds.value[0]
    const unique = Array.from(new Set(ids))
    const at = top === undefined ? -1 : unique.indexOf(top)
    if (at !== -1 || unique.length === 0) {
      newPostIds.value = at === -1 ? [] : unique.slice(0, at)
      clearGap()
      return
    }
    newPostIds.value = unique
    gapCursor = page.nextCursor ?? null
    gap.value = true
  }

  function clearGap() {
    gapCursor = null
    gap.value = false
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
    listEpoch += 1
    loading.value = true
    succeed()
    try {
      const [page, source] = await runFetch(undefined)
      if (generation !== ownerGeneration()) return
      batch(() => {
        statusIds.value = ingest(page, source)
        setPaging(page)
        syncedAt.value = Date.now()
        succeed()
        // A gap answer belonged to the old list's top.
        if (gap.value) {
          newPostIds.value = []
          clearGap()
        }
      })
    } catch (err) {
      if (generation === ownerGeneration()) fail(err, 'load')
    } finally {
      loading.value = false
    }
  }

  async function loadMore() {
    if (loading.value || !hasMore.value) return
    const anchor = cursor.value
    if (!anchor) return
    const generation = ownerGeneration()
    const epoch = listEpoch
    loading.value = true
    try {
      const [page, source] = await runFetch({ cursor: anchor })
      // The list started again from a new top while this page was out: it
      // belongs to the old list.
      if (generation !== ownerGeneration() || epoch !== listEpoch) return
      batch(() => {
        statusIds.value = [...statusIds.value, ...ingest(page, source)]
        setPaging(page)
        succeed()
      })
    } catch (err) {
      if (generation !== ownerGeneration() || epoch !== listEpoch) return
      // The cursor is unchanged: the next try asks from the same place.
      fail(err, 'loadMore')
    } finally {
      loading.value = false
    }
  }

  function poll(): Promise<void> {
    if (inFlightPoll) return inFlightPoll
    const run = checkOnce().finally(() => { if (inFlightPoll === run) inFlightPoll = null })
    inFlightPoll = run
    return run
  }

  async function checkOnce() {
    const compare = order()
    // A sorted buffer holds posts newer than the list, so ask from its top.
    // A feed asks from the top shown post: its answer is every new entry.
    const first = compare ? newPostIds.value[0] ?? statusIds.value[0] : statusIds.value[0]
    if (!first) return
    const generation = ownerGeneration()
    const epoch = listEpoch
    const client = opts.clientSource()
    // A check that lands for another account, or for a list that started
    // again since it went out, is dropped; the next check asks again.
    const stale = () => generation !== ownerGeneration() || epoch !== listEpoch
      || opts.clientSource()?.userKey !== client?.userKey
    try {
      const [page, source] = await runFetch({ sinceId: first }, client)
      if (stale()) return
      batch(() => {
        syncedAt.value = Date.now()
        // A failed check earlier left an error; this one worked.
        if (!olderPagePending()) succeed()
        const ids = ingest(page, source)
        if (!compare) answer(page, ids)
        else if (ids.length > 0) buffer(ids, compare)
      })
    } catch (err) {
      if (!stale() && !olderPagePending()) fail(err, 'poll')
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
    const op = failedOp.value
    if (!op) return
    succeed()
    if (op !== 'loadMore') return ops[op]()
    retryingOlder = true
    try {
      await ops[op]()
    } finally {
      retryingOlder = false
    }
  }

  function offer(page: Status[], nextCursor: string | null) {
    batch(() => {
      // Page data comes from the public API, which knows nothing of the
      // reader: its copy of a post the reader favourited says it is not.
      // `mergeStatus` takes edits and counts from it and keeps the flags.
      const ids = page.map((s) => mergeStatus(s).id)
      syncedAt.value = Date.now()
      if (statusIds.value.length === 0) {
        listEpoch += 1
        clearGap()
        statusIds.value = ids
        // The page names where the next one starts.
        hasMore.value = nextCursor != null
        cursor.value = nextCursor
        firstLoadConsumed = false
        return
      }
      // A feed takes new entries from its checks only. Page data is fetched
      // on its own, so nothing says whether it is newer or older than the
      // last check's answer; the next check sees the same entries anyway.
      const compare = order()
      if (!compare) return
      // The page is newest first, so everything above the first post the
      // list already shows is new to the reader, including posts below one
      // a check has already put in the buffer.
      const shown = new Set(statusIds.value)
      const cut = ids.findIndex((id) => shown.has(id))
      const fresh = cut === -1 ? ids : ids.slice(0, cut)
      if (fresh.length > 0) buffer(fresh, compare)
    })
  }

  function applyNewPosts() {
    if (gap.value) {
      // Nothing joins the answer to the list, so it becomes the list.
      batch(() => {
        listEpoch += 1
        statusIds.value = newPostIds.value
        newPostIds.value = []
        cursor.value = gapCursor
        hasMore.value = gapCursor !== null
        clearGap()
      })
      return
    }
    if (newPostIds.value.length === 0) return
    statusIds.value = Array.from(new Set([...newPostIds.value, ...statusIds.value]))
    newPostIds.value = []
  }

  // test-only — do not use in production code
  function _testOnlyPrepend(xs: Status[]): void {
    const ids = ingest(xs, readerNow())
    const compare = order()
    if (compare) buffer(ids, compare)
    else newPostIds.value = Array.from(new Set([...ids, ...newPostIds.value]))
  }

  return {
    statusIds, statuses, loading, error, failedOp, hasMore, nextCursor: cursor, refreshing, syncedAt,
    newPosts, newPostsCount, gap,
    load, loadMore, poll, applyNewPosts, refresh, retry, offer, _testOnlyPrepend,
  }
}
