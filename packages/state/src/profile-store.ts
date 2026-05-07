import { computed, signal, type ReadonlySignal } from '@preact/signals-core'
import type { mastodon } from 'masto'
import type { CaribouClient, CaribouError } from '@beatzball/caribou-mastodon-client'
import { cacheStatus, statusCache } from './caches.js'

export type ProfileTab = 'posts' | 'replies' | 'media'

export interface ProfileStore {
  statusIds: ReadonlySignal<string[]>
  statuses:  ReadonlySignal<mastodon.v1.Status[]>
  loading:   ReadonlySignal<boolean>
  error:     ReadonlySignal<CaribouError | null>
  hasMore:   ReadonlySignal<boolean>
  load(): Promise<void>
  loadMore(): Promise<void>
}

export interface CreateProfileStoreOpts {
  clientSource: () => CaribouClient | null
  initial?: { statuses: mastodon.v1.Status[]; nextMaxId: string | null }
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

  const statuses = computed<mastodon.v1.Status[]>(() => {
    const cache = statusCache.value
    return statusIds.value
      .map((id) => cache.get(id))
      .filter((s): s is mastodon.v1.Status => !!s)
  })

  let firstLoadConsumed = false
  if (opts.initial) {
    for (const s of opts.initial.statuses) cacheStatus(s)
    statusIds.value = opts.initial.statuses.map((s) => s.id)
    hasMore.value = opts.initial.nextMaxId != null
    firstLoadConsumed = true
  }

  async function runFetch(maxId?: string): Promise<mastodon.v1.Status[]> {
    const client = opts.clientSource()
    if (!client) return []
    return client.fetchAccountStatuses(accountId, { tab, maxId })
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
      for (const s of page) cacheStatus(s)
      statusIds.value = page.map((s) => s.id)
      hasMore.value = page.length > 0
    } catch (err) {
      error.value = err as CaribouError
    } finally {
      loading.value = false
    }
  }

  async function loadMore() {
    if (loading.value || !hasMore.value) return
    const last = statusIds.value[statusIds.value.length - 1]
    if (!last) return
    loading.value = true
    try {
      const page = await runFetch(last)
      for (const s of page) cacheStatus(s)
      statusIds.value = [...statusIds.value, ...page.map((s) => s.id)]
      hasMore.value = page.length > 0
    } catch (err) {
      error.value = err as CaribouError
    } finally {
      loading.value = false
    }
  }

  return { statusIds, statuses, loading, error, hasMore, load, loadMore }
}
