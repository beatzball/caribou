import { batch, computed, signal, type ReadonlySignal } from '@preact/signals-core'
import {
  mastodonTimelineOrder,
  type CaribouClient, type CaribouError, type TimelineKind, type TimelineOrder, type TimelinePage,
  type Status,
} from '@beatzball/caribou-mastodon-client'
import { cacheStatus, mergeStatus, statusCache } from './caches.js'
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
  /** True while `refresh()` is fetching in the background. */
  refreshing:    ReadonlySignal<boolean>
  /** When the list was last fetched or seeded (epoch ms), or 0 before. */
  syncedAt:      ReadonlySignal<number>
  newPosts:      ReadonlySignal<Status[]>
  newPostsCount: ReadonlySignal<number>
  /**
   * True when a page came in that shares no post with the buffer or the
   * list, in a timeline kept in feed order (`timelineOrder()` is null).
   * Nothing says where such a page goes, so it is kept aside, and
   * `applyNewPosts()` replaces the list with it instead of merging. Never
   * true for a sorted timeline. No view shows it yet.
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
   * page goes as the list itself, and `nextMaxId` says where the next page
   * starts (its last post when not given).
   */
  offer(page: Status[], nextMaxId?: string | null): void
  /** Runs the last fetch that failed again, if any. */
  retry(): Promise<void>

  /** Test-only — do not use in production code. Injects statuses directly
   *  into the new-posts buffer so integration tests can drive applyNewPosts
   *  without a real Mastodon client. */
  _testOnlyPrepend(xs: Status[]): void
}

export type TimelineOp = 'load' | 'loadMore' | 'poll'

/**
 * Merges a page into a buffer kept in the order the feed sent. Pages can
 * land out of order (late page data, two checks in flight), so arrival says
 * nothing about which page is fresher. A post already buffered or shown
 * keeps its place. Each run of new posts goes in beside its neighbors in
 * the page: just above the next older post the store knows, else just
 * below the next newer one. A run whose older neighbor is shown goes at the
 * buffer's end, right above the list. The page must hold at least one
 * post the store knows: a page with none is a gap, and is never merged.
 */
function mergeFeedOrder(
  buffered: readonly string[], page: readonly string[], shown: ReadonlySet<string>,
): string[] {
  const out = [...buffered]
  const known = (id: string) => shown.has(id) || out.includes(id)
  let i = 0
  while (i < page.length) {
    if (known(page[i]!)) { i += 1; continue }
    const run: string[] = []
    const seen = new Set<string>()
    let j = i
    for (; j < page.length && !known(page[j]!); j += 1) {
      if (!seen.has(page[j]!)) { seen.add(page[j]!); run.push(page[j]!) }
    }
    const older = page[j]
    const newer = i > 0 ? page[i - 1] : undefined
    let at: number
    if (older !== undefined) at = shown.has(older) ? out.length : out.indexOf(older)
    else at = shown.has(newer!) ? out.length : out.indexOf(newer!) + 1
    out.splice(at, 0, ...run)
    i = j
  }
  return out
}

export interface CreateTimelineStoreOpts {
  clientSource: () => CaribouClient | null
  pollIntervalMs?: number
  initial?: { statuses: Status[]; nextMaxId: string | null }
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
  const gap        = signal(false)

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

  function ingest(page: Status[]): string[] {
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
    // A merge: a copy cached earlier with the reader's token keeps its
    // reader state (filters, flags) over the server's token-less one.
    for (const s of opts.initial.statuses) mergeStatus(s)
    statusIds.value = opts.initial.statuses.map((s) => s.id)
    hasMore.value = opts.initial.nextMaxId != null
    firstLoadConsumed = true
    nextMaxIdForFirstLoadMore = opts.initial.nextMaxId
    syncedAt.value = Date.now()
  }

  async function runFetch(
    params: { sinceId?: string; maxId?: string; limit?: number } | undefined,
    client = opts.clientSource(),
  ): Promise<TimelinePage> {
    if (!client) return []
    return client.fetchTimeline(kind, params)
  }

  // Stamps each page request when it starts. Of two gap pages, the one
  // whose request started last is kept.
  let requestSeq = 0
  // The newest gap page, with where the page after it starts.
  let gapPage: { seq: number; ids: string[]; cursor: string | null | undefined } | null = null

  // Counts each time the list is loaded again from the top. A check that
  // started before then asked about a list that is gone.
  let listEpoch = 0
  // The check in flight, if any. A check while one is in flight joins it:
  // two checks from the same top can finish in reverse order with pages
  // that share no post, and nothing in either page says which is newer.
  let inFlightPoll: Promise<void> | null = null

