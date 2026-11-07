import { LRUCache } from 'lru-cache'
import {
  GuardRefusal,
  guardedGet,
  httpsTransport,
  isDnsNotFound,
  isPublicHostName,
  resolveAddresses,
  withResolver,
  type LookupFn,
  type Transport,
} from './ssrf-guard.js'

// `com.atproto.identity.resolveHandle` for the browser OAuth client. The
// rules, and the tests for each, are in apps/caribou/README.md, "Bluesky
// sign-in endpoints" (rules 1–3, 8–10). The connection rules live in
// ssrf-guard.ts.

/** The lowercased handle when `raw` is a valid atproto handle (rule 1), else null. */
export function normalizeHandle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const handle = raw.toLowerCase()
  return isPublicHostName(handle) ? handle : null
}

const DID_PLC = /^did:plc:[a-z2-7]{24}$/

/**
 * Whether `s` is a DID atproto resolves (rule 3): `did:plc`, or `did:web`
 * whose host passes rule 1. No port: atproto allows one only for
 * localhost, which rule 1 refuses.
 */
export function isAtprotoDid(s: string): boolean {
  if (DID_PLC.test(s)) return true
  if (!s.startsWith('did:web:')) return false
  const host = s.slice('did:web:'.length)
  return normalizeHandle(host) === host
}

export interface HandleResolverDeps {
  resolveTxt: (name: string, signal: AbortSignal) => Promise<string[][]>
  lookup: LookupFn
  transport: Transport
  timeoutMs: number
  maxConcurrent: number
  now?: () => number
}

/** Every lookup slot is taken (rule 10). */
export class ResolverBusy extends Error {
  override name = 'ResolverBusy'
}

export const ANSWER_TTL_MS = 5 * 60_000
export const MISS_TTL_MS = 30_000

// `miss`: a definite "no DID" (cached briefly). `transient`: the deadline or
// a passing failure (not cached).
type Outcome = { did: string } | { kind: 'miss' } | { kind: 'transient' }
const MISS: Outcome = { kind: 'miss' }
const TRANSIENT: Outcome = { kind: 'transient' }

async function fromDns(handle: string, deps: HandleResolverDeps, signal: AbortSignal): Promise<Outcome> {
  let records: string[][]
  try {
    records = await deps.resolveTxt(`_atproto.${handle}`, signal)
  } catch (err) {
    return isDnsNotFound(err) ? MISS : TRANSIENT
  }
  const dids = new Set(
    records.map((chunks) => chunks.join('')).filter((r) => r.startsWith('did=')).map((r) => r.slice(4)),
  )
  if (dids.size !== 1) return MISS
  const [did] = dids
  return isAtprotoDid(did!) ? { did: did! } : MISS
}

async function fromHttps(handle: string, deps: HandleResolverDeps, signal: AbortSignal): Promise<Outcome> {
  if (signal.aborted) return TRANSIENT
  try {
    const res = await guardedGet(`https://${handle}/.well-known/atproto-did`, {
      lookup: deps.lookup,
      transport: deps.transport,
      signal,
    })
    if (res.status !== 200) return MISS
    const did = res.body.trim()
    return isAtprotoDid(did) ? { did } : MISS
  } catch (err) {
    if (signal.aborted) return TRANSIENT
    return err instanceof GuardRefusal || isDnsNotFound(err) ? MISS : TRANSIENT
  }
}

export function createHandleResolver(deps: HandleResolverDeps) {
  const now = deps.now ?? Date.now
  const cache = new LRUCache<string, { did: string | null; expiresAt: number }>({ max: 5_000 })
  const inflight = new Map<string, Promise<string | null>>()
  let running = 0

  async function lookup(handle: string): Promise<string | null> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(new Error('timeout')), deps.timeoutMs)
    running += 1
    const work = (async (): Promise<Outcome> => {
      const dnsAnswer = await fromDns(handle, deps, ctrl.signal)
      if ('did' in dnsAnswer) return dnsAnswer
      const httpsAnswer = await fromHttps(handle, deps, ctrl.signal)
      if ('did' in httpsAnswer) return httpsAnswer
      return dnsAnswer.kind === 'miss' && httpsAnswer.kind === 'miss' ? MISS : TRANSIENT
    })()
    // The slot is held until the work itself settles, not until we answer.
    void work.catch(() => TRANSIENT).finally(() => {
      running -= 1
      clearTimeout(timer)
    })
    const deadline = new Promise<Outcome>((resolve) => {
      if (ctrl.signal.aborted) resolve(TRANSIENT)
      ctrl.signal.addEventListener('abort', () => resolve(TRANSIENT), { once: true })
    })
    const outcome = await Promise.race([work.catch(() => TRANSIENT), deadline])
    if ('did' in outcome) {
      cache.set(handle, { did: outcome.did, expiresAt: now() + ANSWER_TTL_MS })
      return outcome.did
    }
    if (outcome.kind === 'miss') cache.set(handle, { did: null, expiresAt: now() + MISS_TTL_MS })
    return null
  }

  return {
    /**
     * The DID for an already-normalized handle, or null. Never throws for a
     * lookup failure; throws `ResolverBusy` when every slot is taken.
     */
    async resolve(handle: string): Promise<string | null> {
      const hit = cache.get(handle)
      if (hit && hit.expiresAt > now()) return hit.did
      const joined = inflight.get(handle)
      if (joined) return joined
      if (running >= deps.maxConcurrent) throw new ResolverBusy('every lookup slot is taken')
      const p = lookup(handle).finally(() => inflight.delete(handle))
      inflight.set(handle, p)
      return p
    },
  }
}

/** The per-IP rate limit (rule 8). */
export function createRequestLimits(opts: { perMinute: number; now?: () => number }) {
  const now = opts.now ?? Date.now
  const windows = new LRUCache<string, { start: number; count: number }>({ max: 10_000 })
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
  }
}

let resolver: ReturnType<typeof createHandleResolver> | undefined
let limits: ReturnType<typeof createRequestLimits> | undefined

export function getHandleResolver(): ReturnType<typeof createHandleResolver> {
  resolver ??= createHandleResolver({
    resolveTxt: (name, signal) => withResolver(signal, undefined, (r) => r.resolveTxt(name)),
    lookup: (host, signal) => resolveAddresses(host, signal),
    transport: httpsTransport,
    timeoutMs: 3_000,
    maxConcurrent: 16,
  })
  return resolver
}

export function getRequestLimits(): ReturnType<typeof createRequestLimits> {
  limits ??= createRequestLimits({ perMinute: 30 })
  return limits
}
