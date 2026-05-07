import { describe, it, expect } from 'vitest'
import { getInstance, setInstance, clearInstance } from '../instance-cookie.js'
import type { H3Event } from 'h3'

function mockEvent(cookies: Record<string, string>): H3Event {
  const headers = new Map<string, string[]>()
  return {
    node: {
      req: { headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') } },
      res: {
        getHeader: (k: string) => headers.get(k),
        setHeader: (k: string, v: string | string[]) => headers.set(k, Array.isArray(v) ? v : [v]),
      },
    },
    _headers: headers,
  } as unknown as H3Event & { _headers: Map<string, string[]> }
}

const REGISTERED: Record<string, unknown> = {
  'apps:mastodon.social:https://caribou.local': { client_id: 'x' },
}
const storage = {
  async getItem<T>(key: string): Promise<T | null> {
    return (REGISTERED[key] as T | undefined) ?? null
  },
}
const deps = { storage, origin: 'https://caribou.local' }

describe('getInstance — SSRF amplification mitigation', () => {
  it('returns the hostname when cookie is registered', async () => {
    const event = mockEvent({ 'caribou.instance': 'mastodon.social' })
    expect(await getInstance(event, deps)).toBe('mastodon.social')
  })

  it('returns undefined when cookie is missing', async () => {
    const event = mockEvent({})
    expect(await getInstance(event, deps)).toBeUndefined()
  })

  it('rejects unregistered hostname (registry membership filter)', async () => {
    const event = mockEvent({ 'caribou.instance': 'evil.com' })
    expect(await getInstance(event, deps)).toBeUndefined()
  })

  it('rejects 169.254.169.254 (format check before registry)', async () => {
    const event = mockEvent({ 'caribou.instance': '169.254.169.254' })
    expect(await getInstance(event, deps)).toBeUndefined()
  })

  it('rejects localhost (no dot)', async () => {
    const event = mockEvent({ 'caribou.instance': 'localhost' })
    expect(await getInstance(event, deps)).toBeUndefined()
  })

  it('rejects IPv6 literals', async () => {
    const event = mockEvent({ 'caribou.instance': '[::1]' })
    expect(await getInstance(event, deps)).toBeUndefined()
  })

  it('rejects embedded \\r\\n', async () => {
    const event = mockEvent({ 'caribou.instance': 'a.com%0d%0aevil' })
    expect(await getInstance(event, deps)).toBeUndefined()
  })

  it('rejects userinfo (@)', async () => {
    const event = mockEvent({ 'caribou.instance': 'user@evil.com' })
    expect(await getInstance(event, deps)).toBeUndefined()
  })

  it('rejects host:port form', async () => {
    const event = mockEvent({ 'caribou.instance': 'mastodon.social:8080' })
    expect(await getInstance(event, deps)).toBeUndefined()
  })

  it('rejects empty cookie value', async () => {
    const event = mockEvent({ 'caribou.instance': '' })
    expect(await getInstance(event, deps)).toBeUndefined()
  })
})

describe('setInstance / clearInstance', () => {
  it('setInstance sets a Secure HttpOnly SameSite=Lax cookie with one-year max-age', () => {
    const event = mockEvent({})
    setInstance(event, 'mastodon.social')
    const headers = (event as unknown as { _headers: Map<string, string[]> })._headers.get('set-cookie')
    expect(headers?.[0]).toMatch(/^caribou\.instance=mastodon\.social/)
    expect(headers?.[0]).toMatch(/Secure/i)
    expect(headers?.[0]).toMatch(/HttpOnly/i)
    expect(headers?.[0]).toMatch(/SameSite=Lax/i)
    expect(headers?.[0]).toMatch(/Max-Age=31536000/)
  })

  it('clearInstance sets max-age=0', () => {
    const event = mockEvent({})
    clearInstance(event)
    const headers = (event as unknown as { _headers: Map<string, string[]> })._headers.get('set-cookie')
    expect(headers?.[0]).toMatch(/Max-Age=0/)
  })
})
