// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  createHandleResolver,
  createRequestLimits,
  isAtprotoDid,
  normalizeHandle,
  type HandleResolverDeps,
} from '../handle-resolver.js'
import type { LookupFn, Transport } from '../ssrf-guard.js'

// The rules are in apps/caribou/README.md, "Bluesky sign-in endpoints".

const DID = 'did:plc:alicealicealicealice2345'

describe('normalizeHandle (rule 1)', () => {
  it.each([
    ['alice.example.com', 'alice.example.com'],
    ['Alice.Example.COM', 'alice.example.com'],
    ['a-b.c-d.social', 'a-b.c-d.social'],
    ['x.bsky.social', 'x.bsky.social'],
    ['1.2.3.app', '1.2.3.app'],
  ])('accepts %s', (raw, want) => {
    expect(normalizeHandle(raw)).toBe(want)
  })

  it.each([
    '', 'alice', 'alice.', '.alice.com', 'al ice.com', 'alice..com', '-alice.com', 'alice-.com',
    'alice.com:443', 'alice.com/x', 'user@alice.com', 'alice.123', '127.0.0.1', '10.0.0.1',
    '[::1]', 'alice.local', 'alice.localhost', 'alice.internal', 'alice.arpa', 'alice.invalid',
    'alice.test', 'alice.example', 'alice.onion', 'alice.alt', 'ålice.com',
    `${'a'.repeat(64)}.com`, `${'a.'.repeat(127)}com`,
  ])('refuses %j', (raw) => {
    expect(normalizeHandle(raw)).toBeNull()
  })

  it('refuses a non-string', () => {
    expect(normalizeHandle(undefined)).toBeNull()
    expect(normalizeHandle(['alice.example.com'])).toBeNull()
  })
})

describe('isAtprotoDid (rule 3)', () => {
  it.each([DID, 'did:web:alice.example.com', 'did:web:alice.example.com%3A8080'])('accepts %s', (did) => {
    expect(isAtprotoDid(did)).toBe(true)
  })
  it.each(['did:plc:short', 'did:plc:ALICEALICEALICEALICE2345', 'did:key:z6Mk', 'did:web:', 'did:web:a b',
    `${DID} `, `${DID}\n<script>`, 'https://alice.example.com', '', 'did:web:alice.example.com/x'])('refuses %j', (did) => {
    expect(isAtprotoDid(did)).toBe(false)
  })
})

function deps(over: Partial<HandleResolverDeps> = {}): HandleResolverDeps {
  return {
    resolveTxt: vi.fn(async () => []),
    lookup: vi.fn<LookupFn>(async () => [{ address: '93.184.215.14', family: 4 }]),
    transport: vi.fn<Transport>(async () => ({ status: 200, location: undefined, body: `${DID}\n` })),
    timeoutMs: 3000,
    ...over,
  }
}

