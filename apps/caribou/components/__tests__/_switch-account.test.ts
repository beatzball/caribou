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

  it('still loads the page when the cookie write fails', async () => {
    const replace = vi.fn()
    const fetch = vi.fn(async () => { throw new Error('offline') })
    await landAs({ server: 'other.example' }, { fetch: fetch as unknown as typeof globalThis.fetch, replace, path: '/@x/1' })
    expect(replace).toHaveBeenCalledWith('/home')
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
