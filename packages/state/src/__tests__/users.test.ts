import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toUserKey } from '@beatzball/caribou-auth'
import {
  users, activeUserKey, activeUser,
  addUserSession, removeActiveUser,
  loadFromStorage, saveToStorage,
  type UserSession,
} from '../users.js'

const key = toUserKey('beatzball', 'fosstodon.org')

function sampleSession(): UserSession {
  return {
    userKey: key,
    server: 'fosstodon.org',
    token: 'TOKEN-1',
    vapidKey: 'VAPID',
    account: { id: 'a1', username: 'beatzball', acct: 'beatzball' } as UserSession['account'],
    createdAt: 1_700_000_000_000,
  }
}

beforeEach(() => {
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
})

describe('users / activeUserKey', () => {
  it('addUserSession stores it and makes it active', () => {
    addUserSession(sampleSession())
    expect(users.value.size).toBe(1)
    expect(activeUserKey.value).toBe(key)
    expect(activeUser.value?.userKey).toBe(key)
  })

  it('removeActiveUser removes entry and clears activeUserKey', () => {
    addUserSession(sampleSession())
    removeActiveUser()
    expect(users.value.size).toBe(0)
    expect(activeUserKey.value).toBeNull()
    expect(activeUser.value).toBeNull()
  })
})

describe('persistence', () => {
  it('saveToStorage writes entries + activeUserKey to localStorage', () => {
    addUserSession(sampleSession())
    saveToStorage()
    const raw = localStorage.getItem('caribou.users')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed).toEqual([[key, expect.objectContaining({ userKey: key })]])
    expect(localStorage.getItem('caribou.activeUserKey')).toBe(JSON.stringify(key))
  })

  it('loadFromStorage hydrates the signals', () => {
    localStorage.setItem('caribou.users', JSON.stringify([[key, sampleSession()]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(key))
    loadFromStorage()
    expect(activeUser.value?.token).toBe('TOKEN-1')
  })

  it('loadFromStorage is a no-op on empty storage', () => {
    loadFromStorage()
    expect(users.value.size).toBe(0)
    expect(activeUserKey.value).toBeNull()
  })

  it('loadFromStorage recovers when stored activeUserKey is not in users', () => {
    localStorage.setItem('caribou.users', JSON.stringify([]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(key))
    loadFromStorage()
    expect(activeUserKey.value).toBeNull()
  })

  it('loadFromStorage resets signals when stored payload is malformed', () => {
    localStorage.setItem('caribou.users', '{not-json')
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(key))
    loadFromStorage()
    expect(users.value.size).toBe(0)
    expect(activeUserKey.value).toBeNull()
  })

  it('removeActiveUser is a no-op when no user is active', () => {
    expect(() => removeActiveUser()).not.toThrow()
    expect(users.value.size).toBe(0)
    expect(activeUserKey.value).toBeNull()
  })
})

describe('activeClient', () => {
  it('is null when no active user', async () => {
    const { activeClient } = await import('../users.js')
    expect(activeClient.value).toBeNull()
  })

  it('returns a CaribouClient bound to the active user when present', async () => {
    const { activeClient } = await import('../users.js')
    addUserSession(sampleSession())
    expect(activeClient.value).not.toBeNull()
    expect(activeClient.value?.userKey).toBe(key)
  })

  it('dispatches `caribou:unauthorized` when the client session source is triggered', async () => {
    const { activeClient } = await import('../users.js')
    addUserSession(sampleSession())
    const client = activeClient.value
    expect(client).not.toBeNull()
    const spy = vi.fn()
    window.addEventListener('caribou:unauthorized', spy)
    window.dispatchEvent(new Event('caribou:unauthorized'))
    expect(spy).toHaveBeenCalledOnce()
    window.removeEventListener('caribou:unauthorized', spy)
  })

  it('emits caribou:unauthorized on the window when the client hits a 401', async () => {
    const { activeClient } = await import('../users.js')
    addUserSession(sampleSession())
    const client = activeClient.value
    expect(client).not.toBeNull()
    const spy = vi.fn()
    window.addEventListener('caribou:unauthorized', spy)
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401, headers: { 'content-type': 'application/json' },
      }),
    ) as typeof fetch
    try {
      await expect(client!.fetchTimeline('home')).rejects.toMatchObject({ code: 'unauthorized' })
      expect(spy).toHaveBeenCalledOnce()
    } finally {
      globalThis.fetch = originalFetch
      window.removeEventListener('caribou:unauthorized', spy)
    }
  })
})
