// @vitest-environment node
import { createServer, type Server, type Socket } from 'node:net'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  guardedGet,
  httpsTransport,
  isPublicAddress,
  readCapped,
  type LookupFn,
  type Transport,
  type TransportRequest,
} from '../ssrf-guard.js'

// The rules are in apps/caribou/README.md, "Bluesky sign-in endpoints".

describe('isPublicAddress (rule 5)', () => {
  it.each([
    '0.0.0.0', '0.1.2.3',
    '10.0.0.1', '10.255.255.255',
    '100.64.0.1', '100.100.100.200', '100.127.255.255',
    '127.0.0.1', '127.1.2.3',
    '169.254.0.1', '169.254.169.254',
    '172.16.0.1', '172.31.255.255',
    '192.0.0.1', '192.0.2.1', '192.88.99.1',
    '192.168.0.1', '192.168.255.255',
    '198.18.0.1', '198.19.255.255', '198.51.100.7', '203.0.113.9',
    '224.0.0.1', '239.255.255.255',
    '240.0.0.1', '255.255.255.255',
  ])('refuses IPv4 %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false)
  })

  it.each([
    '::', '::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:8.8.8.8', '::ffff:7f00:1',
    '64:ff9b::a00:1', '64:ff9b::808:808',
    'fc00::1', 'fd00:ec2::254', 'fe80::1', 'fe80::1%en0', 'ff02::1',
    '2001::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:db8::1', '2002:a00:1::1',
    '::127.0.0.1',
  ])('refuses IPv6 %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false)
  })

  it.each(['8.8.8.8', '1.1.1.1', '100.63.255.255', '100.128.0.0', '172.15.255.255', '172.32.0.0',
    '192.169.0.1', '223.255.255.255', '2606:4700:4700::1111', '2a00:1450:4001:81b::200e', '2001:200::1'])(
    'accepts public %s', (ip) => {
      expect(isPublicAddress(ip)).toBe(true)
    })

  it('refuses things that are not addresses', () => {
    expect(isPublicAddress('example.com')).toBe(false)
    expect(isPublicAddress('')).toBe(false)
    expect(isPublicAddress('1.2.3')).toBe(false)
  })
})

const PUBLIC_A = '93.184.215.14'
const PUBLIC_B = '93.184.215.15'

function okTransport(body = 'did:plc:alice'): Transport & ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({ status: 200, location: undefined, body })) as never
}

function signal(): AbortSignal {
  return new AbortController().signal
}

