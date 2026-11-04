import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import { toUserKey } from '@beatzball/caribou-auth'
import { cacheStatus, forgetReaderFields, mergeStatus, statusCache } from '../caches.js'
import { activeUserKey } from '../users.js'
import { ownerGeneration } from '../keep-alive.js'
import { _testOnlyResetMutations } from '../mutations.js'
import { inflight } from '../inflight.js'
import { optimisticVote, refreshPoll, votePoll } from '../polls.js'

type Status = mastodon.v1.Status
type Poll = mastodon.v1.Poll

function makePoll(over: Partial<Poll> = {}): Poll {
  return {
    id: 'p1', expiresAt: '2030-01-01T00:00:00.000Z', expired: false, multiple: false,
    votesCount: 4, votersCount: 4,
    options: [{ title: 'yes', votesCount: 3, emojis: [] }, { title: 'no', votesCount: 1, emojis: [] }],
    emojis: [],
    ...over,
  } as Poll
}

function makeStatus(id: string, over: Partial<Status> = {}): Status {
  return {
    id, content: `<p>${id}</p>`, editedAt: null, poll: makePoll(),
    account: { id: 'b1', username: 'bob', acct: 'bob' },
    ...over,
  } as unknown as Status
}

function wrapper(id: string, post: Status): Status {
  return makeStatus(id, { poll: null, reblog: post, account: { id: 'c1', username: 'carol', acct: 'carol' } as mastodon.v1.Account })
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const client = (impl: Partial<CaribouClient>) => impl as CaribouClient
const toasts: string[] = []
const onToast = (e: Event) => { toasts.push((e as CustomEvent<{ message: string }>).detail.message) }

beforeEach(() => {
  activeUserKey.value = toUserKey('alice', 'example.social')
  ownerGeneration()
  statusCache.value = new Map()
  _testOnlyResetMutations()
  toasts.length = 0
  window.addEventListener('caribou:toast', onToast)
})
afterEach(() => { window.removeEventListener('caribou:toast', onToast) })

const get = (id: string) => statusCache.value.get(id)

describe('optimisticVote', () => {
  it('marks the choices and adds one vote to each, one voter', () => {
    const p = optimisticVote(makePoll({ multiple: true }), [0, 1])
    expect(p.voted).toBe(true)
    expect(p.ownVotes).toEqual([0, 1])
    expect(p.votesCount).toBe(6)
    expect(p.votersCount).toBe(5)
    expect(p.options.map((o) => o.votesCount)).toEqual([4, 2])
  })

  it('leaves hidden counts hidden', () => {
    const hidden = makePoll({ options: [{ title: 'a', emojis: [] }, { title: 'b', emojis: [] }] as Poll['options'], votersCount: null })
    const p = optimisticVote(hidden, [1])
    expect(p.options.map((o) => o.votesCount)).toEqual([undefined, undefined])
    expect(p.votersCount).toBeNull()
    expect(p.votesCount).toBe(5)
  })
})

describe('votePoll', () => {
  it('shows the vote at once in the post and every boost of it, then takes the server poll', async () => {
    cacheStatus(makeStatus('1'))
    cacheStatus(wrapper('w1', makeStatus('1')))
    const d = deferred<Poll>()
    const vote = vi.fn(() => d.promise)
    const p = votePoll(get('w1')!, [1], { clientSource: () => client({ votePoll: vote }) })
    expect(vote).toHaveBeenCalledWith('p1', [1])
    expect(get('1')?.poll?.ownVotes).toEqual([1])
    expect(get('w1')?.reblog?.poll?.ownVotes).toEqual([1])
    expect(get('1')?.poll?.options[1]?.votesCount).toBe(2)
    d.resolve(makePoll({ voted: true, ownVotes: [1], votesCount: 9, options: [
      { title: 'yes', votesCount: 6, emojis: [] }, { title: 'no', votesCount: 3, emojis: [] }] as Poll['options'] }))
    expect(await p).toBe(true)
    expect(get('1')?.poll?.votesCount).toBe(9)
    expect(get('w1')?.reblog?.poll?.votesCount).toBe(9)
  })

  it('caches a post the cache did not hold, so the vote shows', async () => {
    const vote = vi.fn(async () => makePoll({ voted: true, ownVotes: [0] }))
    expect(await votePoll(makeStatus('7'), [0], { clientSource: () => client({ votePoll: vote }) })).toBe(true)
    expect(get('7')?.poll?.voted).toBe(true)
  })

  it('rolls back and toasts on failure, then asks for the poll again', async () => {
    cacheStatus(makeStatus('1'))
    cacheStatus(wrapper('w1', makeStatus('1')))
    const before = get('1')!.poll
    const fetchPoll = vi.fn(async () => makePoll())
    const vote = vi.fn(async () => { throw new Error('boom') })
    expect(await votePoll(get('1')!, [0], { clientSource: () => client({ votePoll: vote, fetchPoll }) })).toBe(false)
    expect(get('1')?.poll).toEqual(before)
    expect(get('w1')?.reblog?.poll?.voted).toBeUndefined()
    expect(toasts).toEqual(['Could not send your vote. Try again.'])
    expect(fetchPoll).toHaveBeenCalledWith('p1')
  })

  it('a second vote while one is out is dropped', async () => {
    cacheStatus(makeStatus('1'))
    const d = deferred<Poll>()
    const vote = vi.fn(() => d.promise)
    const opts = { clientSource: () => client({ votePoll: vote }) }
    const a = votePoll(get('1')!, [0], opts)
    expect(await votePoll(get('1')!, [1], opts)).toBe(false)
    d.resolve(makePoll({ voted: true, ownVotes: [0] }))
    await a
    expect(vote).toHaveBeenCalledTimes(1)
  })

  it('refuses an expired poll or one already voted on', async () => {
    const vote = vi.fn()
    const opts = { clientSource: () => client({ votePoll: vote }) }
    expect(await votePoll(makeStatus('1', { poll: makePoll({ expired: true }) }), [0], opts)).toBe(false)
    expect(await votePoll(makeStatus('2', { poll: makePoll({ voted: true, ownVotes: [0] }) }), [0], opts)).toBe(false)
    expect(await votePoll(makeStatus('3'), [], opts)).toBe(false)
    expect(vote).not.toHaveBeenCalled()
  })

  it('a result that lands after the account changed writes nothing, not even a rollback', async () => {
    cacheStatus(makeStatus('1'))
    const d = deferred<Poll>()
    const p = votePoll(get('1')!, [0], { clientSource: () => client({ votePoll: () => d.promise }) })
    activeUserKey.value = toUserKey('bob', 'example.social')
    ownerGeneration()
    d.reject(new Error('late'))
    expect(await p).toBe(false)
    expect(toasts).toEqual([])
  })
})

describe('refreshPoll', () => {
  it('writes the fresh poll to every copy', async () => {
    cacheStatus(makeStatus('1'))
    cacheStatus(wrapper('w1', makeStatus('1')))
    const fetchPoll = vi.fn(async () => makePoll({ votesCount: 20, expired: true }))
    const out = await refreshPoll(get('1')!, { clientSource: () => client({ fetchPoll }) })
    expect(out?.votesCount).toBe(20)
    expect(get('1')?.poll?.expired).toBe(true)
    expect(get('w1')?.reblog?.poll?.votesCount).toBe(20)
  })

  it('drops an answer for an earlier account', async () => {
    cacheStatus(makeStatus('1'))
    const d = deferred<Poll>()
    const p = refreshPoll(get('1')!, { clientSource: () => client({ fetchPoll: () => d.promise }) })
    activeUserKey.value = toUserKey('bob', 'example.social')
    ownerGeneration()
    d.resolve(makePoll({ votesCount: 99 }))
    expect(await p).toBeNull()
    expect(get('1')?.poll?.votesCount).toBe(4)
  })
})

describe('the cache keeps the reader\'s vote', () => {
  it('a copy without a token (no `voted`) keeps the reader\'s vote and newer counts', () => {
    cacheStatus(makeStatus('1', { poll: makePoll({ voted: true, ownVotes: [1], votesCount: 5 }) }))
    mergeStatus(makeStatus('1', { poll: makePoll({ votesCount: 4 }) }))
    expect(get('1')?.poll?.voted).toBe(true)
    expect(get('1')?.poll?.ownVotes).toEqual([1])
    expect(get('1')?.poll?.votesCount).toBe(5)
  })

  it('a newer public copy brings its counts and keeps the vote', () => {
    cacheStatus(makeStatus('1', { poll: makePoll({ voted: true, ownVotes: [1], votesCount: 5 }) }))
    mergeStatus(makeStatus('1', { poll: makePoll({ votesCount: 8, expired: true }) }))
    expect(get('1')?.poll?.votesCount).toBe(8)
    expect(get('1')?.poll?.expired).toBe(true)
    expect(get('1')?.poll?.ownVotes).toEqual([1])
  })

  it('a reader copy (with `voted`) wins as it is', () => {
    cacheStatus(makeStatus('1', { poll: makePoll({ voted: true, ownVotes: [1] }) }))
    mergeStatus(makeStatus('1', { poll: makePoll({ voted: false, ownVotes: [] }) }))
    expect(get('1')?.poll?.voted).toBe(false)
  })

  it('a merge while a vote is out keeps the optimistic poll', async () => {
    cacheStatus(makeStatus('1'))
    const d = deferred<Poll>()
    const p = votePoll(get('1')!, [0], { clientSource: () => client({ votePoll: () => d.promise }) })
    mergeStatus(makeStatus('1', { poll: makePoll({ voted: false, ownVotes: [] }) }))
    expect(get('1')?.poll?.ownVotes).toEqual([0])
    d.resolve(makePoll({ voted: true, ownVotes: [0] }))
    await p
  })

  it('an account change drops the vote marks', () => {
    cacheStatus(makeStatus('1', { poll: makePoll({ voted: true, ownVotes: [1] }) }))
    cacheStatus(wrapper('w1', makeStatus('1', { poll: makePoll({ voted: true, ownVotes: [1] }) })))
    forgetReaderFields()
    expect(get('1')?.poll?.voted).toBeUndefined()
    expect(get('1')?.poll?.ownVotes).toBeUndefined()
    expect(get('w1')?.reblog?.poll?.voted).toBeUndefined()
  })
})

describe('review round 2', () => {
  it('a refresh that left before a vote and answers after it changes nothing', async () => {
    cacheStatus(makeStatus('1'))
    const late = deferred<Poll>()
    const r = refreshPoll(get('1')!, { clientSource: () => client({ fetchPoll: () => late.promise }) })
    const vote = vi.fn(async () => makePoll({ voted: true, ownVotes: [1], votesCount: 5 }))
    expect(await votePoll(get('1')!, [1], { clientSource: () => client({ votePoll: vote }) })).toBe(true)
    late.resolve(makePoll())
    expect(await r).toBeNull()
    expect(get('1')?.poll?.voted).toBe(true)
    expect(get('1')?.poll?.votesCount).toBe(5)
  })

  it('a vote through a boost survives a tokenless copy of the post arriving later', async () => {
    cacheStatus(wrapper('w1', makeStatus('1')))
    const vote = vi.fn(async () => makePoll({ voted: true, ownVotes: [0], votesCount: 5 }))
    expect(await votePoll(get('w1')!, [0], { clientSource: () => client({ votePoll: vote }) })).toBe(true)
    mergeStatus(makeStatus('1'))
    expect(get('1')?.poll?.voted).toBe(true)
    expect(get('1')?.poll?.ownVotes).toEqual([0])
    expect(get('1')?.poll?.votesCount).toBe(5)
  })

  it('a network copy written while a vote is out keeps the vote on screen', async () => {
    cacheStatus(makeStatus('1'))
    cacheStatus(wrapper('w1', makeStatus('1')))
    const d = deferred<Poll>()
    const p = votePoll(get('1')!, [0], { clientSource: () => client({ votePoll: () => d.promise }) })
    cacheStatus(makeStatus('1', { poll: makePoll({ voted: false, ownVotes: [] }) }))
    cacheStatus(wrapper('w1', makeStatus('1', { poll: makePoll({ voted: false, ownVotes: [] }) })))
    expect(get('1')?.poll?.ownVotes).toEqual([0])
    expect(get('w1')?.reblog?.poll?.ownVotes).toEqual([0])
    d.resolve(makePoll({ voted: true, ownVotes: [0] }))
    await p
  })

  it('another action on the post does not freeze its poll', () => {
    cacheStatus(makeStatus('1'))
    inflight.add('favourite:1')
    mergeStatus(makeStatus('1', { poll: makePoll({ votesCount: 9 }) }))
    inflight.delete('favourite:1')
    expect(get('1')?.poll?.votesCount).toBe(9)
  })

  it('a vote that succeeds after the account changed writes nothing', async () => {
    cacheStatus(makeStatus('1'))
    const d = deferred<Poll>()
    const p = votePoll(get('1')!, [0], { clientSource: () => client({ votePoll: () => d.promise }) })
    activeUserKey.value = toUserKey('bob', 'example.social')
    ownerGeneration()
    d.resolve(makePoll({ voted: true, ownVotes: [0], votesCount: 77 }))
    expect(await p).toBe(false)
    expect(get('1')?.poll?.votesCount).not.toBe(77)
  })

  it('a refused vote the server already holds (already voted) shows the vote, with no error toast', async () => {
    cacheStatus(makeStatus('1'))
    const vote = vi.fn(async () => { throw new Error('You have already voted on this poll') })
    const fetchPoll = vi.fn(async () => makePoll({ voted: true, ownVotes: [1] }))
    expect(await votePoll(get('1')!, [0], { clientSource: () => client({ votePoll: vote, fetchPoll }) })).toBe(false)
    expect(get('1')?.poll?.ownVotes).toEqual([1])
    expect(toasts).toEqual([])
  })
})
