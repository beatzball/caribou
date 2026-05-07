import { LRUCache } from 'lru-cache'

export const TTL = {
  PUBLIC_TIMELINE:   15_000,
  STATUS:            60_000,
  THREAD_CONTEXT:    60_000,
  PROFILE:          300_000,
  PROFILE_STATUSES:  60_000,
} as const

const lru = new LRUCache<string, { value: unknown; expiresAt: number }>({ max: 5_000 })
const inflight = new Map<string, Promise<unknown>>()

export async function cachedFetch<T>(url: string, ttlMs: number): Promise<T> {
  const now = Date.now()
  const cached = lru.get(url)
  if (cached && cached.expiresAt > now) return cached.value as T

  const existing = inflight.get(url)
  if (existing) return existing as Promise<T>

  const promise = (async () => {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`upstream ${res.status} ${url}`)
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
