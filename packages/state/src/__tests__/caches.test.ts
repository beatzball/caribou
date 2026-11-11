import { beforeEach, describe, expect, it } from 'vitest'
import { activeUserKey } from '../users.js'
import type { Account, Status } from '@beatzball/caribou-mastodon-client'
import {
  statusCache, accountCache, cacheStatus, cacheAccount, deletedStatusIds, forgetReaderFields, mergeStatus, postRecords, readerQuote,
  readerFiltered, readSource, updateStatus,
} from '../caches.js'

function makeStatus(id: string, fav = false): Status {
  return {
    id, content: `<p>${id}</p>`, favourited: fav, favouritesCount: fav ? 1 : 0,
    account: { id: 'a1', username: 'beatzball', acct: 'beatzball' },
  } as unknown as Status
}

beforeEach(() => {
  statusCache.value = new Map()
  postRecords.value = new Map()
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
    cacheAccount({ id: 'a2', acct: 'b' } as Account)
    expect(accountCache.value.get('a2')?.acct).toBe('b')
  })
})

describe('mergeStatus', () => {
  it('takes content and counts from the fresh copy and keeps the reader flags', () => {
    cacheStatus({ ...makeStatus('1', true), bookmarked: true } as Status)
    const fresh = { ...makeStatus('1'), content: '<p>edited</p>', favouritesCount: 7, bookmarked: false }
    const merged = mergeStatus(fresh as Status)
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
    const merged = mergeStatus(wrapper as unknown as Status)
    expect(merged.reblog!.favourited).toBe(true)
    expect(statusCache.value.get('p')!.content).toBe('<p>edited</p>')
    expect(statusCache.value.get('p')!.favourited).toBe(true)
  })

  // Mastodon sends `filtered` only to a reader with a token, so a copy that
  // has it is the reader's own, newer than the one cached: a filter the
  // reader added or removed since must show.
  it('takes `filtered` from a fresh copy that has it, and keeps it from one that does not', () => {
    const match = [{ filter: { id: 'f', title: 'Spoilers', context: ['home'], filterAction: 'hide' } }]
    cacheStatus({ ...makeStatus('3'), filtered: match } as unknown as Status)
    expect(mergeStatus(makeStatus('3')).filtered).toEqual(match)
    expect(mergeStatus({ ...makeStatus('3'), filtered: [] } as Status).filtered).toEqual([])
    const again = [{ filter: { id: 'g', title: 'Sports', context: ['home'], filterAction: 'warn' } }]
    expect(mergeStatus({ ...makeStatus('3'), filtered: again } as unknown as Status).filtered)
      .toEqual(again)
  })
})

