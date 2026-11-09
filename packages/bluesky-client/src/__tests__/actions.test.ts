import { CaribouError, isWriteAck } from '@beatzball/caribou-mastodon-client'
import { describe, expect, it, vi } from 'vitest'
import { createBlueskyClient, type BlueskyAgent } from '../client.js'
import { moderationFor, READER } from './_helpers.js'

const ME = 'did:plc:reader'
const POST = 'at://did:plc:alice/app.bsky.feed.post/3kpost'
const LIKE = `at://${ME}/app.bsky.feed.like/3klike`
const REPOST = `at://${ME}/app.bsky.feed.repost/3krepost`
const FOLLOW = `at://${ME}/app.bsky.graph.follow/3kfollow`
const BLOCK = `at://${ME}/app.bsky.graph.block/3kblock`

function xrpcError(status: number, error: string, message = error) {
  return Object.assign(new Error(message), { status, error })
}

function setup() {
  let n = 0
  const repo = {
    createRecord: vi.fn(async (input: { repo: string; collection: string }) =>
      ({ data: { uri: `at://${input.repo}/${input.collection}/3knew${++n}`, cid: 'bafyrec' } })),
    deleteRecord: vi.fn(async () => ({ data: {} })),
    getRecord: vi.fn(),
    uploadBlob: vi.fn(),
  }
  const bookmark = { createBookmark: vi.fn(async () => ({ data: {} })), deleteBookmark: vi.fn(async () => ({ data: {} })) }
  const graph = { muteActor: vi.fn(async () => ({ data: {} })), unmuteActor: vi.fn(async () => ({ data: {} })) }
  const agent = {
    did: ME,
    getPosts: vi.fn(async () => ({ data: { posts: [] as unknown[] } })),
    getProfile: vi.fn(async () => ({ data: { did: 'did:plc:alice', handle: 'alice.example.com', viewer: {} as Record<string, string> } })),
    com: { atproto: { repo } },
    app: { bsky: { bookmark, graph } },
  }
  const onUnauthorized = vi.fn()
  const client = createBlueskyClient({
    userKey: READER,
    agent: agent as unknown as BlueskyAgent,
    moderation: { post: (v) => moderationFor(v.uri), profile: (v) => moderationFor(v.did) },
    onUnauthorized,
  })
  return { client, agent, repo, bookmark, graph, onUnauthorized }
}

const ref = (over: { likeUri?: string | null; repostUri?: string | null } = {}) =>
  ({ id: POST, bluesky: { uri: POST, cid: 'bafypost', likeUri: null, repostUri: null, ...over } })

