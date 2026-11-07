import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toUserKey } from '@beatzball/caribou-auth'
import { CaribouError, type CaribouClient, type Capabilities } from '@beatzball/caribou-mastodon-client'
import {
  users, activeUserKey, activeUser, activeClient,
  addUserSession, markExpired, userName, loadFromStorage, signOutBluesky,
  type UserSession, type BlueskySession,
} from '../users.js'
import {
  setBlueskyDriver, blueskyRestore, blueskyUserKey, isBlueskySession,
  BlueskySessionGone,
  type BlueskyDriver,
} from '../bluesky-session.js'

const CAPS = { network: 'bluesky', readLagMs: 60_000 } as unknown as Capabilities

const bskyKey = blueskyUserKey('did:plc:alice')
const mastoKey = toUserKey('bob', 'example.social')

function bsky(over: Partial<BlueskySession> = {}): BlueskySession {
  return {
    network: 'bluesky', userKey: bskyKey, did: 'did:plc:alice', handle: 'alice.example.com',
    pds: 'https://pds.example.test', generation: 'B1', account: null, createdAt: 1, ...over,
  }
}

function masto(): UserSession {
  return {
    userKey: mastoKey, server: 'example.social', token: 'T', vapidKey: 'V', generation: 'M1',
    account: null, createdAt: 1,
  }
}

function fakeClient(): CaribouClient {
  return {
    userKey: bskyKey,
    capabilities: CAPS,
    timelineOrder: () => null,
    fetchStatus: vi.fn(async (id: string) => ({ id })),
    verifyCredentials: vi.fn(async () => ({ id: 'did:plc:alice', acct: 'alice.example.com' })),
  } as unknown as CaribouClient
}

function driver(over: Partial<BlueskyDriver> = {}): BlueskyDriver & { restore: ReturnType<typeof vi.fn>; signOut: ReturnType<typeof vi.fn> } {
  const d = {
    capabilities: CAPS,
    timelineOrder: () => null,
    restore: vi.fn(async () => fakeClient()),
    signOut: vi.fn(async () => {}),
    ...over,
  }
  return d as never
}

let expiredEvents: unknown[] = []
let unauthorizedEvents: unknown[] = []
const onExpired = (e: Event) => { expiredEvents.push((e as CustomEvent).detail) }
const onUnauthorized = (e: Event) => { unauthorizedEvents.push((e as CustomEvent).detail) }

beforeEach(() => {
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
  setBlueskyDriver(null)
  expiredEvents = []
  unauthorizedEvents = []
  window.addEventListener('caribou:session-expired', onExpired)
  window.addEventListener('caribou:unauthorized', onUnauthorized)
})

afterEach(() => {
  window.removeEventListener('caribou:session-expired', onExpired)
  window.removeEventListener('caribou:unauthorized', onUnauthorized)
})

describe('Bluesky session shape', () => {
  it('the user key is <did>@bsky', () => {
    expect(bskyKey).toBe('did:plc:alice@bsky')
  })

  it('tells the two kinds apart', () => {
    expect(isBlueskySession(bsky())).toBe(true)
    expect(isBlueskySession(masto())).toBe(false)
  })

  it('userName is the handle', () => {
    expect(userName(bsky())).toBe('alice.example.com')
    expect(userName(bsky({ account: { acct: 'new.example.com' } as never }))).toBe('alice.example.com')
  })

  it('survives a reload from storage, with its generation', () => {
    addUserSession(bsky())
    users.value = new Map()
    loadFromStorage()
    expect(activeUser.value).toMatchObject({ network: 'bluesky', did: 'did:plc:alice', generation: 'B1' })
  })
})

