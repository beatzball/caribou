import { computed, signal, type ReadonlySignal } from '@preact/signals-core'
import type {
  CaribouClient, CaribouError, TimelineKind,
} from '@beatzball/caribou-mastodon-client'
import type { mastodon } from 'masto'
import { cacheStatus, statusCache } from './caches.js'

export interface TimelineStore {
  statusIds:     ReadonlySignal<string[]>
  statuses:      ReadonlySignal<mastodon.v1.Status[]>
  loading:       ReadonlySignal<boolean>
  error:         ReadonlySignal<CaribouError | null>
  hasMore:       ReadonlySignal<boolean>
  newPosts:      ReadonlySignal<mastodon.v1.Status[]>
  newPostsCount: ReadonlySignal<number>

  load(): Promise<void>
  loadMore(): Promise<void>
  poll(): Promise<void>
  applyNewPosts(): void
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
    for (const s of page) cacheStatus(s)
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

  if (opts.initial) {
    for (const s of opts.initial.statuses) cacheStatus(s)
    statusIds.value = opts.initial.statuses.map((s) => s.id)
    hasMore.value = opts.initial.nextMaxId != null
    firstLoadConsumed = true
    nextMaxIdForFirstLoadMore = opts.initial.nextMaxId
  }

  async function runFetch(params: { sinceId?: string; maxId?: string; limit?: number } | undefined) {
    const client = opts.clientSource()
    if (!client) return []
    return client.fetchTimeline(kind, params)
  }

  async function load() {
    if (firstLoadConsumed) {
      firstLoadConsumed = false
      return
    }
    loading.value = true
    error.value = null
    try {
      const page = await runFetch(undefined)
      statusIds.value = ingest(page)
      hasMore.value = page.length > 0
    } catch (err) {
      error.value = err as CaribouError
    } finally {
      loading.value = false
    }
  }

  async function loadMore() {
    if (loading.value || !hasMore.value) return
    const anchor = nextMaxIdForFirstLoadMore ?? statusIds.value[statusIds.value.length - 1]
    if (!anchor) return
    nextMaxIdForFirstLoadMore = null
    loading.value = true
    try {
      const page = await runFetch({ maxId: anchor })
      statusIds.value = [...statusIds.value, ...ingest(page)]
      hasMore.value = page.length > 0
    } catch (err) {
      error.value = err as CaribouError
    } finally {
      loading.value = false
    }
  }

  async function poll() {
    const first = statusIds.value[0]
    if (!first) return
    try {
      const page = await runFetch({ sinceId: first })
      const ids = ingest(page)
      if (ids.length === 0) return
      const merged = [...ids, ...newPostIds.value]
      newPostIds.value = Array.from(new Set(merged))
    } catch (err) {
      error.value = err as CaribouError
    }
  }

  function applyNewPosts() {
    if (newPostIds.value.length === 0) return
    statusIds.value = [...newPostIds.value, ...statusIds.value]
    newPostIds.value = []
  }

  return {
    statusIds, statuses, loading, error, hasMore,
    newPosts, newPostsCount,
    load, loadMore, poll, applyNewPosts,
  }
}
