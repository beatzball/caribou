import { request } from 'node:https'
import { isIP } from 'node:net'
import type { Readable } from 'node:stream'

// An HTTPS GET to a host someone else picked, bound to the connection:
// look the host up once, refuse it if any address is special, and connect to
// that vetted address only. The rules, and the tests for each, are in
// apps/caribou/README.md, "Bluesky sign-in endpoints" (rules 4–8).

export type LookupFn = (host: string) => Promise<Array<{ address: string; family: number }>>

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

/** A DNS host name of at least two labels whose last label starts with a letter. */
export function isHostName(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false
  const labels = host.split('.')
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return false
  return /^[a-z]/.test(labels[labels.length - 1]!)
}

// ---- The request -----------------------------------------------------------

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
    if (signal.aborted) fail()
    else signal.addEventListener('abort', fail, { once: true })
  })
}

async function vettedAddress(hostname: string, lookup: LookupFn, signal: AbortSignal): Promise<string> {
  // URL keeps the brackets on an IPv6 literal.
  const literal = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname
  if (isIP(literal)) {
    if (!isPublicAddress(literal)) throw new Error(`refused address ${literal}`)
    return literal
  }
  if (!isHostName(hostname)) throw new Error(`refused host ${hostname}`)
  const addresses = await Promise.race([lookup(hostname), aborted(signal)])
  if (addresses.length === 0) throw new Error(`no address for ${hostname}`)
  const bad = addresses.find((a) => !isPublicAddress(a.address))
  if (bad) throw new Error(`refused address ${bad.address} for ${hostname}`)
  return addresses[0]!.address
}

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
    if (u.protocol !== 'https:') throw new Error(`refused scheme ${u.protocol}`)
    if (u.port !== '' && u.port !== '443') throw new Error(`refused port ${u.port}`)
    if (u.username || u.password) throw new Error('refused credentials in URL')
    const host = u.hostname.toLowerCase()
    const ip = await vettedAddress(host, opts.lookup, opts.signal)
    const res = await Promise.race([
      opts.transport({
        ip,
        port: 443,
        host: host.startsWith('[') ? host.slice(1, -1) : host,
        path: `${u.pathname}${u.search}`,
        signal: opts.signal,
        maxBytes: opts.maxBytes ?? MAX_BODY_BYTES,
      }),
      aborted(opts.signal),
    ])
    if (!REDIRECT.has(res.status)) return { status: res.status, body: res.body }
    if (!res.location) throw new Error('redirect without a location')
    if (hop >= maxRedirects) throw new Error(`more than ${maxRedirects} redirects`)
    current = new URL(res.location, u).toString()
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
 */
export const httpsTransport: Transport = (req) =>
  new Promise<TransportResponse>((resolve, reject) => {
    const r = request(
      {
        host: req.ip,
        port: req.port,
        path: req.path,
        method: 'GET',
        servername: isIP(req.host) ? undefined : req.host,
        headers: { host: req.host, accept: 'text/plain', 'user-agent': 'Caribou handle resolver' },
        agent: false,
        lookup: noLookup as never,
        signal: req.signal,
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
