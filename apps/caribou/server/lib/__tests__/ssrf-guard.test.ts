// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { createSocket, type Socket as Socket4 } from 'node:dgram'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import { createServer, type Server, type Socket } from 'node:net'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { TLSSocket } from 'node:tls'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createHttpsTransport,
  GuardRefusal,
  guardedGet,
  httpsTransport,
  resolveAddresses,
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
    // A lookup that stops on the signal, as resolveAddresses does.
    const lookup: LookupFn = (_host, sig) => new Promise((_, reject) => sig.addEventListener('abort', () => reject(sig.reason)))
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

describe('guardedGet, fix round 1', () => {
  it('passes the abort signal to the lookup and starts no lookup once it has fired (rule 10)', async () => {
    const lookup = vi.fn<LookupFn>(async () => [{ address: PUBLIC_A, family: 4 }])
    const transport = okTransport()
    const ctrl = new AbortController()
    await guardedGet('https://alice.example.com/x', { lookup, transport, signal: ctrl.signal })
    expect(lookup.mock.calls[0]![1]).toBe(ctrl.signal)
    ctrl.abort(new Error('timeout'))
    lookup.mockClear()
    transport.mockClear()
    await expect(guardedGet('https://alice.example.com/x', { lookup, transport, signal: ctrl.signal })).rejects.toThrow(/timeout/)
    expect(lookup).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
  })

  it('starts no connection when the signal fires during the lookup (rule 10)', async () => {
    const ctrl = new AbortController()
    const lookup = vi.fn<LookupFn>(async () => {
      ctrl.abort(new Error('timeout'))
      return [{ address: PUBLIC_A, family: 4 }]
    })
    const transport = okTransport()
    await expect(guardedGet('https://alice.example.com/x', { lookup, transport, signal: ctrl.signal })).rejects.toThrow(/timeout/)
    expect(transport).not.toHaveBeenCalled()
  })

  it('tries the next vetted address when the connection fails (rule 6)', async () => {
    const lookup = vi.fn<LookupFn>(async () => [{ address: '2606:4700::1', family: 6 }, { address: PUBLIC_A, family: 4 }])
    const transport = vi.fn<Transport>(async (req) => {
      if (req.ip === '2606:4700::1') throw Object.assign(new Error('unreachable'), { code: 'ENETUNREACH' })
      return { status: 200, location: undefined, body: 'did:plc:alice' }
    })
    await expect(guardedGet('https://alice.example.com/x', { lookup, transport, signal: signal() })).resolves.toEqual({ status: 200, body: 'did:plc:alice' })
    expect(transport.mock.calls.map((c) => c[0].ip)).toEqual(['2606:4700::1', PUBLIC_A])
  })

  it('does not try the next address after a TLS failure', async () => {
    const lookup = vi.fn<LookupFn>(async () => [{ address: PUBLIC_B, family: 4 }, { address: PUBLIC_A, family: 4 }])
    const transport = vi.fn<Transport>(async () => {
      throw Object.assign(new Error('altname'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' })
    })
    await expect(guardedGet('https://alice.example.com/x', { lookup, transport, signal: signal() })).rejects.toThrow(/altname/)
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('refuses a redirect to a reserved TLD without a lookup (rule 7)', async () => {
    const lookup = vi.fn<LookupFn>(async () => [{ address: PUBLIC_A, family: 4 }])
    const transport = vi.fn<Transport>(async () => ({ status: 302, location: 'https://metadata.google.internal/', body: '' }))
    await expect(guardedGet('https://alice.example.com/x', { lookup, transport, signal: signal() })).rejects.toBeInstanceOf(GuardRefusal)
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('marks every policy refusal as a GuardRefusal', async () => {
    const transport = okTransport()
    const lookup: LookupFn = async () => [{ address: '10.0.0.1', family: 4 }]
    await expect(guardedGet('https://alice.example.com/x', { lookup, transport, signal: signal() })).rejects.toBeInstanceOf(GuardRefusal)
    await expect(guardedGet('http://alice.example.com/x', { lookup, transport, signal: signal() })).rejects.toBeInstanceOf(GuardRefusal)
  })
})

describe('resolveAddresses (rule 5 and 10, real DNS client)', () => {
  let dnsServer: Socket4 | undefined
  afterEach(() => { dnsServer?.close(); dnsServer = undefined })

  it('is cancelled by the abort signal while the DNS server stays silent', async () => {
    dnsServer = createSocket('udp4')
    let queries = 0
    dnsServer.on('message', () => { queries += 1 })
    await new Promise<void>((r) => dnsServer!.bind(0, '127.0.0.1', r))
    const port = dnsServer.address().port
    const ctrl = new AbortController()
    const p = resolveAddresses('alice.example.com', ctrl.signal, { servers: [`127.0.0.1:${port}`] })
    await vi.waitFor(() => expect(queries).toBeGreaterThan(0))
    const started = Date.now()
    ctrl.abort(new Error('timeout'))
    await expect(p).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(500)
  })
})

// A test CA and a leaf for alice.example.com, made with the openssl CLI.
function makeCerts(): { ca: string; key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), 'caribou-tls-'))
  const run = (args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' })
  try {
    run(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
      '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '2', '-subj', '/CN=Caribou Test CA',
      '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign'])
    run(['req', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
      '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=alice.example.com'])
    writeFileSync(join(dir, 'ext'), 'subjectAltName=DNS:alice.example.com\nbasicConstraints=CA:FALSE\n')
    run(['x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial',
      '-out', 'leaf.crt', '-days', '2', '-extfile', 'ext'])
    return {
      ca: readFileSync(join(dir, 'ca.crt'), 'utf8'),
      key: readFileSync(join(dir, 'leaf.key'), 'utf8'),
      cert: readFileSync(join(dir, 'leaf.crt'), 'utf8'),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('createHttpsTransport on a real TLS server (rule 6 and 8)', () => {
  let tls: HttpsServer
  let port: number
  let ca: string
  const seen: Array<{ host: string | undefined; sni: string | undefined }> = []

  beforeAll(async () => {
    const certs = makeCerts()
    ca = certs.ca
    tls = createHttpsServer({ key: certs.key, cert: certs.cert }, (req, res) => {
      seen.push({ host: req.headers.host, sni: (req.socket as TLSSocket).servername || undefined })
      if (req.url === '/big-length') {
        res.writeHead(200, { 'content-length': '5000' })
        res.write('x')
        return
      }
      if (req.url === '/big-chunked') {
        res.writeHead(200)
        res.write(Buffer.alloc(1500, 'a'))
        res.end(Buffer.alloc(1500, 'a'))
        return
      }
      if (req.url === '/exact') {
        res.end(Buffer.alloc(2048, 'a'))
        return
      }
      res.end('did:plc:alicealicealicealice2345')
    })
    await new Promise<void>((r) => tls.listen(0, '127.0.0.1', r))
    port = (tls.address() as AddressInfo).port
  })

  afterAll(() => new Promise<void>((r) => tls.close(() => r())))

  const call = (transport: Transport, host: string, path = '/.well-known/atproto-did') =>
    transport({ ip: '127.0.0.1', port, host, path, signal: AbortSignal.timeout(3000), maxBytes: 2048 })

  it('answers when the certificate is trusted and names the host, with SNI and Host set to it', async () => {
    seen.length = 0
    await expect(call(createHttpsTransport({ ca }), 'alice.example.com')).resolves.toMatchObject({
      status: 200, body: 'did:plc:alicealicealicealice2345',
    })
    expect(seen).toEqual([{ host: 'alice.example.com', sni: 'alice.example.com' }])
  })

  it('fails on a certificate no trusted CA signed', async () => {
    await expect(call(createHttpsTransport(), 'alice.example.com')).rejects.toMatchObject({
      code: expect.stringMatching(/UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|SELF_SIGNED/),
    })
  })

  it('fails when the certificate does not name the host', async () => {
    await expect(call(createHttpsTransport({ ca }), 'rebind.example.com')).rejects.toMatchObject({
      code: 'ERR_TLS_CERT_ALTNAME_INVALID',
    })
  })

  it('reads a body of exactly 2 KB', async () => {
    const res = await call(createHttpsTransport({ ca }), 'alice.example.com', '/exact')
    expect(res.body.length).toBe(2048)
  })

  it('fails on a declared content-length over 2 KB', async () => {
    await expect(call(createHttpsTransport({ ca }), 'alice.example.com', '/big-length')).rejects.toThrow(/2048/)
  })

  it('fails on a chunked body over 2 KB', async () => {
    await expect(call(createHttpsTransport({ ca }), 'alice.example.com', '/big-chunked')).rejects.toThrow(/2048/)
  })
})