describe('activeClient for Bluesky (rules 8 to 10)', () => {
  it('answers userKey, capabilities and timelineOrder at once, before any restore', () => {
    const d = driver()
    setBlueskyDriver(d)
    addUserSession(bsky())
    const client = activeClient.value!
    expect(client.userKey).toBe(bskyKey)
    expect(client.capabilities).toBe(CAPS)
    expect(client.timelineOrder('home')).toBeNull()
    expect(d.restore).not.toHaveBeenCalled()
  })

  it('restores once, then every call runs on the real client', async () => {
    const real = fakeClient()
    const d = driver({ restore: vi.fn(async () => real) })
    setBlueskyDriver(d)
    addUserSession(bsky())
    const client = activeClient.value!
    const [a, b] = await Promise.all([client.fetchStatus('x'), client.fetchStatus('y')])
    expect(a).toEqual({ id: 'x' })
    expect(b).toEqual({ id: 'y' })
    await client.verifyCredentials()
    expect(d.restore).toHaveBeenCalledTimes(1)
    expect(d.restore.mock.calls[0]![0]).toMatchObject({ did: 'did:plc:alice', generation: 'B1' })
    expect(blueskyRestore.value).toBe('ready')
  })

  it('shows pending while the restore runs', async () => {
    let resolve!: (c: CaribouClient) => void
    setBlueskyDriver(driver({ restore: vi.fn(() => new Promise<CaribouClient>((r) => { resolve = r })) }))
    addUserSession(bsky())
    const call = activeClient.value!.fetchStatus('x')
    expect(blueskyRestore.value).toBe('pending')
    resolve(fakeClient())
    await call
    expect(blueskyRestore.value).toBe('ready')
  })

  it('a network error fails the call, changes no session, and the next call retries', async () => {
    const restore = vi.fn()
      .mockRejectedValueOnce(new CaribouError('unreachable', 'offline'))
      .mockResolvedValueOnce(fakeClient())
    setBlueskyDriver(driver({ restore }))
    addUserSession(bsky())
    const client = activeClient.value!
    await expect(client.fetchStatus('x')).rejects.toMatchObject({ code: 'unreachable' })
    expect(blueskyRestore.value).toBe('failed')
    expect(users.value.get(bskyKey)?.expired).toBeUndefined()
    expect(expiredEvents).toEqual([])
    await expect(client.fetchStatus('x')).resolves.toEqual({ id: 'x' })
    expect(restore).toHaveBeenCalledTimes(2)
  })

  it('a session the SDK calls gone sends session-expired with its generation, never unauthorized', async () => {
    const restore = vi.fn(async () => { throw new BlueskySessionGone('refresh refused') })
    setBlueskyDriver(driver({ restore }))
    addUserSession(bsky())
    const client = activeClient.value!
    await expect(client.fetchStatus('x')).rejects.toMatchObject({ code: 'unauthorized' })
    await expect(client.fetchStatus('y')).rejects.toMatchObject({ code: 'unauthorized' })
    expect(restore).toHaveBeenCalledTimes(1)
    expect(expiredEvents).toEqual([{ userKey: bskyKey, generation: 'B1' }])
    expect(unauthorizedEvents).toEqual([])
  })

  it('the client hands the driver an onExpired that names its own sign-in', async () => {
    const d = driver()
    setBlueskyDriver(d)
    addUserSession(bsky())
    await activeClient.value!.fetchStatus('x')
    const hooks = d.restore.mock.calls[0]![1] as { onExpired(): void }
    // A re-sign-in made a new generation; the old client's late event is stale.
    addUserSession(bsky({ generation: 'B2' }))
    hooks.onExpired()
    expect(expiredEvents).toEqual([{ userKey: bskyKey, generation: 'B1' }])
    expect(markExpired(bskyKey, 'B1')).toBe('stale')
    expect(users.value.get(bskyKey)?.expired).toBeUndefined()
  })

  it('with no driver, every call fails with unauthorized and nothing restores', async () => {
    addUserSession(bsky())
    await expect(activeClient.value!.fetchStatus('x')).rejects.toBeInstanceOf(CaribouError)
    await expect(activeClient.value!.fetchStatus('x')).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('a Mastodon session still gets the Mastodon client', () => {
    const d = driver()
    setBlueskyDriver(d)
    addUserSession(masto())
    expect(activeClient.value!.capabilities.network).toBe('mastodon')
    expect(d.restore).not.toHaveBeenCalled()
  })
})

describe('expiry keeps the session (rule 3), and a sign-in clears it (rule 11)', () => {
  it('marks expired, keeps drafts, prefs and the active account', () => {
    addUserSession(masto())
    addUserSession(bsky())
    localStorage.setItem(`caribou.drafts.${bskyKey}`, '["draft"]')
    localStorage.setItem(`caribou.prefs.${bskyKey}`, '{}')
    expect(markExpired(bskyKey, 'B1')).toBe('marked')
    expect(users.value.get(bskyKey)?.expired).toBe(true)
    expect(activeUserKey.value).toBe(bskyKey)
    expect(localStorage.getItem(`caribou.drafts.${bskyKey}`)).toBe('["draft"]')
    expect(users.value.get(mastoKey)).toMatchObject({ token: 'T', generation: 'M1' })
  })

  it('a new sign-in to the same DID clears expired and makes a new generation', () => {
    addUserSession(bsky())
    markExpired(bskyKey, 'B1')
    addUserSession({ ...bsky(), generation: undefined } as never)
    const entry = users.value.get(bskyKey)!
    expect(entry.expired).toBeUndefined()
    expect(entry.generation).not.toBe('B1')
  })
})

describe('signOutBluesky (rule 12)', () => {
  it('revokes, then drops the entry, its prefs and drafts; the Mastodon session stays', async () => {
    const d = driver()
    setBlueskyDriver(d)
    addUserSession(masto())
    addUserSession(bsky())
    localStorage.setItem(`caribou.drafts.${bskyKey}`, '["draft"]')
    const next = await signOutBluesky(bskyKey, 'B1')
    expect(d.signOut).toHaveBeenCalledWith('did:plc:alice')
    expect(users.value.has(bskyKey)).toBe(false)
    expect(localStorage.getItem(`caribou.drafts.${bskyKey}`)).toBeNull()
    expect(users.value.get(mastoKey)).toMatchObject({ token: 'T' })
    expect(activeUserKey.value).toBe(mastoKey)
    expect(next?.userKey).toBe(mastoKey)
    expect(fetchCalls()).toEqual([])
  })

  it('a failed revoke still drops the entry', async () => {
    setBlueskyDriver(driver({ signOut: vi.fn(async () => { throw new Error('offline') }) }))
    addUserSession(bsky())
    await signOutBluesky(bskyKey, 'B1')
    expect(users.value.has(bskyKey)).toBe(false)
    expect(activeUserKey.value).toBeNull()
  })

  it('a sign-out of an older sign-in leaves the newer one', async () => {
    setBlueskyDriver(driver())
    addUserSession(bsky({ generation: 'B2' }))
    await signOutBluesky(bskyKey, 'B1')
    expect(users.value.get(bskyKey)?.generation).toBe('B2')
  })
})

// The sign-out must not call the Mastodon route.
const fetchSpy = vi.fn()
function fetchCalls(): unknown[] { return fetchSpy.mock.calls }
beforeEach(() => {
  fetchSpy.mockReset()
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => { vi.unstubAllGlobals() })
