import { promises as dns } from 'node:dns'
import { request } from 'node:https'
import { isIP } from 'node:net'
import type { Readable } from 'node:stream'

// An HTTPS GET to a host someone else picked, bound to the connection:
// look the host up once, refuse it if any address is special, and connect to
// that vetted address only. The rules, and the tests for each, are in
// apps/caribou/README.md, "Bluesky sign-in endpoints" (rules 4–8).

/** Looks a host up once. Must stop (reject) soon after `signal` aborts. */
export type LookupFn = (host: string, signal: AbortSignal) => Promise<Array<{ address: string; family: number }>>

/** A request refused by policy (rules 4–7), as opposed to a network failure. */
export class GuardRefusal extends Error {
  override name = 'GuardRefusal'
}

export interface TransportRequest {
  /** The vetted IP literal to connect to. */
  ip: string
  port: number
  /** The host name, for TLS (SNI and the certificate) and the Host header. */
  host: string
  path: string
  signal: AbortSignal
  maxBytes: number
}

export interface TransportResponse {
  status: number
  location: string | undefined
  body: string
}

export type Transport = (req: TransportRequest) => Promise<TransportResponse>

export const MAX_REDIRECTS = 3
export const MAX_BODY_BYTES = 2048

// ---- Addresses (rule 5) ----------------------------------------------------

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const v = Number(p)
    if (v > 255) return null
    n = n * 256 + v
  }
  return n
}

function ipv6ToBigInt(ip: string): bigint | null {
  if (isIP(ip) !== 6 || ip.includes('%')) return null
  let s = ip.toLowerCase()
  // A dotted IPv4 tail, as in ::ffff:1.2.3.4.
  const dotted = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    const v4 = ipv4ToInt(dotted[2]!)
    if (v4 === null) return null
    s = `${dotted[1]}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`
  }
  const [head, tail] = s.split('::') as [string, string | undefined]
  const h = head ? head.split(':') : []
  const t = tail ? tail.split(':') : []
  const fill = s.includes('::') ? 8 - h.length - t.length : 0
  const groups = [...h, ...Array<string>(fill).fill('0'), ...t]
  if (groups.length !== 8) return null
  let n = 0n
  for (const g of groups) n = (n << 16n) | BigInt(parseInt(g || '0', 16))
  return n
}

const V4_SPECIAL: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]

function inV4(n: number, base: string, bits: number): boolean {
  const b = ipv4ToInt(base)!
  const shift = 32 - bits
  return Math.floor(n / 2 ** shift) === Math.floor(b / 2 ** shift)
}

function inV6(n: bigint, base: string, bits: number): boolean {
  const shift = BigInt(128 - bits)
  return n >> shift === ipv6ToBigInt(base)! >> shift
}

/** Whether `ip` is an ordinary public unicast address we may connect to. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) {
    const n = ipv4ToInt(ip)
    return n !== null && !V4_SPECIAL.some(([b, bits]) => inV4(n, b, bits))
  }
  if (family === 6) {
    const n = ipv6ToBigInt(ip)
    if (n === null) return false
    // An allow list: global unicast only. Everything that embeds or maps an
    // IPv4 address (::ffff:0:0/96, 64:ff9b::/96, ::a.b.c.d) is outside it,
    // except 6to4 and Teredo, which are refused by name.
    if (!inV6(n, '2000::', 3)) return false
    return !inV6(n, '2001::', 23) && !inV6(n, '2001:db8::', 32) && !inV6(n, '2002::', 16)
  }
  return false
}

// ---- Host names (rule 7) ---------------------------------------------------

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

const RESERVED_TLDS = new Set(['alt', 'arpa', 'example', 'internal', 'invalid', 'local', 'localhost', 'onion', 'test'])

/** A DNS host name of at least two labels whose last label starts with a letter. */
export function isHostName(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false
  const labels = host.split('.')
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return false
  return /^[a-z]/.test(labels[labels.length - 1]!)
}

/** A host name that passes rule 1: the syntax above, not an IP, no reserved TLD. */
export function isPublicHostName(host: string): boolean {
  if (isIP(host) || !isHostName(host)) return false
  return !RESERVED_TLDS.has(host.slice(host.lastIndexOf('.') + 1))
}

// ---- Cancellable DNS (rules 5 and 10) ---------------------------------------

/**
 * Run `fn` on a fresh `dns.promises.Resolver` and cancel its queries when
 * `signal` aborts. Unlike `dns.lookup`, these queries do not hold a libuv
 * thread and stop at once on `cancel()`.
 */
