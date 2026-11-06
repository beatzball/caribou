import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserKey } from '@beatzball/caribou-auth'
import type { CaribouClient, Relationship } from '@beatzball/caribou-mastodon-client'
import {
  _testOnlyResetRelationships, relationshipCache, relationshipKey, setBlock, setMute,
  toggleFollow,
} from '../relationships.js'
import { activeUserKey } from '../users.js'

const ME = 'alice@example.social' as UserKey
const BOB = { id: '7', acct: 'bob', locked: false }

function rel(id: string, patch: Partial<Relationship> = {}): Relationship {
  return { id, following: false, requested: false, muting: false, blocking: false, ...patch } as Relationship
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
const seed = (r: Relationship) => {
  relationshipCache.value = new Map([[relationshipKey(ME, r.id), r]])
}

let toasts: { kind: string; message: string }[]
const onToast = (e: Event) => toasts.push((e as CustomEvent).detail)

beforeEach(() => {
  _testOnlyResetRelationships()
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
    const d = deferred<Relationship>()
    const client = fakeClient({ mute: vi.fn(() => d.promise) })
    const done = setMute(BOB, true, { clientSource: () => client })
    expect(cached('7')?.muting).toBe(true)
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

  it('a second mute while the first is out sends nothing more', async () => {
    const d = deferred<Relationship>()
    const client = fakeClient({ mute: vi.fn(() => d.promise) })
    const first = setMute(BOB, true, { clientSource: () => client })
    expect(await setMute(BOB, true, { clientSource: () => client })).toBe(true)
    d.resolve(rel('7', { muting: true }))
    await first
    expect(client.mute).toHaveBeenCalledTimes(1)
  })

  // Undo is focused the moment Mute is chosen, so it is often pressed
  // before the mute has answered.
  it('an unmute while the mute is out runs after it, and the account ends unmuted', async () => {
    const d = deferred<Relationship>()
    const client = fakeClient({ mute: vi.fn(() => d.promise) })
    const muting = setMute(BOB, true, { clientSource: () => client })
    const unmuting = setMute(BOB, false, { clientSource: () => client })
    expect(cached('7')?.muting).toBe(false)
    expect(client.unmute).not.toHaveBeenCalled()
    d.resolve(rel('7', { muting: true }))
    expect(await muting).toBe(true)
    // The answer to the mute does not show while the unmute waits.
    expect(cached('7')?.muting).toBe(false)
    expect(await unmuting).toBe(true)
    expect(client.unmute).toHaveBeenCalledWith('7')
    expect(cached('7')?.muting).toBe(false)
  })

  it('writes to one account go one at a time, so an older answer cannot undo a newer one', async () => {
    const m = deferred<Relationship>()
    const client = fakeClient({
      mute: vi.fn(() => m.promise),
      block: vi.fn(async (id: string) => rel(id, { muting: true, blocking: true })),
    })
    const muting = setMute(BOB, true, { clientSource: () => client })
    const blocking = setBlock(BOB, true, { clientSource: () => client })
    expect(cached('7')).toMatchObject({ muting: true, blocking: true })
    await Promise.resolve()
    expect(client.block).not.toHaveBeenCalled()
    m.resolve(rel('7', { muting: true }))
    await muting
    await blocking
    expect(client.block).toHaveBeenCalledWith('7')
    expect(cached('7')).toMatchObject({ muting: true, blocking: true })
  })

  it('a failed mute keeps a follow queued behind it', async () => {
    const m = deferred<Relationship>()
    const client = fakeClient({
      mute: vi.fn(() => m.promise),
      follow: vi.fn(async (id: string) => rel(id, { following: true })),
    })
    const muting = setMute(BOB, true, { clientSource: () => client })
    const follow = toggleFollow(BOB, { clientSource: () => client })
    m.reject(new Error('boom'))
    await muting
    await follow
    expect(cached('7')).toMatchObject({ following: true, muting: false })
  })

  it('an unmute for an account the cache knows nothing about still asks the server', async () => {
    const client = fakeClient()
    expect(await setMute(BOB, false, { clientSource: () => client })).toBe(true)
    expect(client.unmute).toHaveBeenCalledWith('7')
  })

  it('a failure after the reader moved to another account rolls back without a toast', async () => {
    activeUserKey.value = ME
    const m = deferred<Relationship>()
    const client = fakeClient({ mute: vi.fn(() => m.promise) })
    const muting = setMute(BOB, true, { clientSource: () => client })
    activeUserKey.value = 'carol@other.example' as UserKey
    m.reject(new Error('boom'))
    expect(await muting).toBe(false)
    expect(cached('7')).toBeUndefined()
    expect(toasts).toEqual([])
  })

  it('does nothing without a client', async () => {
    expect(await setMute(BOB, true, { clientSource: () => null })).toBe(false)
    expect(cached('7')).toBeUndefined()
  })
})

describe('setBlock', () => {
  it('blocks at once and drops the follow with it', async () => {
    seed(rel('7', { following: true }))
    const d = deferred<Relationship>()
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
