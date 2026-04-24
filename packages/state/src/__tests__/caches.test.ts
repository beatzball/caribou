import { beforeEach, describe, expect, it } from 'vitest'
import type { mastodon } from 'masto'
import {
  statusCache, accountCache, cacheStatus, cacheAccount, updateStatus,
} from '../caches.js'

function makeStatus(id: string, fav = false): mastodon.v1.Status {
  return {
    id, content: `<p>${id}</p>`, favourited: fav, favouritesCount: fav ? 1 : 0,
    account: { id: 'a1', username: 'beatzball', acct: 'beatzball' },
  } as unknown as mastodon.v1.Status
}

beforeEach(() => {
  statusCache.value = new Map()
  accountCache.value = new Map()
})

describe('statusCache', () => {
  it('cacheStatus inserts the status and its account into caches', () => {
    cacheStatus(makeStatus('s1'))
    expect(statusCache.value.get('s1')?.id).toBe('s1')
    expect(accountCache.value.get('a1')?.id).toBe('a1')
  })

  it('updateStatus merges partial over existing entry', () => {
    cacheStatus(makeStatus('s1', false))
    updateStatus('s1', { favourited: true, favouritesCount: 1 })
    expect(statusCache.value.get('s1')?.favourited).toBe(true)
    expect(statusCache.value.get('s1')?.favouritesCount).toBe(1)
  })

  it('updateStatus is a no-op if the id is not cached', () => {
    updateStatus('never', { favourited: true })
    expect(statusCache.value.has('never')).toBe(false)
  })

  it('cacheAccount upserts', () => {
    cacheAccount({ id: 'a2', acct: 'b' } as mastodon.v1.Account)
    expect(accountCache.value.get('a2')?.acct).toBe('b')
  })
})