describe('quoted posts', () => {
  const quoting = (id: string, quoted: Status) =>
    ({ ...makeStatus(id), quote: { state: 'accepted', quotedStatus: quoted } }) as unknown as Status
  const quotedIn = (s: Status | undefined) =>
    (s?.quote as { quotedStatus?: Status } | undefined)?.quotedStatus

  it('mergeStatus and cacheStatus cache the quoted post under its own id', () => {
    mergeStatus(quoting('p', makeStatus('q')))
    expect(statusCache.value.get('q')?.content).toBe('<p>q</p>')
    cacheStatus(quoting('p2', makeStatus('q2')))
    expect(statusCache.value.get('q2')?.id).toBe('q2')
  })

  it('caches the post quoted inside a boost', () => {
    const boost = { ...makeStatus('b'), reblog: quoting('p', makeStatus('q')) } as Status
    mergeStatus(boost)
    expect(statusCache.value.get('q')?.id).toBe('q')
  })

  it('an older copy of a quote does not undo a newer edit of the quoted post', () => {
    const edited = { ...makeStatus('q'), content: '<p>new</p>', editedAt: '2026-05-02T00:00:00Z' } as Status
    cacheStatus(edited)
    const out = mergeStatus(quoting('p', makeStatus('q')))
    expect(statusCache.value.get('q')?.content).toBe('<p>new</p>')
    expect(quotedIn(out)?.content).toBe('<p>new</p>')
  })

  it('keeps the reader filters of a quoted post', () => {
    const hide = [{ filter: { id: 'f', title: 'x', context: ['home'], filterAction: 'hide' }, keywordMatches: [] }]
    cacheStatus(quoting('p', { ...makeStatus('q'), filtered: hide } as unknown as Status))
    expect(readerFiltered('q')).toEqual(hide)
  })

  it('forgetReaderFields drops the reader flags of a quoted post too', () => {
    cacheStatus(quoting('p', makeStatus('q', true)))
    forgetReaderFields()
    expect('favourited' in (quotedIn(statusCache.value.get('p')) ?? {})).toBe(false)
  })

  it('forgetReaderFields turns a quote of a deleted post into a deleted quote', () => {
    cacheStatus(quoting('p', makeStatus('q')))
    cacheStatus({ ...makeStatus('b'), reblog: quoting('p2', makeStatus('q')) } as Status)
    deletedStatusIds.value = new Set(['q'])
    forgetReaderFields()
    expect(statusCache.value.get('p')?.quote).toEqual({ state: 'deleted', quotedStatus: null })
    expect(statusCache.value.get('b')?.reblog?.quote).toEqual({ state: 'deleted', quotedStatus: null })
  })

  // Mastodon embeds a quoted post's own quote shallow (an id only).
  const shallowOf = (s: Status, quotedId: string) =>
    ({ ...s, quote: { state: 'accepted', quotedStatusId: quotedId } }) as unknown as Status

  it('a shallow copy of a quote never replaces the full one of the same post', () => {
    const b = quoting('b', makeStatus('a'))
    mergeStatus(b)
    mergeStatus(quoting('c', shallowOf(b, 'a')))
    expect(quotedIn(statusCache.value.get('b'))?.id).toBe('a')
    cacheStatus(quoting('c2', shallowOf(b, 'a')))
    expect(quotedIn(statusCache.value.get('b'))?.id).toBe('a')
    // Inside a boost too.
    mergeStatus({ ...makeStatus('boost'), reblog: shallowOf(b, 'a') } as Status)
    expect(quotedIn(statusCache.value.get('b'))?.id).toBe('a')
    expect(quotedIn(statusCache.value.get('boost')?.reblog ?? undefined)?.id).toBe('a')
  })

  it('a shallow copy that says something else about the quote is taken', () => {
    const b = quoting('b', makeStatus('a'))
    mergeStatus(b)
    mergeStatus({ ...b, filtered: [], quote: { state: 'revoked', quotedStatusId: null } } as unknown as Status)
    expect(statusCache.value.get('b')?.quote).toEqual({ state: 'revoked', quotedStatusId: null })
  })

  // The reader's copy (it has `filtered`, as every copy fetched with a
  // token from Mastodon 4.0 on does) says what this reader may see.
  it('a copy without a token never undoes the reader\'s quote state', () => {
    const reader = { ...makeStatus('p'), filtered: [], quote: { state: 'muted_account', quotedStatus: null } } as unknown as Status
    mergeStatus(reader)
    mergeStatus(quoting('p', makeStatus('q')))
    expect(statusCache.value.get('p')?.quote).toEqual({ state: 'muted_account', quotedStatus: null })
    cacheStatus(quoting('p', makeStatus('q')))
    expect(statusCache.value.get('p')?.quote).toEqual({ state: 'muted_account', quotedStatus: null })
    // Inside a boost too.
    mergeStatus({ ...makeStatus('boost'), reblog: quoting('p', makeStatus('q')) } as Status)
    expect(statusCache.value.get('p')?.quote).toEqual({ state: 'muted_account', quotedStatus: null })
    expect(statusCache.value.get('boost')?.reblog?.quote).toEqual({ state: 'muted_account', quotedStatus: null })
    // A newer reader copy wins.
    mergeStatus({ ...quoting('p', makeStatus('q')), filtered: [] } as unknown as Status)
    expect(quotedIn(statusCache.value.get('p'))?.id).toBe('q')
  })

  it('after an account change, a copy without a token is taken again', () => {
    mergeStatus({ ...makeStatus('p'), filtered: [], quote: { state: 'muted_account', quotedStatus: null } } as unknown as Status)
    forgetReaderFields()
    mergeStatus(quoting('p', makeStatus('q')))
    expect(quotedIn(statusCache.value.get('p'))?.id).toBe('q')
  })

  const hideQ = [{ filter: { id: 'f', title: 'x', context: ['home'], filterAction: 'hide' }, keywordMatches: [] }]
  const withF = (st: Status, f: unknown) => ({ ...st, filtered: f }) as unknown as Status

  // A kept quote carries an old copy of the quoted post. It is not news, so
  // it must not overwrite a newer reader copy of that post.
  it.each(['mergeStatus', 'cacheStatus'] as const)('a kept quote does not replay its old quoted post (%s)', (entry) => {
    const put = entry === 'mergeStatus' ? mergeStatus : cacheStatus
    mergeStatus(withF(quoting('p', withF(makeStatus('q'), [])), []))
    mergeStatus(withF(makeStatus('q'), hideQ))
    put(quoting('p', makeStatus('q')))
    expect(readerFiltered('q')).toEqual(hideQ)
    expect(statusCache.value.get('q')?.filtered).toEqual(hideQ)
  })

  // The reader's copy of a post may be cached only inside a boost.
  const muted = (id: string) =>
    ({ ...makeStatus(id), filtered: [], quote: { state: 'muted_account', quotedStatus: null } }) as unknown as Status
  const boostOf = (id: string, inner: Status) => ({ ...makeStatus(id), reblog: inner }) as Status

  it.each(['mergeStatus', 'cacheStatus'] as const)('finds the reader\'s quote inside another boost (%s)', (entry) => {
    const put = entry === 'mergeStatus' ? mergeStatus : cacheStatus
    put(boostOf('b1', muted('p')))
    put(boostOf('b2', quoting('p', makeStatus('q'))))
    expect(statusCache.value.get('b2')?.reblog?.quote).toEqual({ state: 'muted_account', quotedStatus: null })
    // And a copy of the post alone, outside any boost.
    put(quoting('p', makeStatus('q')))
    expect(statusCache.value.get('p')?.quote).toEqual({ state: 'muted_account', quotedStatus: null })
  })

  it.each(['mergeStatus', 'cacheStatus'] as const)('a full quote known only inside a boost beats a shallow copy (%s)', (entry) => {
    const put = entry === 'mergeStatus' ? mergeStatus : cacheStatus
    put(boostOf('b1', quoting('p', makeStatus('a'))))
    put(boostOf('b2', { ...quoting('p', makeStatus('a')), quote: { state: 'accepted', quotedStatusId: 'a' } } as unknown as Status))
    expect(quotedIn(statusCache.value.get('b2')?.reblog ?? undefined)?.id).toBe('a')
  })

  // One record per post id says what the reader's server last said about
  // it, whichever copy brought that: alone, in a boost, in a quote.
  const reader = (id: string, state: string) => ({
    ...makeStatus(id), filtered: [],
    quote: state === 'accepted' ? { state, quotedStatus: makeStatus('q') } : { state, quotedStatus: null },
  }) as unknown as Status
  const publicP = () => quoting('p', makeStatus('q'))
  const stateIn = (s: Status | null | undefined) => s?.quote?.state

  it.each(['mergeStatus', 'cacheStatus'] as const)(
    'accepted in boost 1, then muted in boost 2: a public boost 3 stays muted (%s)', (entry) => {
      const put = entry === 'mergeStatus' ? mergeStatus : cacheStatus
      put(boostOf('b1', reader('p', 'accepted')))
      put(boostOf('b2', reader('p', 'muted_account')))
      put(boostOf('b3', publicP()))
      expect(stateIn(statusCache.value.get('b3')?.reblog)).toBe('muted_account')
      expect(readerQuote('p')?.state).toBe('muted_account')
    })

  it.each(['mergeStatus', 'cacheStatus'] as const)(
    'an older copy alone does not beat a newer reader copy in a boost (%s)', (entry) => {
      const put = entry === 'mergeStatus' ? mergeStatus : cacheStatus
      put(publicP())
      put(boostOf('b2', reader('p', 'muted_account')))
      put(boostOf('b3', publicP()))
      put(publicP())
      expect(stateIn(statusCache.value.get('b3')?.reblog)).toBe('muted_account')
      expect(stateIn(statusCache.value.get('p'))).toBe('muted_account')
    })

  // Three boosts, in other orders: the last reader copy wins; a public copy
  // never wins over a reader copy; with no reader copy, the public one does.
  it.each([
    [['muted_account', 'accepted', 'public'], 'accepted'],
    [['public', 'muted_account', 'accepted'], 'accepted'],
    [['public', 'accepted', 'revoked'], 'revoked'],
    [['revoked', 'public', 'public'], 'revoked'],
    [['public', 'public', 'public'], 'accepted'],
  ] as const)('boosts %j end with %s, through both entry points', (order, want) => {
    for (const put of [mergeStatus, cacheStatus]) {
      statusCache.value = new Map()
      postRecords.value = new Map()
      order.forEach((kind, i) => put(boostOf(`b${i}`, kind === 'public' ? publicP() : reader('p', kind))))
      put(boostOf('last', publicP()))
      expect(stateIn(statusCache.value.get('last')?.reblog)).toBe(want)
      expect(readerQuote('p')?.state).toBe(want)
    }
  })

  it('an account change forgets the reader\'s quote state', () => {
    mergeStatus(boostOf('b1', reader('p', 'muted_account')))
    forgetReaderFields()
    expect(readerQuote('p')).toBeUndefined()
    mergeStatus(boostOf('b3', publicP()))
    expect(stateIn(statusCache.value.get('b3')?.reblog)).toBe('accepted')
  })

  it('a shallow quote changes nothing', () => {
    const s = { ...makeStatus('p'), quote: { state: 'accepted', quotedStatusId: 'q' } } as unknown as Status
    mergeStatus(s)
    expect(statusCache.value.has('q')).toBe(false)
  })
})

