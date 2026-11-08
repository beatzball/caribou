import { LRUCache } from 'lru-cache'

export const TTL = {
  PUBLIC_TIMELINE:   15_000,
  STATUS:            60_000,
  THREAD_CONTEXT:    60_000,
  PROFILE:          300_000,
  PROFILE_STATUSES:  60_000,
  // The public AppView answers with `max-age=30` (spec 8.1), for each of
  // the three calls a signed-out Bluesky page makes.
  BLUESKY_PROFILE:     30_000,
  BLUESKY_AUTHOR_FEED: 30_000,
  BLUESKY_THREAD:      30_000,
  // Bluesky's label definitions change rarely (spec 7.4: refresh hourly).
  BLUESKY_LABEL_DEFS: 3_600_000,
} as const

/**
 * An upstream answer that was not 2xx. The message is the same as before
 * (`upstream <status> <url>`); `status` and `retryAfter` (the raw
 * `Retry-After` header, or null) let a caller tell a 429 from the rest.
 */
export class UpstreamError extends Error {
  constructor(readonly status: number, readonly retryAfter: string | null, url: string) {
    super(`upstream ${status} ${url}`)
    this.name = 'UpstreamError'
  }
}

const lru = new LRUCache<string, { value: unknown; expiresAt: number }>({ max: 5_000 })
const inflight = new Map<string, Promise<unknown>>()

export async function cachedFetch<T>(url: string, ttlMs: number, init: Pick<RequestInit, 'redirect'> = {}): Promise<T> {
  const now = Date.now()
  const cached = lru.get(url)
  if (cached && cached.expiresAt > now) return cached.value as T

  const existing = inflight.get(url)
  if (existing) return existing as Promise<T>

  const promise = (async () => {
    try {
      const res = await fetch(url, { ...init, headers: { accept: 'application/json' } })
      // Never cached: an error or a 429 is asked again next time.
      if (!res.ok) throw new UpstreamError(res.status, res.headers.get('retry-after'), url)
      const value = (await res.json()) as T
      lru.set(url, { value, expiresAt: Date.now() + ttlMs })
      return value
    } finally {
      inflight.delete(url)
    }
  })()

  inflight.set(url, promise)
  return promise as Promise<T>
}
