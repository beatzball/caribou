import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toUserKey } from '@beatzball/caribou-auth'
import { activeUserKey, addUserSession, users, type UserSession } from '@beatzball/caribou-state'
import { landAs, pathAfterSwitch, switchToAccount } from '../_switch-account.js'

const a = toUserKey('alice', 'example.social')
const b = toUserKey('bob', 'other.example')
function s(userKey: typeof a, server: string): UserSession {
  return { userKey, server, token: 'T', vapidKey: 'V', account: null, createdAt: 1 }
}

beforeEach(() => {
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
})

describe('pathAfterSwitch', () => {
  it.each([
    ['/home', '/home'],
    ['/notifications', '/notifications'],
    ['/bookmarks', '/bookmarks'],
    ['/local', '/local'],
    ['/public', '/public'],
    ['/about', '/about'],
    ['/blog/some-post', '/blog/some-post'],
    ['/@carol@example.social', '/@carol@example.social'],
    ['/@me', '/@me'],
    ['/@me?tab=media', '/@me?tab=media'],
    ['/notifications?filter=mentions', '/notifications?filter=mentions'],
    ['/@carol@example.social?tab=media', '/@carol@example.social?tab=media'],
    ['/@carol/109999?x=1', '/home'],
    ['/', '/home'],
    ['/@carol', '/home'],
    ['/@carol/109999', '/home'],
    ['/@carol@example.social/109999', '/home'],
  ])('%s -> %s', (from, to) => {
    expect(pathAfterSwitch(from)).toBe(to)
  })
})

describe('landAs', () => {
  it('sets the cookie to the session server, then loads the kept path', async () => {
    const order: string[] = []
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      order.push(`fetch ${init?.body as string}`)
      return new Response(null, { status: 204 })
    })
    const replace = vi.fn((url: string) => { order.push(`replace ${url}`) })
    await landAs({ server: 'other.example' }, { fetch: fetch as unknown as typeof globalThis.fetch, replace, path: '/local' })
    expect(fetch).toHaveBeenCalledWith('/api/instance', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }))
    expect(order).toEqual(['fetch {"server":"other.example"}', 'replace /local'])
  })

  it('tries the cookie write once more when the first one fails', async () => {
    const replace = vi.fn()
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    await landAs({ server: 'other.example' }, { fetch: fetch as unknown as typeof globalThis.fetch, replace, path: '/local' })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(replace).toHaveBeenCalledWith('/local')
  })

  describe('when the cookie write fails twice', () => {
    const failures: [string, () => Promise<Response>][] = [
      ['400', async () => new Response('unknown server', { status: 400 })],
      ['403', async () => new Response('cross-site request', { status: 403 })],
      ['503', async () => new Response(null, { status: 503 })],
      ['a rejected fetch', async () => { throw new Error('offline') }],
    ]

    it.each(failures)('%s: a page that renders from the cookie server goes to /home', async (_, fail) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      for (const path of ['/local', '/public?max_id=9']) {
        const replace = vi.fn()
        const fetch = vi.fn(fail)
        await landAs({ server: 'other.example' }, { fetch: fetch as unknown as typeof globalThis.fetch, replace, path })
        expect(fetch).toHaveBeenCalledTimes(2)
        expect(replace).toHaveBeenCalledWith('/home')
      }
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('other.example'))
      warn.mockRestore()
    })

    it.each(failures)('%s: a page that does not read the cookie is kept', async (_, fail) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      for (const path of ['/notifications', '/@me', '/@carol@example.social']) {
        const replace = vi.fn()
        await landAs({ server: 'other.example' }, { fetch: vi.fn(fail) as unknown as typeof globalThis.fetch, replace, path })
        expect(replace).toHaveBeenCalledWith(path)
      }
      warn.mockRestore()
    })
  })

  it('goes to / with no session and does not touch the cookie', async () => {
    const replace = vi.fn()
    const fetch = vi.fn()
    await landAs(null, { fetch: fetch as unknown as typeof globalThis.fetch, replace })
    expect(fetch).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith('/')
  })
})

describe('switchToAccount', () => {
  it('makes the account active, sets its server, and reloads', async () => {
    addUserSession(s(a, 'example.social'))
    addUserSession(s(b, 'other.example'))
    const fetch = vi.fn(async () => new Response(null, { status: 204 }))
    const replace = vi.fn()
    expect(await switchToAccount(a, { fetch: fetch as unknown as typeof globalThis.fetch, replace, path: '/home' })).toBe(true)
    expect(activeUserKey.value).toBe(a)
    expect(fetch).toHaveBeenCalledWith('/api/instance', expect.objectContaining({ body: '{"server":"example.social"}' }))
    expect(replace).toHaveBeenCalledWith('/home')
  })

  it('does nothing for an account that is not stored', async () => {
    addUserSession(s(b, 'other.example'))
    const replace = vi.fn()
    expect(await switchToAccount(a, { replace })).toBe(false)
    expect(activeUserKey.value).toBe(b)
    expect(replace).not.toHaveBeenCalled()
  })
})