describe('readerFiltered', () => {
  const hide = [{ filter: { id: 'f', title: 'Spoilers', context: ['home'], filterAction: 'hide' } }]
  const boost = (inner: unknown) => ({ ...makeStatus('w'), reblog: inner }) as unknown as Status

  it('the last copy to arrive wins, alone or inside a boost, in either order', () => {
    cacheStatus({ ...makeStatus('p'), filtered: [] } as Status)
    cacheStatus(boost({ ...makeStatus('p'), filtered: hide }))
    expect(readerFiltered('p')).toEqual(hide)
    mergeStatus({ ...makeStatus('p'), filtered: [] } as Status)
    expect(readerFiltered('p')).toEqual([])
    mergeStatus(boost({ ...makeStatus('p'), filtered: hide }))
    expect(readerFiltered('p')).toEqual(hide)
  })

  it('a copy without `filtered` does not count, and a merge does not renew a kept value', () => {
    cacheStatus(boost({ ...makeStatus('p'), filtered: hide }))
    cacheStatus({ ...makeStatus('p'), filtered: [] } as Status)
    // A token-less copy of the boost keeps the cached inner `filtered: hide`.
    mergeStatus(boost(makeStatus('p')))
    expect(readerFiltered('p')).toEqual([])
  })

  it('forgets everything on an account change', () => {
    cacheStatus({ ...makeStatus('p'), filtered: hide } as unknown as Status)
    forgetReaderFields()
    expect(readerFiltered('p')).toBeUndefined()
  })
})

