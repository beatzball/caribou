import { computed, signal, type ReadonlySignal } from '@preact/signals-core'
import type {
  CaribouClient, CaribouError, Status, TimelinePage,
} from '@beatzball/caribou-mastodon-client'
import { cacheStatus, mergeStatus, readAs, statusCache, type CopySource } from './caches.js'

export type ProfileTab = 'posts' | 'replies' | 'media'

export interface ProfileStore {
  statusIds: ReadonlySignal<string[]>
  statuses:  ReadonlySignal<Status[]>
  loading:   ReadonlySignal<boolean>
  error:     ReadonlySignal<CaribouError | null>
  hasMore:   ReadonlySignal<boolean>
  /**
   * Where the next older page starts, as the last page named it: opaque,
   * passed back to the client as it came. Null before the first page and
   * after the last.
   */
  nextCursor: ReadonlySignal<string | null>
  load(): Promise<void>
  loadMore(): Promise<void>
}

export interface CreateProfileStoreOpts {
  clientSource: () => CaribouClient | null
  /** The server's first page and the cursor it named for the next one. */
  initial?: { statuses: Status[]; nextCursor: string | null }
}

export function createProfileStore(
  accountId: string,
  tab: ProfileTab,
  opts: CreateProfileStoreOpts,
): ProfileStore {
  const statusIds = signal<string[]>([])
  const loading   = signal(false)
  const error     = signal<CaribouError | null>(null)
  const hasMore   = signal(true)
  // Never derived from a status id: on another network it is not one.
  const cursor    = signal<string | null>(null)

  const statuses = computed<Status[]>(() => {
    const cache = statusCache.value
    return statusIds.value
      .map((id) => cache.get(id))
      .filter((s): s is Status => !!s)
  })

  let firstLoadConsumed = false
  if (opts.initial) {
    // A merge: a copy cached earlier with the reader's token keeps its
    // reader state (filters, flags) over the server's token-less one.
    for (const s of opts.initial.statuses) mergeStatus(s)
    statusIds.value = opts.initial.statuses.map((s) => s.id)
    hasMore.value = opts.initial.nextCursor != null
    cursor.value = opts.initial.nextCursor
    firstLoadConsumed = true
  }

  async function runFetch(cursor?: string): Promise<[TimelinePage, CopySource | undefined]> {
    const client = opts.clientSource()
    if (!client) return [Object.assign([], { nextCursor: null }), undefined]
    return readAs(client, () => client.fetchAccountStatuses(accountId, { tab, cursor }))
  }

  // A page that names no cursor is the last one. Only that ends the list:
  // an empty page with a cursor is not the end (README, "SSR seeding").
  function setPaging(page: TimelinePage) {
    cursor.value = page.nextCursor ?? null
    hasMore.value = cursor.value !== null
  }

  async function load() {
    if (firstLoadConsumed) {
      firstLoadConsumed = false
      return
    }
    loading.value = true
    error.value = null
    try {
      const [page, source] = await runFetch(undefined)
      for (const s of page) cacheStatus(s, source)
      statusIds.value = page.map((s) => s.id)
      setPaging(page)
    } catch (err) {
      error.value = err as CaribouError
    } finally {
      loading.value = false
    }
  }

  async function loadMore() {
    if (loading.value || !hasMore.value) return
    const anchor = cursor.value
    if (!anchor) return
    loading.value = true
    try {
      const [page, source] = await runFetch(anchor)
      for (const s of page) cacheStatus(s, source)
      statusIds.value = [...statusIds.value, ...page.map((s) => s.id)]
      setPaging(page)
    } catch (err) {
      // The cursor is unchanged: the next try asks from the same place.
      error.value = err as CaribouError
    } finally {
      loading.value = false
    }
  }

  return { statusIds, statuses, loading, error, hasMore, nextCursor: cursor, load, loadMore }
}
