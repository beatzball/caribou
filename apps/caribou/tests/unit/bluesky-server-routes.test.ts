// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, createRouter, toNodeListener } from 'h3'
import type * as HandleResolverModule from '../../server/lib/handle-resolver.js'

// The two Bluesky sign-in routes as the SDK and an authorization server meet
// them: real h3 and headers. The lookup itself is a stand-in; its rules are
// tested in server/lib/__tests__/.

const resolve = vi.fn<(handle: string) => Promise<string | null>>()

vi.mock('../../server/lib/handle-resolver.js', async (original) => {
  const real = await original<typeof HandleResolverModule>()
  return { ...real, getHandleResolver: () => ({ resolve }) }
})

let server: Server
let base: string

beforeAll(async () => {
  const { default: metadata } = await import('../../server/routes/oauth/client-metadata.json.get.js')
  const { default: resolveHandle } = await import('../../server/routes/xrpc/com.atproto.identity.resolveHandle.get.js')
  const router = createRouter()
    .get('/oauth/client-metadata.json', metadata)
    .get('/xrpc/com.atproto.identity.resolveHandle', resolveHandle)
  server = createServer(toNodeListener(createApp().use(router)))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((r) => server.close(() => r())))
afterEach(() => { delete process.env.PUBLIC_BASE_URL })
beforeEach(() => { resolve.mockReset() })

describe('GET /oauth/client-metadata.json', () => {
  it('serves the client metadata built from PUBLIC_BASE_URL', async () => {
    process.env.PUBLIC_BASE_URL = 'https://caribou.example.com/'
    const res = await fetch(`${base}/oauth/client-metadata.json`, { headers: { host: 'evil.example' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^application\/json/)
    expect(res.headers.get('cache-control')).toBe('public, max-age=300')
    expect(await res.json()).toEqual({
      client_id: 'https://caribou.example.com/oauth/client-metadata.json',
      client_name: 'Caribou',
      client_uri: 'https://caribou.example.com',
      redirect_uris: ['https://caribou.example.com/signin/bluesky'],
      scope: 'atproto transition:generic',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      application_type: 'web',
      token_endpoint_auth_method: 'none',
      dpop_bound_access_tokens: true,
    })
  })

  it.each([
    ['https://Caribou.Example.com:443', 'https://caribou.example.com'],
    ['https://caribou.example.com/', 'https://caribou.example.com'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['http://127.0.0.1:3181', 'http://127.0.0.1:3181'],
    ['https://localhost:8443', 'https://localhost:8443'],
  ])('normalizes PUBLIC_BASE_URL %j to %s', async (value, origin) => {
    process.env.PUBLIC_BASE_URL = value
    const res = await fetch(`${base}/oauth/client-metadata.json`)
    expect(res.status).toBe(200)
    expect((await res.json()).client_id).toBe(`${origin}/oauth/client-metadata.json`)
  })

  it.each([undefined, '', 'caribou.example.com', 'javascript:alert(1)', 'https://caribou.example.com/app',
    'http://caribou.example.com', 'https://caribou.example.com:8443', 'https://caribou.example.com/?x=1',
    'https://caribou.example.com/#x', 'https://user:pw@caribou.example.com', 'http://localhost.example.com'])(
    'answers 404 for PUBLIC_BASE_URL %j, never the Host header', async (value) => {
      if (value !== undefined) process.env.PUBLIC_BASE_URL = value
      const res = await fetch(`${base}/oauth/client-metadata.json`)
      expect(res.status).toBe(404)
      expect(res.headers.get('cache-control')).toBe('no-store')
    })
})

describe('GET /xrpc/com.atproto.identity.resolveHandle', () => {
  const DID = 'did:plc:alicealicealicealice2345'
  const get = (q: string, headers: Record<string, string> = {}) =>
    fetch(`${base}/xrpc/com.atproto.identity.resolveHandle${q}`, { headers })

  it('answers the DID in the shape the SDK reads', async () => {
    resolve.mockResolvedValue(DID)
    const res = await get('?handle=Alice.Example.com')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
    expect(await res.json()).toEqual({ did: DID })
    expect(resolve).toHaveBeenCalledWith('alice.example.com')
  })

  it('answers the "Unable to resolve handle" error the SDK reads as not found', async () => {
    resolve.mockResolvedValue(null)
    const res = await get('?handle=alice.example.com')
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ error: 'InvalidRequest', message: 'Unable to resolve handle' })
  })

  it.each(['', '?handle=', '?handle=localhost', '?handle=127.0.0.1', '?handle=a.local', '?handle=a&handle=b'])(
    'refuses %j before any lookup', async (q) => {
      const res = await get(q)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'InvalidRequest', message: 'Invalid handle' })
      expect(resolve).not.toHaveBeenCalled()
    })

  it('answers the error shape when the lookup throws', async () => {
    resolve.mockRejectedValue(new Error('boom'))
    const res = await get('?handle=alice.example.com')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'InvalidRequest', message: 'Unable to resolve handle' })
  })

  it('answers 503 while every lookup slot is busy', async () => {
    const { ResolverBusy } = await import('../../server/lib/handle-resolver.js')
    resolve.mockRejectedValue(new ResolverBusy())
    const res = await get('?handle=alice.example.com')
    expect(res.status).toBe(503)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('limits each client IP, taken from the last X-Forwarded-For entry', async () => {
    resolve.mockResolvedValue(DID)
    const ip = '203.0.113.77'
    for (let i = 0; i < 30; i++) {
      expect((await get('?handle=alice.example.com', { 'x-forwarded-for': `1.2.3.${i}, ${ip}` })).status).toBe(200)
    }
    const res = await get('?handle=alice.example.com', { 'x-forwarded-for': `9.9.9.9, ${ip}` })
    expect(res.status).toBe(429)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect((await get('?handle=alice.example.com', { 'x-forwarded-for': `${ip}, 203.0.113.78` })).status).toBe(200)
  })
})