describe('Bluesky Home reply context (#275)', () => {
  const bsky = (id: string) => ({
    ...makeStatus(id),
    bluesky: { uri: id, cid: 'c', likeUri: null, repostUri: null, replyRef: null, replyDisabled: false, embeddingDisabled: false, labels: [], moderation: null, viewerOf: 'did:plc:reader@bsky' },
  }) as unknown as Status
  const leaf = () => {
    const s = bsky('at://did:plc:alice/app.bsky.feed.post/a2')
    return { ...s, bluesky: { ...s.bluesky!, replyContext: { root: bsky('at://did:plc:alice/app.bsky.feed.post/a0'), parent: bsky('at://did:plc:carol/app.bsky.feed.post/c1'), gap: false } } } as Status
  }

  it('cacheStatus caches the root and the parent under their own ids', () => {
    cacheStatus(leaf())
    expect(statusCache.value.has('at://did:plc:alice/app.bsky.feed.post/a0')).toBe(true)
    expect(statusCache.value.has('at://did:plc:carol/app.bsky.feed.post/c1')).toBe(true)
    // So a like on a context card has a cached copy to change.
    updateStatus('at://did:plc:carol/app.bsky.feed.post/c1', { favourited: true })
    expect(statusCache.value.get('at://did:plc:carol/app.bsky.feed.post/c1')?.favourited).toBe(true)
  })

  it('a plain copy of a shown reply keeps its context: as the parent of a newer reply, from a thread, from page data', () => {
    const A = 'at://did:plc:alice/app.bsky.feed.post/a2'
    cacheStatus(leaf())
    // A newer reply B answers A: caching B caches a plain copy of A.
    const b = bsky('at://did:plc:carol/app.bsky.feed.post/c3')
    cacheStatus({ ...b, bluesky: { ...b.bluesky!, replyContext: { root: bsky('at://did:plc:alice/app.bsky.feed.post/a0'), parent: bsky(A), gap: true } } } as Status)
    expect(statusCache.value.get(A)?.bluesky?.replyContext?.parent.id).toBe('at://did:plc:carol/app.bsky.feed.post/c1')
    // A thread's copy (cacheStatus) and page data (mergeStatus) of A.
    cacheStatus(bsky(A))
    expect(statusCache.value.get(A)?.bluesky?.replyContext?.parent.id).toBe('at://did:plc:carol/app.bsky.feed.post/c1')
    mergeStatus({ ...bsky(A), favouritesCount: 3 } as Status)
    expect(statusCache.value.get(A)?.bluesky?.replyContext?.root?.id).toBe('at://did:plc:alice/app.bsky.feed.post/a0')
    expect(statusCache.value.get(A)?.favouritesCount).toBe(3)
  })

  it('forgetReaderFields scrubs the reader fields of the context copies too', () => {
    const l = leaf()
    const ctx = l.bluesky!.replyContext!
    // Fetched by the active reader, so the copies keep the reader's fields.
    activeUserKey.value = 'did:plc:reader@bsky'
    cacheStatus({ ...l, bluesky: { ...l.bluesky!, replyContext: { ...ctx, parent: { ...ctx.parent, favourited: true } } } } as Status,
      readSource('did:plc:reader@bsky'))
    expect(statusCache.value.get('at://did:plc:alice/app.bsky.feed.post/a2')!.bluesky!.replyContext!.parent.bluesky!.viewerOf).toBe('did:plc:reader@bsky')
    forgetReaderFields()
    const kept = statusCache.value.get('at://did:plc:alice/app.bsky.feed.post/a2')!.bluesky!.replyContext!
    expect(kept.parent.bluesky!.viewerOf).toBeNull()
    expect(kept.root!.bluesky!.viewerOf).toBeNull()
    expect(kept.parent.favourited).toBeUndefined()
    activeUserKey.value = null
  })

  it('mergeStatus caches them too, and keeps a newer edit of a context post', () => {
    cacheStatus({ ...bsky('at://did:plc:carol/app.bsky.feed.post/c1'), content: '<p>new</p>', editedAt: '2026-11-10T12:00:00Z' } as Status)
    const merged = mergeStatus(leaf())
    expect(statusCache.value.has('at://did:plc:alice/app.bsky.feed.post/a0')).toBe(true)
    expect(merged.bluesky!.replyContext!.parent.content).toBe('<p>new</p>')
  })
})