export async function withResolver<T>(
  signal: AbortSignal,
  servers: string[] | undefined,
  fn: (r: InstanceType<typeof dns.Resolver>) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted()
  const resolver = new dns.Resolver({ timeout: 2_000, tries: 1 })
  if (servers) resolver.setServers(servers)
  const cancel = () => resolver.cancel()
  signal.addEventListener('abort', cancel, { once: true })
  try {
    return await fn(resolver)
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

const NOT_FOUND = new Set(['ENOTFOUND', 'ENODATA'])

/** Whether a DNS error means "no such name or record", not a failure. */
export function isDnsNotFound(err: unknown): boolean {
  return NOT_FOUND.has((err as { code?: string })?.code ?? '')
}

/** A and AAAA records of `host`, through a resolver the signal can cancel. */
export function resolveAddresses(
  host: string,
  signal: AbortSignal,
  opts: { servers?: string[] } = {},
): Promise<Array<{ address: string; family: number }>> {
  return withResolver(signal, opts.servers, async (r) => {
    const [v4, v6] = await Promise.allSettled([r.resolve4(host), r.resolve6(host)])
    signal.throwIfAborted()
    const out = [
      ...(v4.status === 'fulfilled' ? v4.value.map((address) => ({ address, family: 4 })) : []),
      ...(v6.status === 'fulfilled' ? v6.value.map((address) => ({ address, family: 6 })) : []),
    ]
    if (out.length > 0) return out
    const errors = [v4, v6].map((x) => (x.status === 'rejected' ? x.reason : null)).filter(Boolean)
    const failure = errors.find((e) => !isDnsNotFound(e))
    throw failure ?? Object.assign(new Error(`no address for ${host}`), { code: 'ENOTFOUND' })
  })
}

// ---- The request -----------------------------------------------------------

async function vettedAddresses(hostname: string, lookup: LookupFn, signal: AbortSignal): Promise<string[]> {
  // URL keeps the brackets on an IPv6 literal.
  const literal = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname
  if (isIP(literal)) {
    if (!isPublicAddress(literal)) throw new GuardRefusal(`refused address ${literal}`)
    return [literal]
  }
  if (!isPublicHostName(hostname)) throw new GuardRefusal(`refused host ${hostname}`)
  signal.throwIfAborted()
  // No race with the signal: the lookup must stop on it, and the caller's
  // slot stays held until it has (rule 10).
  const addresses = await lookup(hostname, signal)
  signal.throwIfAborted()
  if (addresses.length === 0) throw Object.assign(new Error(`no address for ${hostname}`), { code: 'ENOTFOUND' })
  const bad = addresses.find((a) => !isPublicAddress(a.address))
  if (bad) throw new GuardRefusal(`refused address ${bad.address} for ${hostname}`)
  return addresses.map((a) => a.address)
}

// A connection that never reached a server: the next vetted address may work.
const CONNECT_ERRORS = new Set(['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'EADDRNOTAVAIL', 'EAFNOSUPPORT'])

const REDIRECT = new Set([301, 302, 303, 307, 308])

/**
 * GET `url` under rules 4–8. Throws on any refusal, on too many redirects,
 * and when `signal` aborts. Returns the final status and body.
 */
export async function guardedGet(
  url: string,
  opts: { lookup: LookupFn; transport: Transport; signal: AbortSignal; maxRedirects?: number; maxBytes?: number },
): Promise<{ status: number; body: string }> {
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS
  let current = url
  for (let hop = 0; ; hop++) {
    const u = new URL(current)
    if (u.protocol !== 'https:') throw new GuardRefusal(`refused scheme ${u.protocol}`)
    if (u.port !== '' && u.port !== '443') throw new GuardRefusal(`refused port ${u.port}`)
    if (u.username || u.password) throw new GuardRefusal('refused credentials in URL')
    const host = u.hostname.toLowerCase()
    const ips = await vettedAddresses(host, opts.lookup, opts.signal)
    let res: TransportResponse | undefined
    for (let i = 0; i < ips.length && !res; i++) {
      opts.signal.throwIfAborted()
      try {
        // The transport stops on the signal (https.request's `signal`).
        res = await opts.transport({
          ip: ips[i]!,
          port: 443,
          host: host.startsWith('[') ? host.slice(1, -1) : host,
          path: `${u.pathname}${u.search}`,
          signal: opts.signal,
          maxBytes: opts.maxBytes ?? MAX_BODY_BYTES,
        })
      } catch (err) {
        const code = (err as { code?: string }).code ?? ''
        if (i === ips.length - 1 || opts.signal.aborted || !CONNECT_ERRORS.has(code)) throw err
      }
    }
    if (!REDIRECT.has(res!.status)) return { status: res!.status, body: res!.body }
    if (!res!.location) throw new GuardRefusal('redirect without a location')
    if (hop >= maxRedirects) throw new GuardRefusal(`more than ${maxRedirects} redirects`)
    current = new URL(res!.location, u).toString()
  }
}

/** Read a stream as UTF-8, failing (not cutting) once it passes `maxBytes`. */
export function readCapped(stream: Readable, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        stream.destroy()
        reject(new Error(`body over ${maxBytes} bytes`))
        return
      }
      chunks.push(chunk)
    })
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    stream.on('error', reject)
  })
}

function noLookup(): never {
  throw new Error('DNS lookup refused: connect to the vetted address only')
}

/**
 * The real transport: one HTTPS GET to the IP literal `ip`. The host name is
 * the TLS server name (SNI and the certificate check) and the Host header.
 * Node does not look up an IP literal; `lookup` throws in case it ever does.
 * `ca` replaces the trusted roots; only tests pass it.
 */
export function createHttpsTransport(opts: { ca?: string } = {}): Transport {
  return (req) =>
    new Promise<TransportResponse>((resolve, reject) => {
      const family = isIP(req.host)
      const r = request(
        {
          host: req.ip,
          port: req.port,
          path: req.path,
          method: 'GET',
          servername: family ? undefined : req.host,
          headers: {
            host: family === 6 ? `[${req.host}]` : req.host,
            accept: 'text/plain',
            'user-agent': 'Caribou handle resolver',
          },
          agent: false,
          lookup: noLookup as never,
          signal: req.signal,
          ...(opts.ca ? { ca: opts.ca } : {}),
        },
        (res) => {
          const declared = Number(res.headers['content-length'])
          if (Number.isFinite(declared) && declared > req.maxBytes) {
            res.destroy()
            reject(new Error(`body over ${req.maxBytes} bytes`))
            return
          }
          const location = typeof res.headers.location === 'string' ? res.headers.location : undefined
          readCapped(res, req.maxBytes).then((body) => resolve({ status: res.statusCode ?? 0, location, body }), reject)
        },
      )
      r.on('error', reject)
      r.end()
    })
}

export const httpsTransport: Transport = createHttpsTransport()
