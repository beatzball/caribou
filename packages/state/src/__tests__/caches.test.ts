import { beforeEach, describe, expect, it } from 'vitest'
import type { mastodon } from 'masto'
import {
  statusCache, accountCache, cacheStatus, cacheAccount, filteredById, forgetReaderFields, mergeStatus,
  readerFiltered, updateStatus,
} from '../caches.js'

function makeStatus(id: string, fav = false): mastodon.v1.Status {
  return {
    id, content: `<p>${id}</p>`, favourited: fav, favouritesCount: fav ? 1 : 0,
    account: { id: 'a1', username: 'beatzball', acct: 'beatzball' },
  } as unknown as mastodon.v1.Status
}

beforeEach(() => {
  statusCache.value = new Map()
  filteredById.value = new Map()
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

describe('mergeStatus', () => {
  it('takes content and counts from the fresh copy and keeps the reader flags', () => {
    cacheStatus({ ...makeStatus('1', true), bookmarked: true } as mastodon.v1.Status)
    const fresh = { ...makeStatus('1'), content: '<p>edited</p>', favouritesCount: 7, bookmarked: false }
    const merged = mergeStatus(fresh as mastodon.v1.Status)
    expect([merged.content, merged.favouritesCount, merged.favourited, merged.bookmarked])
      .toEqual(['<p>edited</p>', 7, true, true])
    expect(statusCache.value.get('1')).toBe(merged)
  })

  it('caches a status it has not seen as it is', () => {
    const fresh = makeStatus('2')
    expect(mergeStatus(fresh)).toBe(fresh)
  })

  it('keeps the reader flags on the post inside a boost', () => {
    cacheStatus(makeStatus('p', true))
    const wrapper = { ...makeStatus('w'), reblog: { ...makeStatus('p'), content: '<p>edited</p>' } }
    const merged = mergeStatus(wrapper as unknown as mastodon.v1.Status)
    expect(merged.reblog!.favourited).toBe(true)
    expect(statusCache.value.get('p')!.content).toBe('<p>edited</p>')
    expect(statusCache.value.get('p')!.favourited).toBe(true)
  })

  // Mastodon sends `filtered` only to a reader with a token, so a copy that
  // has it is the reader's own, newer than the one cached: a filter the
  // reader added or removed since must show.
  it('takes `filtered` from a fresh copy that has it, and keeps it from one that does not', () => {
    const match = [{ filter: { id: 'f', title: 'Spoilers', context: ['home'], filterAction: 'hide' } }]
    cacheStatus({ ...makeStatus('3'), filtered: match } as unknown as mastodon.v1.Status)
    expect(mergeStatus(makeStatus('3')).filtered).toEqual(match)
    expect(mergeStatus({ ...makeStatus('3'), filtered: [] } as mastodon.v1.Status).filtered).toEqual([])
    const again = [{ filter: { id: 'g', title: 'Sports', context: ['home'], filterAction: 'warn' } }]
    expect(mergeStatus({ ...makeStatus('3'), filtered: again } as unknown as mastodon.v1.Status).filtered)
      .toEqual(again)
  })
})

describe('readerFiltered', () => {
  const hide = [{ filter: { id: 'f', title: 'Spoilers', context: ['home'], filterAction: 'hide' } }]
  const boost = (inner: unknown) => ({ ...makeStatus('w'), reblog: inner }) as unknown as mastodon.v1.Status

  it('the last copy to arrive wins, alone or inside a boost, in either order', () => {
    cacheStatus({ ...makeStatus('p'), filtered: [] } as mastodon.v1.Status)
    cacheStatus(boost({ ...makeStatus('p'), filtered: hide }))
    expect(readerFiltered('p')).toEqual(hide)
    mergeStatus({ ...makeStatus('p'), filtered: [] } as mastodon.v1.Status)
    expect(readerFiltered('p')).toEqual([])
    mergeStatus(boost({ ...makeStatus('p'), filtered: hide }))
    expect(readerFiltered('p')).toEqual(hide)
  })

  it('a copy without `filtered` does not count, and a merge does not renew a kept value', () => {
    cacheStatus(boost({ ...makeStatus('p'), filtered: hide }))
    cacheStatus({ ...makeStatus('p'), filtered: [] } as mastodon.v1.Status)
    // A token-less copy of the boost keeps the cached inner `filtered: hide`.
    mergeStatus(boost(makeStatus('p')))
    expect(readerFiltered('p')).toEqual([])
  })

  it('forgets everything on an account change', () => {
    cacheStatus({ ...makeStatus('p'), filtered: hide } as unknown as mastodon.v1.Status)
    forgetReaderFields()
    expect(readerFiltered('p')).toBeUndefined()
  })
})
