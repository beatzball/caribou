import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'
import { LRUCache } from 'lru-cache'
import { guardedGet, httpsTransport, isHostName, type LookupFn, type Transport } from './ssrf-guard.js'

// `com.atproto.identity.resolveHandle` for the browser OAuth client. The
// rules, and the tests for each, are in apps/caribou/README.md, "Bluesky
// sign-in endpoints" (rules 1–3, 8 and 9). The connection rules live in
// ssrf-guard.ts.

const RESERVED_TLDS = new Set(['alt', 'arpa', 'example', 'internal', 'invalid', 'local', 'localhost', 'onion', 'test'])

/** The lowercased handle when `raw` is a valid atproto handle (rule 1), else null. */
export function normalizeHandle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const handle = raw.toLowerCase()
  if (isIP(handle) || !isHostName(handle)) return null
  const tld = handle.slice(handle.lastIndexOf('.') + 1)
  return RESERVED_TLDS.has(tld) ? null : handle
}

const DID_PLC = /^did:plc:[a-z2-7]{24}$/
// did:web: a host name, with an optional percent-encoded port (%3A).
const DID_WEB = /^did:web:[a-z0-9.-]+(%3[aA]\d{1,5})?$/

/** Whether `s` is a DID atproto resolves: did:plc or did:web (rule 3). */
export function isAtprotoDid(s: string): boolean {
  if (DID_PLC.test(s)) return true
  if (!DID_WEB.test(s)) return false
  return isHostName(s.slice('did:web:'.length).replace(/%3a\d+$/i, ''))
}

export interface HandleResolverDeps {
  resolveTxt: (name: string) => Promise<string[][]>
  lookup: LookupFn
  transport: Transport
  timeoutMs: number
  now?: () => number
}

export const CACHE_TTL_MS = 5 * 60_000

async function fromDns(handle: string, deps: HandleResolverDeps): Promise<string | null> {
  let records: string[][]
  try {
    records = await deps.resolveTxt(`_atproto.${handle}`)
  } catch {
    return null
  }
  const dids = new Set(
    records.map((chunks) => chunks.join('')).filter((r) => r.startsWith('did=')).map((r) => r.slice(4)),
  )
  if (dids.size !== 1) return null
  const [did] = dids
  return isAtprotoDid(did!) ? did! : null
}

async function fromHttps(handle: string, deps: HandleResolverDeps, signal: AbortSignal): Promise<string | null> {
  try {
    const res = await guardedGet(`https://${handle}/.well-known/atproto-did`, {
      lookup: deps.lookup,
      transport: deps.transport,
      signal,
    })
    if (res.status !== 200) return null
    const did = res.body.trim()
    return isAtprotoDid(did) ? did : null
  } catch {
    return null
  }
}

function deadline(ms: number, signal: AbortSignal): Promise<null> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms, null)
    signal.addEventListener('abort', () => clearTimeout(t), { once: true })
  })
}

export function createHandleResolver(deps: HandleResolverDeps) {
  const now = deps.now ?? Date.now
  const cache = new LRUCache<string, { did: string | null; expiresAt: number }>({ max: 5_000 })
  const inflight = new Map<string, Promise<string | null>>()

  async function lookup(handle: string): Promise<string | null> {
    const ctrl = new AbortController()
    const work = (async () => (await fromDns(handle, deps)) ?? (await fromHttps(handle, deps, ctrl.signal)))()
    try {
      return await Promise.race([work, deadline(deps.timeoutMs, ctrl.signal)])
    } finally {
      ctrl.abort(new Error('timeout'))
    }
  }

  return {
    /** The DID for an already-normalized handle, or null. Never throws for a lookup failure. */
    async resolve(handle: string): Promise<string | null> {
      const hit = cache.get(handle)
      if (hit && hit.expiresAt > now()) return hit.did
      const running = inflight.get(handle)
      if (running) return running
      const p = lookup(handle)
        .then((did) => {
          cache.set(handle, { did, expiresAt: now() + CACHE_TTL_MS })
          return did
        })
        .finally(() => inflight.delete(handle))
      inflight.set(handle, p)
      return p
    },
  }
}

/** The per-IP rate limit and the cap on lookups at once (rule 8). */
export function createRequestLimits(opts: { perMinute: number; maxConcurrent: number; now?: () => number }) {
  const now = opts.now ?? Date.now
  const windows = new LRUCache<string, { start: number; count: number }>({ max: 10_000 })
  let running = 0
  return {
    allow(ip: string): boolean {
      const t = now()
      const w = windows.get(ip)
      if (!w || t - w.start >= 60_000) {
        windows.set(ip, { start: t, count: 1 })
        return true
      }
      w.count += 1
      return w.count <= opts.perMinute
    },
    /** A release function, or null when the cap is reached. */
    acquire(): (() => void) | null {
      if (running >= opts.maxConcurrent) return null
      running += 1
      let done = false
      return () => {
        if (!done) {
          done = true
          running -= 1
        }
      }
    },
  }
}

let resolver: ReturnType<typeof createHandleResolver> | undefined
let limits: ReturnType<typeof createRequestLimits> | undefined

const txtResolver = new dns.Resolver({ timeout: 2_000, tries: 1 })

export function getHandleResolver(): ReturnType<typeof createHandleResolver> {
  resolver ??= createHandleResolver({
    resolveTxt: (name) => txtResolver.resolveTxt(name),
    lookup: (host) => dns.lookup(host, { all: true, verbatim: true }),
    transport: httpsTransport,
    timeoutMs: 3_000,
  })
  return resolver
}

export function getRequestLimits(): ReturnType<typeof createRequestLimits> {
  limits ??= createRequestLimits({ perMinute: 30, maxConcurrent: 16 })
  return limits
}