  // A page that names its cursor also says whether there is a next page, so
  // the store does not ask once more only to learn the list has ended.
  function setPaging(page: TimelinePage) {
    nextCursor = page.nextMaxId ?? undefined
    hasMore.value = page.length > 0 && page.nextMaxId !== null
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

  // The client says how this timeline is ordered: Mastodon sorts by post
  // id, newest first, except bookmarks; a feed whose ids say nothing of age
  // keeps the order it was sent in. With no client the page came from a
  // Mastodon server's public API.
  function order(): TimelineOrder {
    const client = opts.clientSource()
    return client ? client.timelineOrder(kind) : mastodonTimelineOrder(kind)
  }

  // Posts go to the buffer only when the list does not show them yet; a
  // post can come back from the page data and from a check at once. A page
  // can also bring posts older than one a check already found, so the
  // buffer is kept in the timeline's order: sorted, or merged by feed order.
  //
  // A feed kept in sent order merges a page only by a post the store knows
  // (spec 6.3, seam 7). A page with none is a gap: it is kept aside, never
  // put on top, since nothing says it is newer than the buffer. `seq` is
  // when its request started; `cursor` where the page after it starts.
  function buffer(ids: string[], seq: number, cursor?: string | null) {
    const shown = new Set(statusIds.value)
    const compare = order()
    if (compare) {
      const next = Array.from(new Set([...ids, ...newPostIds.value])).filter((id) => !shown.has(id))
      newPostIds.value = next.sort(compare)
      return
    }
    const buffered = new Set(newPostIds.value)
    if (ids.some((id) => shown.has(id) || buffered.has(id))) {
      newPostIds.value = mergeFeedOrder(newPostIds.value, ids, shown)
      return
    }
    if (!gapPage || seq > gapPage.seq) {
      gapPage = { seq, ids: Array.from(new Set(ids)), cursor }
      gap.value = true
    }
  }

  function clearGap() {
    gapPage = null
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
    clearGap()
    loading.value = true
    succeed()
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
      if (generation === ownerGeneration()) fail(err, 'load')
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
    // The buffer holds posts newer than the list, so ask from its top.
    const first = newPostIds.value[0] ?? statusIds.value[0]
    if (!first) return
    const generation = ownerGeneration()
    const epoch = listEpoch
    const seq = ++requestSeq
    const client = opts.clientSource()
    // A check that lands for another account, or for a list loaded again
    // since it started, is dropped; the next check asks again.
    const stale = () => generation !== ownerGeneration() || epoch !== listEpoch
      || opts.clientSource()?.userKey !== client?.userKey
    try {
      const page = await runFetch({ sinceId: first }, client)
      if (stale()) return
      batch(() => {
        syncedAt.value = Date.now()
        // A failed check earlier left an error; this one worked.
        if (!olderPagePending()) succeed()
        const ids = ingest(page)
        if (ids.length > 0) buffer(ids, seq, page.nextMaxId)
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

  function offer(page: Status[], nextMaxId?: string | null) {
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
        const next = nextMaxId === undefined ? ids[ids.length - 1] ?? null : nextMaxId
        hasMore.value = next != null
        nextMaxIdForFirstLoadMore = next
        nextCursor = undefined
        firstLoadConsumed = false
        return
      }
      // The page is newest first, so everything above the first post the
      // list already shows is new to the reader, including posts below one
      // a check has already put in the buffer. That shown post goes along
      // as the anchor for a feed kept in sent order; a sorted one drops it.
      // Stamped when it arrives: `offer()` is not told when the page-data
      // fetch began, so a page that started before a check but lands after
      // its start counts as the newer request.
      const shown = new Set(statusIds.value)
      const cut = ids.findIndex((id) => shown.has(id))
      const upTo = cut === -1 ? ids : ids.slice(0, cut + 1)
      if (cut !== 0 && upTo.length > 0) buffer(upTo, ++requestSeq, nextMaxId)
    })
  }

  function applyNewPosts() {
    if (gapPage) {
      // The gap page replaces the list; the buffer belonged to the old one.
      const { ids, cursor } = gapPage
      batch(() => {
        listEpoch += 1
        clearGap()
        statusIds.value = ids
        newPostIds.value = []
        const next = cursor === undefined ? ids[ids.length - 1] ?? null : cursor
        hasMore.value = next != null
        nextMaxIdForFirstLoadMore = next
        nextCursor = undefined
      })
      return
    }
    if (newPostIds.value.length === 0) return
    statusIds.value = Array.from(new Set([...newPostIds.value, ...statusIds.value]))
    newPostIds.value = []
  }

  // test-only — do not use in production code
  function _testOnlyPrepend(xs: Status[]): void {
    buffer(ingest(xs), ++requestSeq)
  }

  return {
    statusIds, statuses, loading, error, failedOp, hasMore, refreshing, syncedAt,
    newPosts, newPostsCount, gap,
    load, loadMore, poll, applyNewPosts, refresh, retry, offer, _testOnlyPrepend,
  }
}