describe('guardedGet', () => {
  it('connects to the vetted address, with the host name for TLS (rule 6)', async () => {
    const lookup: LookupFn = vi.fn(async () => [{ address: PUBLIC_A, family: 4 }])
    const transport = okTransport()
    const res = await guardedGet('https://alice.example.com/.well-known/atproto-did', { lookup, transport, signal: signal() })
    expect(res).toEqual({ status: 200, body: 'did:plc:alice' })
    const req = transport.mock.calls[0]![0] as TransportRequest
    expect(req).toMatchObject({ ip: PUBLIC_A, port: 443, host: 'alice.example.com', path: '/.well-known/atproto-did' })
  })

  it('looks the host up once: a resolver that changes its answer (DNS rebinding) is never asked again', async () => {
    let calls = 0
    const lookup: LookupFn = vi.fn(async () => {
      calls += 1
      return calls === 1 ? [{ address: PUBLIC_A, family: 4 }] : [{ address: '127.0.0.1', family: 4 }]
    })
    const transport = okTransport()
    await guardedGet('https://alice.example.com/.well-known/atproto-did', { lookup, transport, signal: signal() })
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(transport).toHaveBeenCalledTimes(1)
    expect((transport.mock.calls[0]![0] as TransportRequest).ip).toBe(PUBLIC_A)
  })

  it('refuses the whole host when any address is special (rule 5)', async () => {
    const lookup: LookupFn = async () => [{ address: PUBLIC_A, family: 4 }, { address: '10.0.0.5', family: 4 }]
    const transport = okTransport()
    await expect(guardedGet('https://alice.example.com/x', { lookup, transport, signal: signal() })).rejects.toThrow(/address/)
    expect(transport).not.toHaveBeenCalled()
  })

  it('refuses an IPv4-mapped IPv6 answer', async () => {
    const lookup: LookupFn = async () => [{ address: '::ffff:169.254.169.254', family: 6 }]
    const transport = okTransport()
    await expect(guardedGet('https://alice.example.com/x', { lookup, transport, signal: signal() })).rejects.toThrow(/address/)
    expect(transport).not.toHaveBeenCalled()
  })

  it('refuses a host with no addresses', async () => {
    const transport = okTransport()
    await expect(guardedGet('https://alice.example.com/x', { lookup: async () => [], transport, signal: signal() })).rejects.toThrow()
    expect(transport).not.toHaveBeenCalled()
  })

  it.each([
    'http://alice.example.com/x',
    'https://alice.example.com:8443/x',
    'https://user:pw@alice.example.com/x',
    'ftp://alice.example.com/x',
  ])('refuses %s (rule 4)', async (url) => {
    const lookup = vi.fn<LookupFn>(async () => [{ address: PUBLIC_A, family: 4 }])
    const transport = okTransport()
    await expect(guardedGet(url, { lookup, transport, signal: signal() })).rejects.toThrow()
    expect(lookup).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
  })

  it('refuses a private IP literal without a lookup', async () => {
    const lookup = vi.fn<LookupFn>()
    const transport = okTransport()
    await expect(guardedGet('https://127.0.0.1/x', { lookup, transport, signal: signal() })).rejects.toThrow(/address/)
    await expect(guardedGet('https://[::1]/x', { lookup, transport, signal: signal() })).rejects.toThrow(/address/)
    expect(lookup).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
  })

  it('follows a redirect to a public host through the same check (rule 7)', async () => {
    const lookup = vi.fn<LookupFn>(async (host) => [{ address: host === 'alice.example.com' ? PUBLIC_A : PUBLIC_B, family: 4 }])
    const transport = vi.fn<Transport>(async (req) =>
      req.host === 'alice.example.com'
        ? { status: 302, location: 'https://did.example.net/alice', body: '' }
        : { status: 200, location: undefined, body: 'did:plc:alice' })
    const res = await guardedGet('https://alice.example.com/.well-known/atproto-did', { lookup, transport, signal: signal() })
    expect(res.body).toBe('did:plc:alice')
    expect(transport.mock.calls[1]![0]).toMatchObject({ ip: PUBLIC_B, host: 'did.example.net', path: '/alice' })
  })

  it('refuses a redirect to a host that resolves to a private address', async () => {
    const lookup = vi.fn<LookupFn>(async (host) => [{ address: host === 'alice.example.com' ? PUBLIC_A : '192.168.1.1', family: 4 }])
    const transport = vi.fn<Transport>(async () => ({ status: 302, location: 'https://intranet.example.net/', body: '' }))
    await expect(guardedGet('https://alice.example.com/x', { lookup, transport, signal: signal() })).rejects.toThrow(/address/)
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it.each([
    'https://169.254.169.254/latest/meta-data/',
    'https://[::ffff:127.0.0.1]/',
    'http://did.example.net/alice',
    'https://did.example.net:444/alice',
    'https://localhost/',
  ])('refuses a redirect to %s', async (location) => {
    const lookup = vi.fn<LookupFn>(async () => [{ address: PUBLIC_A, family: 4 }])
    const transport = vi.fn<Transport>(async () => ({ status: 301, location, body: '' }))
    await expect(guardedGet('https://alice.example.com/x', { lookup, transport, signal: signal() })).rejects.toThrow()
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('stops after 3 redirects', async () => {
    const lookup = vi.fn<LookupFn>(async () => [{ address: PUBLIC_A, family: 4 }])
    let n = 0
    const transport = vi.fn<Transport>(async () => ({ status: 307, location: `/hop${++n}`, body: '' }))
    await expect(guardedGet('https://alice.example.com/x', { lookup, transport, signal: signal() })).rejects.toThrow(/redirect/)
    expect(transport).toHaveBeenCalledTimes(4)
  })

  it('stops when the signal is aborted (time limit)', async () => {
    const ctrl = new AbortController()
    const lookup: LookupFn = () => new Promise(() => {})
    const p = guardedGet('https://alice.example.com/x', { lookup, transport: okTransport(), signal: ctrl.signal })
    ctrl.abort(new Error('timeout'))
    await expect(p).rejects.toThrow(/timeout/)
  })
})

describe('httpsTransport (rule 6 and 8, on a real socket)', () => {
  let server: Server | undefined
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())))

  it('connects to the IP it is given and sends the host name as SNI, with no DNS lookup', async () => {
    let hello = Buffer.alloc(0)
    const got = new Promise<void>((resolve) => {
      server = createServer((sock: Socket) => {
        sock.on('data', (d) => {
          hello = Buffer.concat([hello, d])
          sock.destroy()
          resolve()
        })
      })
    })
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
    const port = (server!.address() as AddressInfo).port
    // `rebind.invalid` cannot resolve; the connection still reaches the
    // listener, so the transport never looked the name up.
    const res = httpsTransport({
      ip: '127.0.0.1', port, host: 'rebind.invalid', path: '/.well-known/atproto-did',
      signal: AbortSignal.timeout(2000), maxBytes: 2048,
    })
    await got
    await expect(res).rejects.toThrow()
    expect(hello.includes(Buffer.from('rebind.invalid'))).toBe(true)
  })
})

describe('readCapped (rule 8, body size)', () => {
  it('reads a body up to the cap', async () => {
    await expect(readCapped(Readable.from([Buffer.from('did:plc:'), Buffer.from('alice')]), 2048)).resolves.toBe('did:plc:alice')
  })

  it('fails on a body over the cap instead of cutting it', async () => {
    const big = Readable.from([Buffer.alloc(1500, 'a'), Buffer.alloc(1500, 'a')])
    await expect(readCapped(big, 2048)).rejects.toThrow(/2048/)
  })
})
