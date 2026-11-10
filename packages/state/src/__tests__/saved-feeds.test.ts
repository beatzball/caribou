import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserKey } from '@beatzball/caribou-auth'
import { CaribouError, type CaribouClient, type SavedFeed } from '@beatzball/caribou-mastodon-client'
import { loadSavedFeeds, savedFeedsCache, savedFeedsFor, _resetSavedFeedsForTests } from '../saved-feeds.js'

const ME = 'did:plc:alice@bsky' as UserKey
const OTHER = 'did:plc:bob@bsky' as UserKey

const feed = (id: string, pinned = true): SavedFeed => ({
  id, kind: 'feed', uri: `at://did:plc:alice/app.bsky.feed.generator/${id}`, pinned,
  name: id, description: '', avatar: null, creator: null, available: true,
})

function client(fn: () => Promise<SavedFeed[]>, userKey: UserKey = ME, network = 'bluesky'): CaribouClient {
  return { userKey, capabilities: { network }, blueskySavedFeeds: vi.fn(fn) } as unknown as CaribouClient
}

afterEach(() => _resetSavedFeedsForTests())

describe('loadSavedFeeds', () => {
  it('stores the answer under the account that read it', async () => {
    const c = client(async () => [feed('a'), feed('b', false)])
    expect(await loadSavedFeeds({ clientSource: () => c })).toEqual([feed('a'), feed('b', false)])
    expect(savedFeedsFor(ME)).toEqual([feed('a'), feed('b', false)])
    expect(savedFeedsFor(OTHER)).toBeUndefined()
  })

  it('shares one request between two loads for one account', async () => {
    let resolve!: (v: SavedFeed[]) => void
    const c = client(() => new Promise((r) => { resolve = r }))
    const one = loadSavedFeeds({ clientSource: () => c })
    const two = loadSavedFeeds({ clientSource: () => c })
    resolve([feed('a')])
    expect(await one).toEqual(await two)
    expect(c.blueskySavedFeeds).toHaveBeenCalledTimes(1)
  })

  it('keeps an answer under its own account when the active one changed meanwhile', async () => {
    let resolve!: (v: SavedFeed[]) => void
    const mine = client(() => new Promise((r) => { resolve = r }))
    const load = loadSavedFeeds({ clientSource: () => mine })
    const theirs = client(async () => [feed('z')], OTHER)
    await loadSavedFeeds({ clientSource: () => theirs })
    resolve([feed('a')])
    await load
    expect(savedFeedsFor(ME)).toEqual([feed('a')])
    expect(savedFeedsFor(OTHER)).toEqual([feed('z')])
  })

  it('keeps what it had and throws when a load fails', async () => {
    await loadSavedFeeds({ clientSource: () => client(async () => [feed('a')]) })
    const failing = client(async () => { throw new CaribouError('server_error', 'down') })
    await expect(loadSavedFeeds({ clientSource: () => failing })).rejects.toMatchObject({ code: 'server_error' })
    expect(savedFeedsFor(ME)).toEqual([feed('a')])
  })

  it('answers [] for a Mastodon client or none, and stores nothing', async () => {
    const masto = client(async () => [feed('a')], 'alice@example.social' as UserKey, 'mastodon')
    expect(await loadSavedFeeds({ clientSource: () => masto })).toEqual([])
    expect(masto.blueskySavedFeeds).not.toHaveBeenCalled()
    expect(await loadSavedFeeds({ clientSource: () => null })).toEqual([])
    expect(savedFeedsCache.value.size).toBe(0)
  })
})
