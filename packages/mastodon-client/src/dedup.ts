export interface Dedup {
  run<T>(key: string, fn: () => Promise<T>): Promise<T>
}

export function createDedup(): Dedup {
  const inflight = new Map<string, Promise<unknown>>()
  return {
    async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const existing = inflight.get(key) as Promise<T> | undefined
      if (existing) return existing
      const p = (async () => {
        try {
          return await fn()
        } finally {
          inflight.delete(key)
        }
      })()
      inflight.set(key, p)
      return p
    },
  }
}
