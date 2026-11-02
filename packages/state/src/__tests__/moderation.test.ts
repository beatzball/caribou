import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import type { UserKey } from '@beatzball/caribou-auth'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import {
  isMutedOrBlocked, relationshipCache, relationshipKey, setBlock, setMute, toggleFollow,
} from '../relationships.js'
import { activeUserKey } from '../users.js'

const ME = 'alice@example.social' as UserKey
const BOB = { id: '7', acct: 'bob', locked: false }

function rel(id: string, patch: Partial<mastodon.v1.Relationship> = {}): mastodon.v1.Relationship {
  return { id, following: false, requested: false, muting: false, blocking: false, ...patch } as mastodon.v1.Relationship
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function fakeClient(over: Partial<CaribouClient> = {}): CaribouClient {
  return {
    userKey: ME,
    mute: vi.fn(async (id: string) => rel(id, { muting: true, mutingNotifications: true })),
    unmute: vi.fn(async (id: string) => rel(id)),
    block: vi.fn(async (id: string) => rel(id, { blocking: true })),
    unblock: vi.fn(async (id: string) => rel(id)),
    follow: vi.fn(async (id: string) => rel(id, { following: true })),
    ...over,
  } as unknown as CaribouClient
}

const cached = (id: string) => relationshipCache.value.get(relationshipKey(ME, id))
const seed = (r: mastodon.v1.Relationship) => {
  relationshipCache.value = new Map([[relationshipKey(ME, r.id), r]])
}

let toasts: { kind: string; message: string }[]
const onToast = (e: Event) => toasts.push((e as CustomEvent).detail)

beforeEach(() => {
  relationshipCache.value = new Map()
  toasts = []
  window.addEventListener('caribou:toast', onToast)
})
afterEach(() => {
  window.removeEventListener('caribou:toast', onToast)
  activeUserKey.value = null
})

describe('setMute', () => {
  it('marks the account muted at once, then keeps the server answer', async () => {
    const d = deferred<mastodon.v1.Relationship>()
    const client = fakeClient({ mute: vi.fn(() => d.promise) })
    const done = setMute(BOB, true, { clientSource: () => client })
    expect(cached('7')?.muting).toBe(true)
    activeUserKey.value = ME
    expect(isMutedOrBlocked('7')).toBe(true)
    d.resolve(rel('7', { muting: true, followedBy: true }))
    expect(await done).toBe(true)
    expect(cached('7')?.followedBy).toBe(true)
  })

  it('a failed mute takes the account out of the cache again and says so', async () => {
    const client = fakeClient({ mute: vi.fn(async () => { throw new Error('boom') }) })
    expect(await setMute(BOB, true, { clientSource: () => client })).toBe(false)
    expect(cached('7')).toBeUndefined()
    expect(toasts).toEqual([{ kind: 'error', message: "Couldn't mute @bob." }])
  })

  it('a failed unmute puts the mute back and keeps the other fields', async () => {
    seed(rel('7', { muting: true, mutingNotifications: true, following: true }))
    const client = fakeClient({ unmute: vi.fn(async () => { throw new Error('boom') }) })
    const done = setMute(BOB, false, { clientSource: () => client })
    expect(cached('7')?.muting).toBe(false)
    expect(await done).toBe(false)
    expect(cached('7')).toMatchObject({ muting: true, mutingNotifications: true, following: true })
    expect(toasts[0]!.message).toBe("Couldn't unmute @bob.")
  })

  it('a second mute while the first is out is dropped', async () => {
    const d = deferred<mastodon.v1.Relationship>()
    const client = fakeClient({ mute: vi.fn(() => d.promise) })
    const first = setMute(BOB, true, { clientSource: () => client })
    expect(await setMute(BOB, true, { clientSource: () => client })).toBe(false)
    d.resolve(rel('7', { muting: true }))
    await first
    expect(client.mute).toHaveBeenCalledTimes(1)
  })

  it('a failed mute keeps a follow that finished meanwhile', async () => {
    const m = deferred<mastodon.v1.Relationship>()
    const client = fakeClient({ mute: vi.fn(() => m.promise) })
    const muting = setMute(BOB, true, { clientSource: () => client })
    await toggleFollow(BOB, { clientSource: () => client })
    m.reject(new Error('boom'))
    await muting
    expect(cached('7')).toMatchObject({ following: true, muting: false })
  })

  it('does nothing without a client', async () => {
    expect(await setMute(BOB, true, { clientSource: () => null })).toBe(false)
    expect(cached('7')).toBeUndefined()
  })
})

describe('setBlock', () => {
  it('blocks at once and drops the follow with it', async () => {
    seed(rel('7', { following: true }))
    const d = deferred<mastodon.v1.Relationship>()
    const client = fakeClient({ block: vi.fn(() => d.promise) })
    const done = setBlock(BOB, true, { clientSource: () => client })
    expect(cached('7')).toMatchObject({ blocking: true, following: false })
    d.resolve(rel('7', { blocking: true }))
    expect(await done).toBe(true)
  })

  it('a failed block puts the follow back', async () => {
    seed(rel('7', { following: true }))
    const client = fakeClient({ block: vi.fn(async () => { throw new Error('boom') }) })
    expect(await setBlock(BOB, true, { clientSource: () => client })).toBe(false)
    expect(cached('7')).toMatchObject({ blocking: false, following: true })
    expect(toasts[0]!.message).toBe("Couldn't block @bob.")
  })

  it('unblock clears the block', async () => {
    seed(rel('7', { blocking: true }))
    const client = fakeClient()
    expect(await setBlock(BOB, false, { clientSource: () => client })).toBe(true)
    expect(client.unblock).toHaveBeenCalledWith('7')
    expect(cached('7')?.blocking).toBe(false)
  })
})

describe('isMutedOrBlocked', () => {
  it('is false for an account the cache knows nothing about, or with nobody signed in', () => {
    seed(rel('7', { blocking: true }))
    expect(isMutedOrBlocked('7', null)).toBe(false)
    expect(isMutedOrBlocked('8', ME)).toBe(false)
    expect(isMutedOrBlocked('7', ME)).toBe(true)
  })
})