describe('Bluesky status actions', () => {
  it('a like writes one like record on the post, to the reader repo, and answers its URI', async () => {
    const { client, repo } = setup()
    const ack = await client.favourite(ref())
    expect(repo.createRecord).toHaveBeenCalledTimes(1)
    expect(repo.createRecord).toHaveBeenCalledWith({
      repo: ME, collection: 'app.bsky.feed.like',
      record: { $type: 'app.bsky.feed.like', subject: { uri: POST, cid: 'bafypost' }, createdAt: expect.any(String) },
    })
    expect(ack).toEqual({ ack: true, id: POST, on: true, record: `at://${ME}/app.bsky.feed.like/3knew1` })
    expect(isWriteAck(ack)).toBe(true)
  })

  it('an unlike deletes exactly the like record the ref names', async () => {
    const { client, repo, agent } = setup()
    const ack = await client.unfavourite(ref({ likeUri: LIKE }))
    expect(repo.deleteRecord).toHaveBeenCalledWith({ repo: ME, collection: 'app.bsky.feed.like', rkey: '3klike' })
    expect(agent.getPosts).not.toHaveBeenCalled()
    expect(ack).toEqual({ ack: true, id: POST, on: false, record: null })
  })

  it('a repost and its undo use the repost record', async () => {
    const { client, repo } = setup()
    expect(await client.reblog(ref())).toMatchObject({ on: true, record: `at://${ME}/app.bsky.feed.repost/3knew1` })
    await client.unreblog(ref({ repostUri: REPOST }))
    expect(repo.deleteRecord).toHaveBeenCalledWith({ repo: ME, collection: 'app.bsky.feed.repost', rkey: '3krepost' })
  })

  it('an undo with no known ref reads the reader view of the post first, then deletes that record', async () => {
    const { client, repo, agent } = setup()
    agent.getPosts.mockResolvedValueOnce({ data: { posts: [{ uri: POST, viewer: { like: LIKE } }] } })
    await client.unfavourite(ref())
    expect(agent.getPosts).toHaveBeenCalledWith({ uris: [POST] })
    expect(repo.deleteRecord).toHaveBeenCalledWith({ repo: ME, collection: 'app.bsky.feed.like', rkey: '3klike' })
  })

  it('an undo whose read finds no record deletes nothing and answers off', async () => {
    const { client, repo, agent } = setup()
    agent.getPosts.mockResolvedValueOnce({ data: { posts: [{ uri: POST, viewer: {} }] } })
    expect(await client.unreblog(ref())).toEqual({ ack: true, id: POST, on: false, record: null })
    expect(repo.deleteRecord).not.toHaveBeenCalled()
  })

  it('an undo whose post is gone fails with not_found and deletes nothing', async () => {
    const { client, repo } = setup()
    await expect(client.unfavourite(ref())).rejects.toMatchObject({ code: 'not_found' })
    expect(repo.deleteRecord).not.toHaveBeenCalled()
  })

  it.each([
    ['another repo', 'at://did:plc:alice/app.bsky.feed.like/3klike'],
    ['another collection', `at://${ME}/app.bsky.feed.repost/3klike`],
    ['not an AT URI', 'https://example.com/like'],
  ])('refuses to delete a like ref in %s', async (_, likeUri) => {
    const { client, repo } = setup()
    await expect(client.unfavourite(ref({ likeUri }))).rejects.toBeInstanceOf(CaribouError)
    expect(repo.deleteRecord).not.toHaveBeenCalled()
  })

  it('refuses a post with no URI and CID', async () => {
    const { client, repo } = setup()
    await expect(client.favourite({ id: POST })).rejects.toMatchObject({ code: 'not_found' })
    expect(repo.createRecord).not.toHaveBeenCalled()
  })

  it('a bookmark has no record: createBookmark and deleteBookmark, flag only', async () => {
    const { client, bookmark } = setup()
    expect(await client.bookmark(ref())).toEqual({ ack: true, id: POST, on: true, record: null })
    expect(bookmark.createBookmark).toHaveBeenCalledWith({ uri: POST, cid: 'bafypost' })
    expect(await client.unbookmark(ref())).toEqual({ ack: true, id: POST, on: false, record: null })
    expect(bookmark.deleteBookmark).toHaveBeenCalledWith({ uri: POST })
  })

  it('a 401 on a write calls onUnauthorized and fails unauthorized', async () => {
    const { client, repo, onUnauthorized } = setup()
    repo.createRecord.mockRejectedValueOnce(xrpcError(401, 'AuthRequired'))
    await expect(client.favourite(ref())).rejects.toMatchObject({ code: 'unauthorized' })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('two equal writes are two requests (no dedup)', async () => {
    const { client, repo } = setup()
    await Promise.all([client.favourite(ref()), client.favourite(ref())])
    expect(repo.createRecord).toHaveBeenCalledTimes(2)
  })
})

describe('Bluesky relationship actions', () => {
  const acct = (over: { followUri?: string | null; blockUri?: string | null } = {}) =>
    ({ id: 'did:plc:alice', bluesky: { followUri: null, blockUri: null, ...over } })

  it('a follow writes a follow record on the DID and answers its URI', async () => {
    const { client, repo } = setup()
    const ack = await client.follow(acct())
    expect(repo.createRecord).toHaveBeenCalledWith({
      repo: ME, collection: 'app.bsky.graph.follow',
      record: { $type: 'app.bsky.graph.follow', subject: 'did:plc:alice', createdAt: expect.any(String) },
    })
    expect(ack).toEqual({ ack: true, id: 'did:plc:alice', flags: { following: true }, bluesky: { followUri: `at://${ME}/app.bsky.graph.follow/3knew1` } })
  })

  it('an unfollow deletes the follow record the ref names', async () => {
    const { client, repo } = setup()
    const ack = await client.unfollow(acct({ followUri: FOLLOW }))
    expect(repo.deleteRecord).toHaveBeenCalledWith({ repo: ME, collection: 'app.bsky.graph.follow', rkey: '3kfollow' })
    expect(ack).toEqual({ ack: true, id: 'did:plc:alice', flags: { following: false }, bluesky: { followUri: null } })
  })

  it('an unfollow with no known ref reads the profile first', async () => {
    const { client, repo, agent } = setup()
    agent.getProfile.mockResolvedValueOnce({ data: { did: 'did:plc:alice', handle: 'alice.example.com', viewer: { following: FOLLOW } } })
    await client.unfollow({ id: 'did:plc:alice' })
    expect(agent.getProfile).toHaveBeenCalledWith({ actor: 'did:plc:alice' })
    expect(repo.deleteRecord).toHaveBeenCalledWith({ repo: ME, collection: 'app.bsky.graph.follow', rkey: '3kfollow' })
  })

  it('a block writes a block record and leaves the follow alone; unblock deletes it', async () => {
    const { client, repo } = setup()
    expect(await client.block(acct({ followUri: FOLLOW }))).toEqual({
      ack: true, id: 'did:plc:alice', flags: { blocking: true }, bluesky: { blockUri: `at://${ME}/app.bsky.graph.block/3knew1` },
    })
    expect(repo.deleteRecord).not.toHaveBeenCalled()
    await client.unblock(acct({ blockUri: BLOCK }))
    expect(repo.deleteRecord).toHaveBeenCalledWith({ repo: ME, collection: 'app.bsky.graph.block', rkey: '3kblock' })
  })

  it('refuses to delete a block record from another repo', async () => {
    const { client, repo } = setup()
    await expect(client.unblock(acct({ blockUri: 'at://did:plc:alice/app.bsky.graph.block/3kblock' }))).rejects.toBeInstanceOf(CaribouError)
    expect(repo.deleteRecord).not.toHaveBeenCalled()
  })

  it('mute and unmute call muteActor and unmuteActor; no record', async () => {
    const { client, graph, repo } = setup()
    expect(await client.mute(acct())).toEqual({ ack: true, id: 'did:plc:alice', flags: { muting: true, mutingNotifications: true } })
    expect(graph.muteActor).toHaveBeenCalledWith({ actor: 'did:plc:alice' })
    expect(await client.unmute(acct())).toEqual({ ack: true, id: 'did:plc:alice', flags: { muting: false, mutingNotifications: false } })
    expect(graph.unmuteActor).toHaveBeenCalledWith({ actor: 'did:plc:alice' })
    expect(repo.createRecord).not.toHaveBeenCalled()
  })
})