describe('createHandleResolver', () => {
  it('answers from DNS TXT _atproto.<handle> and skips HTTPS (rule 2)', async () => {
    const d = deps({ resolveTxt: vi.fn(async () => [['did=' + DID], ['other']]) })
    await expect(createHandleResolver(d).resolve('alice.example.com')).resolves.toBe(DID)
    expect(d.resolveTxt).toHaveBeenCalledWith('_atproto.alice.example.com')
    expect(d.transport).not.toHaveBeenCalled()
  })

  it('joins a TXT record split into chunks', async () => {
    const d = deps({ resolveTxt: vi.fn(async () => [['did=did:plc:', 'alicealicealicealice2345']]) })
    await expect(createHandleResolver(d).resolve('alice.example.com')).resolves.toBe(DID)
  })

  it('treats two different TXT DIDs as no DNS answer, then tries HTTPS', async () => {
    const d = deps({ resolveTxt: vi.fn(async () => [['did=' + DID], ['did=did:plc:bobbobbobbobbobbobbob234']]) })
    await expect(createHandleResolver(d).resolve('alice.example.com')).resolves.toBe(DID)
    expect(d.transport).toHaveBeenCalledTimes(1)
  })

  it('falls back to HTTPS /.well-known/atproto-did on the vetted address', async () => {
    const d = deps({ resolveTxt: vi.fn(async () => { throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' }) }) })
    await expect(createHandleResolver(d).resolve('alice.example.com')).resolves.toBe(DID)
    expect(d.transport).toHaveBeenCalledWith(expect.objectContaining({
      ip: '93.184.215.14', port: 443, host: 'alice.example.com', path: '/.well-known/atproto-did', maxBytes: 2048,
    }))
  })

  it('ignores a DNS value that is not a DID', async () => {
    const d = deps({ resolveTxt: vi.fn(async () => [['did=javascript:alert(1)']]),
      transport: vi.fn<Transport>(async () => ({ status: 404, location: undefined, body: '' })) })
    await expect(createHandleResolver(d).resolve('alice.example.com')).resolves.toBeNull()
  })

  it.each(['<html>did:plc:x</html>', 'did:key:z6Mk', `${DID} ${DID}`, ''])('refuses an HTTPS body %j', async (body) => {
    const d = deps({ transport: vi.fn<Transport>(async () => ({ status: 200, location: undefined, body })) })
    await expect(createHandleResolver(d).resolve('alice.example.com')).resolves.toBeNull()
  })

  it('gives no answer on a non-200', async () => {
    const d = deps({ transport: vi.fn<Transport>(async () => ({ status: 500, location: undefined, body: DID })) })
    await expect(createHandleResolver(d).resolve('alice.example.com')).resolves.toBeNull()
  })

  it('gives no answer when the host resolves to a private address (DNS rebinding through the handle)', async () => {
    let n = 0
    const d = deps({ lookup: vi.fn<LookupFn>(async () => (++n === 1 ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '93.184.215.14', family: 4 }])) })
    await expect(createHandleResolver(d).resolve('alice.example.com')).resolves.toBeNull()
    expect(d.lookup).toHaveBeenCalledTimes(1)
    expect(d.transport).not.toHaveBeenCalled()
  })

  it('gives no answer on a redirect to a private address', async () => {
    const d = deps({
      lookup: vi.fn<LookupFn>(async (host) => [{ address: host === 'alice.example.com' ? '93.184.215.14' : '10.1.2.3', family: 4 }]),
      transport: vi.fn<Transport>(async () => ({ status: 302, location: 'https://internal.example.net/', body: '' })),
    })
    await expect(createHandleResolver(d).resolve('alice.example.com')).resolves.toBeNull()
    expect(d.transport).toHaveBeenCalledTimes(1)
  })

  it('gives up after the time limit, for DNS and HTTPS together (rule 8)', async () => {
    vi.useFakeTimers()
    try {
      const d = deps({
        resolveTxt: vi.fn(() => new Promise<string[][]>(() => {})),
        timeoutMs: 3000,
      })
      const p = createHandleResolver(d).resolve('alice.example.com')
      await vi.advanceTimersByTimeAsync(3001)
      await expect(p).resolves.toBeNull()
      expect(d.transport).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('caches an answer and a miss for 5 minutes, and shares one lookup between callers (rule 9)', async () => {
    let now = 0
    const d = deps({ now: () => now })
    const r = createHandleResolver(d)
    const [a, b] = await Promise.all([r.resolve('alice.example.com'), r.resolve('alice.example.com')])
    expect([a, b]).toEqual([DID, DID])
    expect(d.transport).toHaveBeenCalledTimes(1)
    now = 299_000
    await r.resolve('alice.example.com')
    expect(d.transport).toHaveBeenCalledTimes(1)
    now = 301_000
    await r.resolve('alice.example.com')
    expect(d.transport).toHaveBeenCalledTimes(2)
  })
})

describe('createRequestLimits (rule 8)', () => {
  it('allows 30 requests per IP per minute, then refuses that IP only', () => {
    let now = 0
    const l = createRequestLimits({ perMinute: 30, maxConcurrent: 16, now: () => now })
    for (let i = 0; i < 30; i++) expect(l.allow('1.1.1.1')).toBe(true)
    expect(l.allow('1.1.1.1')).toBe(false)
    expect(l.allow('2.2.2.2')).toBe(true)
    now = 60_001
    expect(l.allow('1.1.1.1')).toBe(true)
  })

  it('caps lookups at once', () => {
    const l = createRequestLimits({ perMinute: 30, maxConcurrent: 2 })
    const a = l.acquire()
    const b = l.acquire()
    expect(a && b).toBeTruthy()
    expect(l.acquire()).toBeNull()
    a!()
    expect(l.acquire()).toBeTruthy()
  })
})
