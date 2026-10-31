import { afterEach, describe, expect, it } from 'vitest'
import type { H3Event } from 'h3'
import { handleSetInstance } from '../set-instance.js'
import { isSameOrigin } from '../same-origin.js'

function mockEvent(headers: Record<string, string>): H3Event & { _out: Map<string, string[]> } {
  const out = new Map<string, string[]>()
  return {
    method: 'POST',
    path: '/api/instance',
    node: {
      req: { url: '/api/instance', headers: { host: 'caribou.local', ...headers } },
      res: {
        getHeader: (k: string) => out.get(k),
        setHeader: (k: string, v: string | string[]) => out.set(k, Array.isArray(v) ? v : [v]),
      },
    },
    _out: out,
  } as unknown as H3Event & { _out: Map<string, string[]> }
}

const REGISTERED = ['apps:example.social:http://caribou.local', 'apps:other.example:http://caribou.local']
const deps = {
  storage: {
    async getKeys(prefix?: string) { return REGISTERED.filter((k) => !prefix || k.startsWith(prefix)) },
  },
}
const SAME = { 'sec-fetch-site': 'same-origin' }

function cookie(event: { _out: Map<string, string[]> }): string | undefined {
  return event._out.get('set-cookie')?.find((c) => c.startsWith('caribou.instance='))
}

afterEach(() => { delete process.env.PUBLIC_BASE_URL })

describe('handleSetInstance', () => {
  it('sets the cookie for a server with a registered app', async () => {
    const event = mockEvent(SAME)
    expect(await handleSetInstance(event, { server: 'other.example' }, deps)).toEqual({ ok: true })
    const c = cookie(event)
    expect(c).toMatch(/^caribou\.instance=other\.example;/)
    expect(c).toMatch(/HttpOnly/)
  })

  it('rejects a server with no registered app (400)', async () => {
    const event = mockEvent(SAME)
    expect(await handleSetInstance(event, { server: 'evil.example' }, deps))
      .toMatchObject({ ok: false, status: 400 })
    expect(cookie(event)).toBeUndefined()
  })

  it.each([
    ['missing body', null],
    ['no server', {}],
    ['not a string', { server: 42 }],
    ['metadata address', { server: '169.254.169.254' }],
    ['no dot', { server: 'localhost' }],
    ['a path', { server: 'example.social/x' }],
  ])('rejects a bad body: %s (400)', async (_, body) => {
    const event = mockEvent(SAME)
    expect(await handleSetInstance(event, body, deps)).toMatchObject({ ok: false, status: 400 })
    expect(cookie(event)).toBeUndefined()
  })

  it('rejects a cross-site request (403) before it looks at the body', async () => {
    const event = mockEvent({ 'sec-fetch-site': 'cross-site' })
    expect(await handleSetInstance(event, { server: 'example.social' }, deps))
      .toMatchObject({ ok: false, status: 403 })
    expect(cookie(event)).toBeUndefined()
  })
})

describe('isSameOrigin', () => {
  it.each([
    ['same-origin fetch', { 'sec-fetch-site': 'same-origin' }, true],
    ['same-site (another subdomain)', { 'sec-fetch-site': 'same-site' }, false],
    ['cross-site', { 'sec-fetch-site': 'cross-site', origin: 'http://caribou.local' }, false],
    ['typed into the address bar', { 'sec-fetch-site': 'none' }, false],
    ['Origin matches the host', { origin: 'http://caribou.local' }, true],
    ['Origin is another site', { origin: 'https://evil.example' }, false],
    ['no headers at all', {}, false],
  ])('%s', (_, headers, expected) => {
    expect(isSameOrigin(mockEvent(headers))).toBe(expected)
  })

  it('accepts an Origin that matches PUBLIC_BASE_URL', () => {
    process.env.PUBLIC_BASE_URL = 'https://caribou.example'
    expect(isSameOrigin(mockEvent({ origin: 'https://caribou.example' }))).toBe(true)
  })
})
