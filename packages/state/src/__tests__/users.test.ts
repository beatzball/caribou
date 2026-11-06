import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toUserKey } from '@beatzball/caribou-auth'
import {
  users, activeUserKey, activeUser,
  addUserSession, removeActiveUser, removeSession, switchAccount, signOutActive, nextAccountKey, isOwnAccount, userName, loadActiveAccount,
  loadFromStorage, saveToStorage, markExpired, emitSessionExpired,
  type UserSession,
} from '../users.js'

const key = toUserKey('beatzball', 'fosstodon.org')

function sampleSession(): UserSession {
  return {
    userKey: key,
    server: 'fosstodon.org',
    token: 'TOKEN-1',
    generation: 'G1',
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

  it('loadFromStorage fills a missing userKey from the map key', () => {
    const { userKey: _, ...stored } = sampleSession()
    localStorage.setItem('caribou.users', JSON.stringify([[key, stored]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(key))
    loadFromStorage()
    expect(users.value.get(key)?.userKey).toBe(key)
    expect(removeSession(key, 'G1')).toBe('active')
  })

  it('loadFromStorage fills a missing generation from the token, so the guard still works', () => {
    const { generation: _, ...stored } = sampleSession()
    localStorage.setItem('caribou.users', JSON.stringify([[key, stored]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(key))
    loadFromStorage()
    expect(users.value.get(key)?.generation).toBe('TOKEN-1')
    expect(removeSession(key, 'TOKEN-0')).toBe('stale')
    expect(removeSession(key, 'TOKEN-1')).toBe('active')
  })

  it('loadFromStorage keeps a stored generation and expired', () => {
    localStorage.setItem('caribou.users', JSON.stringify([[key, { ...sampleSession(), expired: true }]]))
    loadFromStorage()
    expect(users.value.get(key)).toMatchObject({ generation: 'G1', expired: true })
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

describe('a session without its account (as sign-in stores it)', () => {
  const bare = { userKey: key, account: null }

  it('userName falls back to the handle in the user key', () => {
    expect(userName(bare)).toBe('beatzball')
    expect(userName(sampleSession())).toBe('beatzball')
  })

  it('isOwnAccount compares ids with the account, handles without it', () => {
    expect(isOwnAccount(sampleSession(), { id: 'a1', acct: 'other' })).toBe(true)
    expect(isOwnAccount(sampleSession(), { id: 'a2', acct: 'beatzball' })).toBe(false)
    expect(isOwnAccount(bare, { id: 'x', acct: 'beatzball' })).toBe(true)
    expect(isOwnAccount(bare, { id: 'x', acct: 'beatzball@elsewhere.social' })).toBe(false)
  })
})

describe('loadActiveAccount', () => {
  function bareSession(): UserSession {
    return { ...sampleSession(), account: null }
  }

  it('stores the verify_credentials account for a session without one', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ id: 'a1', username: 'beatzball', acct: 'beatzball' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    addUserSession(bareSession())
    await loadActiveAccount()
    expect((fetchSpy.mock.calls[0]?.[0] as Request).url).toContain('/api/v1/accounts/verify_credentials')
    expect(activeUser.value?.account?.id).toBe('a1')
    const stored = JSON.parse(localStorage.getItem('caribou.users')!) as [string, UserSession][]
    expect(stored[0]![1].account?.id).toBe('a1')
    fetchSpy.mockRestore()
  })

  it('does nothing when the account is already stored', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    addUserSession(sampleSession())
    await loadActiveAccount()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('leaves the account null when the request fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 500 }))
    addUserSession(bareSession())
    await loadActiveAccount()
    expect(activeUser.value?.account).toBeNull()
    fetchSpy.mockRestore()
  })

  it('drops a late answer when the session was replaced while it loaded', async () => {
    let answer!: (r: Response) => void
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise((r) => { answer = r }))
    addUserSession(bareSession())
    const loading = loadActiveAccount()
    removeActiveUser()
    addUserSession({ ...bareSession(), token: 'TOKEN-2', generation: 'G2' })
    answer(new Response(
      JSON.stringify({ id: 'old', username: 'beatzball', acct: 'beatzball' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    await loading
    expect(activeUser.value?.token).toBe('TOKEN-2')
    expect(activeUser.value?.account).toBeNull()
    fetchSpy.mockRestore()
  })
})

describe('removeSession (a 401 for one client)', () => {
  const other = toUserKey('alice', 'example.social')

  function otherSession(): UserSession {
    return {
      userKey: other, server: 'example.social', token: 'TOKEN-A', generation: 'GA', vapidKey: 'VAPID',
      account: null, createdAt: 1_700_000_000_001,
    }
  }

  function seedLocal(k: string): void {
    localStorage.setItem(`caribou.prefs.${k}`, '{}')
    localStorage.setItem(`caribou.drafts.${k}`, '[]')
  }

  // Rule 4: a 401 removes the session but keeps its prefs and drafts. Only a
  // sign-out deletes them (rule 6).
  it('removes the active session when the generation matches, and keeps its prefs and drafts', () => {
    addUserSession(sampleSession())
    seedLocal(key)
    expect(removeSession(key, 'G1')).toBe('active')
    expect(users.value.has(key)).toBe(false)
    expect(activeUserKey.value).toBeNull()
    expect(localStorage.getItem(`caribou.prefs.${key}`)).toBe('{}')
    expect(localStorage.getItem(`caribou.drafts.${key}`)).toBe('[]')
    expect(JSON.parse(localStorage.getItem('caribou.users')!)).toEqual([])
  })

  it('a new sign-in to the same account finds the drafts a 401 kept', () => {
    addUserSession(sampleSession())
    seedLocal(key)
    removeSession(key, 'G1')
    addUserSession({ ...sampleSession(), token: 'TOKEN-2', generation: 'G2' })
    expect(localStorage.getItem(`caribou.drafts.${key}`)).toBe('[]')
  })

  it('keeps a session that was replaced under the same key', () => {
    addUserSession({ ...sampleSession(), token: 'TOKEN-2', generation: 'G2' })
    seedLocal(key)
    expect(removeSession(key, 'G1')).toBe('stale')
    expect(users.value.get(key)?.token).toBe('TOKEN-2')
    expect(activeUserKey.value).toBe(key)
    expect(localStorage.getItem(`caribou.prefs.${key}`)).toBe('{}')
    expect(localStorage.getItem(`caribou.drafts.${key}`)).toBe('[]')
  })

  it('does nothing for a session that is already gone', () => {
    addUserSession(sampleSession())
    expect(removeSession(other, 'GA')).toBe('stale')
    expect(users.value.size).toBe(1)
    expect(activeUserKey.value).toBe(key)
  })

  it('removes only the non-active session when two are stored', () => {
    addUserSession(otherSession())
    addUserSession(sampleSession())
    seedLocal(key)
    seedLocal(other)
    expect(removeSession(other, 'GA')).toBe('inactive')
    expect([...users.value.keys()]).toEqual([key])
    expect(activeUserKey.value).toBe(key)
    expect(localStorage.getItem(`caribou.prefs.${other}`)).toBe('{}')
    expect(localStorage.getItem(`caribou.drafts.${other}`)).toBe('[]')
    expect(localStorage.getItem(`caribou.prefs.${key}`)).toBe('{}')
    expect(localStorage.getItem(`caribou.drafts.${key}`)).toBe('[]')
    expect(JSON.parse(localStorage.getItem('caribou.activeUserKey')!)).toBe(key)
  })
})

describe('the 401 event', () => {
  it('names the session of the client that got the 401, not the one active now', async () => {
    const { activeClient } = await import('../users.js')
    addUserSession(sampleSession())
    const client = activeClient.value!
    // Another session becomes active while the first client's request is in flight.
    addUserSession({ ...sampleSession(), userKey: toUserKey('alice', 'example.social'), token: 'TOKEN-A', generation: 'GA' })
    const details: unknown[] = []
    const listener = (e: Event) => { details.push((e as CustomEvent).detail) }
    window.addEventListener('caribou:unauthorized', listener)
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401, headers: { 'content-type': 'application/json' },
      }),
    ) as typeof fetch
    try {
      await expect(client.fetchTimeline('home')).rejects.toMatchObject({ code: 'unauthorized' })
      expect(details).toEqual([{ userKey: key, generation: 'G1' }])
    } finally {
      globalThis.fetch = originalFetch
      window.removeEventListener('caribou:unauthorized', listener)
    }
  })
})

describe('several accounts', () => {
  const a = toUserKey('alice', 'example.social')
  const b = toUserKey('bob', 'other.example')
  const c = toUserKey('carol', 'example.social')
  function s(userKey: typeof a, server: string): UserSession {
    return { userKey, server, token: `T-${userKey}`, generation: `G-${userKey}`, vapidKey: 'V', account: null, createdAt: 1 }
  }
  function seed(...keys: (typeof a)[]): void {
    for (const k of keys) addUserSession(s(k, k.slice(k.indexOf('@') + 1)))
  }

  it('switchAccount makes a stored account active and saves it', () => {
    seed(a, b)
    expect(activeUserKey.value).toBe(b)
    expect(switchAccount(a)).toBe(true)
    expect(activeUserKey.value).toBe(a)
    expect(localStorage.getItem('caribou.activeUserKey')).toBe(JSON.stringify(a))
    expect(users.value.size).toBe(2)
  })

  it('switchAccount refuses an account that is not stored', () => {
    seed(a)
    expect(switchAccount(b)).toBe(false)
    expect(activeUserKey.value).toBe(a)
  })

  it('signOutActive with no active account does nothing', () => {
    expect(signOutActive()).toBeNull()
    expect(users.value.size).toBe(0)
  })

  it('signOutActive of the only account leaves none active', () => {
    seed(a)
    localStorage.setItem(`caribou.drafts.${a}`, '{}')
    expect(signOutActive()).toBeNull()
    expect(users.value.size).toBe(0)
    expect(activeUserKey.value).toBeNull()
    expect(localStorage.getItem('caribou.activeUserKey')).toBe('null')
    expect(localStorage.getItem(`caribou.drafts.${a}`)).toBeNull()
  })

  it('signOutActive with one other account makes that one active', () => {
    seed(a, b)
    localStorage.setItem(`caribou.prefs.${a}`, '{}')
    const next = signOutActive()
    expect(next?.userKey).toBe(a)
    expect(next?.server).toBe('example.social')
    expect(activeUserKey.value).toBe(a)
    expect(Array.from(users.value.keys())).toEqual([a])
    expect(localStorage.getItem('caribou.activeUserKey')).toBe(JSON.stringify(a))
    // Only the signed-out account's local data goes.
    expect(localStorage.getItem(`caribou.prefs.${a}`)).toBe('{}')
  })

  it('signOutActive with two others picks the next one in the list', () => {
    seed(a, b, c)
    switchAccount(b)
    expect(signOutActive()?.userKey).toBe(c)
    expect(Array.from(users.value.keys())).toEqual([a, c])
  })

  it('signOutActive of the last in the list wraps to the first', () => {
    seed(a, b, c)
    expect(signOutActive()?.userKey).toBe(a)
    expect(Array.from(users.value.keys())).toEqual([a, b])
  })

  it('nextAccountKey picks the next one, wraps, and is null when alone', () => {
    expect(nextAccountKey([a, b, c], a)).toBe(b)
    expect(nextAccountKey([a, b, c], c)).toBe(a)
    expect(nextAccountKey([a], a)).toBeNull()
    expect(nextAccountKey([], a)).toBeNull()
    expect(nextAccountKey([b, c], a)).toBe(b)
  })
})

describe('generation (rule 1: a sign-in always wins)', () => {
  it('a sign-in without a generation gets a new one each time', () => {
    const { generation: _, ...noGen } = sampleSession()
    addUserSession(noGen)
    const first = users.value.get(key)!.generation
    addUserSession(noGen)
    const second = users.value.get(key)!.generation
    expect(first).toMatch(/^[0-9a-f]{32}$/)
    expect(second).toMatch(/^[0-9a-f]{32}$/)
    expect(second).not.toBe(first)
  })

  it('a sign-in clears expired', () => {
    addUserSession(sampleSession())
    markExpired(key, 'G1')
    addUserSession({ ...sampleSession(), token: 'TOKEN-2', generation: 'G2' })
    expect(users.value.get(key)?.expired).toBeUndefined()
    addUserSession({ ...sampleSession(), expired: true } as UserSession)
    expect(users.value.get(key)?.expired).toBeUndefined()
  })
})

describe('markExpired (rule 3: credentials gone)', () => {
  const other = toUserKey('alice', 'example.social')

  function seedLocal(k: string): void {
    localStorage.setItem(`caribou.prefs.${k}`, '{"theme":"light"}')
    localStorage.setItem(`caribou.drafts.${k}`, '{"new":{"text":"half a post"}}')
  }

  it('marks the session and keeps it, its prefs, its drafts and the active account', () => {
    addUserSession(sampleSession())
    seedLocal(key)
    expect(markExpired(key, 'G1')).toBe('marked')
    expect(users.value.get(key)).toMatchObject({ generation: 'G1', token: 'TOKEN-1', expired: true })
    expect(activeUserKey.value).toBe(key)
    expect(localStorage.getItem(`caribou.prefs.${key}`)).toBe('{"theme":"light"}')
    expect(localStorage.getItem(`caribou.drafts.${key}`)).toBe('{"new":{"text":"half a post"}}')
    const stored = JSON.parse(localStorage.getItem('caribou.users')!) as [string, UserSession][]
    expect(stored[0]![1].expired).toBe(true)
  })

  it('marking twice is the same as once', () => {
    addUserSession(sampleSession())
    markExpired(key, 'G1')
    const after = users.value
    expect(markExpired(key, 'G1')).toBe('marked')
    expect(users.value).toBe(after)
  })

  it('ignores an old expiry after a new sign-in', () => {
    addUserSession(sampleSession())
    addUserSession({ ...sampleSession(), token: 'TOKEN-2', generation: 'G2' })
    expect(markExpired(key, 'G1')).toBe('stale')
    expect(users.value.get(key)?.expired).toBeUndefined()
  })

  it('ignores an expiry for a session that is gone', () => {
    expect(markExpired(key, 'G1')).toBe('stale')
    expect(users.value.size).toBe(0)
  })

  it('leaves the other account alone, active or not', () => {
    addUserSession({ ...sampleSession(), userKey: other, generation: 'GA' })
    addUserSession(sampleSession())
    seedLocal(other)
    markExpired(other, 'GA')
    expect(users.value.get(key)?.expired).toBeUndefined()
    expect(users.value.get(other)?.expired).toBe(true)
    expect(activeUserKey.value).toBe(key)
    markExpired(key, 'G1')
    expect(activeUserKey.value).toBe(key)
    expect([...users.value.keys()]).toEqual([other, key])
    expect(localStorage.getItem(`caribou.drafts.${other}`)).toBe('{"new":{"text":"half a post"}}')
  })

  it('a 401 for the same sign-in still removes an expired session', () => {
    addUserSession(sampleSession())
    markExpired(key, 'G1')
    expect(removeSession(key, 'G1')).toBe('active')
  })

  it('emitSessionExpired sends caribou:session-expired on the window', () => {
    const details: unknown[] = []
    const listener = (e: Event) => { details.push((e as CustomEvent).detail) }
    window.addEventListener('caribou:session-expired', listener)
    try {
      emitSessionExpired({ userKey: key, generation: 'G1' })
      expect(details).toEqual([{ userKey: key, generation: 'G1' }])
    } finally {
      window.removeEventListener('caribou:session-expired', listener)
    }
  })

  it('loadActiveAccount keeps expired when it stores the account', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ id: 'a1', username: 'beatzball', acct: 'beatzball' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    addUserSession({ ...sampleSession(), account: null })
    const loading = loadActiveAccount()
    markExpired(key, 'G1')
    await loading
    expect(users.value.get(key)).toMatchObject({ expired: true, account: { id: 'a1' } })
    fetchSpy.mockRestore()
  })
})

describe('rule 5: network errors change no session', () => {
  async function failWith(fetchImpl: () => Promise<Response>) {
    const { activeClient } = await import('../users.js')
    addUserSession(sampleSession())
    localStorage.setItem(`caribou.drafts.${key}`, '[]')
    const before = users.value
    const events: string[] = []
    const listener = (e: Event) => { events.push(e.type) }
    window.addEventListener('caribou:unauthorized', listener)
    window.addEventListener('caribou:session-expired', listener)
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(fetchImpl) as typeof fetch
    try {
      await expect(activeClient.value!.fetchTimeline('home')).rejects.toBeTruthy()
    } finally {
      globalThis.fetch = originalFetch
      window.removeEventListener('caribou:unauthorized', listener)
      window.removeEventListener('caribou:session-expired', listener)
    }
    expect(events).toEqual([])
    expect(users.value).toBe(before)
    expect(activeUserKey.value).toBe(key)
    expect(localStorage.getItem(`caribou.drafts.${key}`)).toBe('[]')
  }

  it('a failed connection', async () => {
    await failWith(async () => { throw new TypeError('Failed to fetch') })
  })

  it('a 503', async () => {
    await failWith(async () => new Response(JSON.stringify({ error: 'down' }), {
      status: 503, headers: { 'content-type': 'application/json' },
    }))
  })
})
