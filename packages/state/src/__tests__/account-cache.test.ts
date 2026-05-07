import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import { accountCache } from '../caches.js'
import { createAccountCache } from '../account-cache.js'

const ALICE = {
  id: '42',
  acct: 'alice@example.social',
  username: 'alice',
} as unknown as mastodon.v1.Account

beforeEach(() => {
  accountCache.value = new Map()
})

describe('createAccountCache', () => {
  it('memoizes lookup() across repeated calls for the same handle', async () => {
    const lookupAccount = vi.fn(async () => ALICE)
    const client = { lookupAccount } as unknown as CaribouClient
    const cache = createAccountCache(() => client)
    const a = await cache.lookup('alice@example.social')
    const b = await cache.lookup('alice@example.social')
    expect(a?.id).toBe('42')
    expect(b?.id).toBe('42')
    expect(lookupAccount).toHaveBeenCalledTimes(1)
  })

  it('returns null when the client source is unavailable', async () => {
    const cache = createAccountCache(() => null)
    expect(await cache.lookup('alice@example.social')).toBeNull()
  })

  it('dedupes concurrent in-flight requests for the same handle', async () => {
    let resolve!: (a: mastodon.v1.Account) => void
    const lookupAccount = vi.fn(
      () => new Promise<mastodon.v1.Account>((r) => { resolve = r }),
    )
    const client = { lookupAccount } as unknown as CaribouClient
    const cache = createAccountCache(() => client)
    const p1 = cache.lookup('alice@example.social')
    const p2 = cache.lookup('alice@example.social')
    resolve(ALICE)
    const [a, b] = await Promise.all([p1, p2])
    expect(a?.id).toBe('42')
    expect(b?.id).toBe('42')
    expect(lookupAccount).toHaveBeenCalledTimes(1)
  })

  it('re-fetches when the handle is unknown but cached on a different key', async () => {
    const BOB = { id: '43', acct: 'bob@example.social', username: 'bob' } as unknown as mastodon.v1.Account
    const lookupAccount = vi.fn(async (h: string) =>
      h === 'alice@example.social' ? ALICE : BOB,
    )
    const client = { lookupAccount } as unknown as CaribouClient
    const cache = createAccountCache(() => client)
    await cache.lookup('alice@example.social')
    await cache.lookup('bob@example.social')
    expect(lookupAccount).toHaveBeenCalledTimes(2)
  })
})
