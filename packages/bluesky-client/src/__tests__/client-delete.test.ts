import { describe, expect, it, vi } from 'vitest'
import { createBlueskyClient, type BlueskyAgent } from '../client.js'
import { moderationFor, READER } from './_helpers.js'

function xrpcError(status: number, error: string, message = error) {
  return Object.assign(new Error(message), { status, error })
}

const OWN = 'at://did:plc:reader/app.bsky.feed.post/3kown'

function setup() {
  const repo = { deleteRecord: vi.fn(async () => ({ data: {} })) }
  const sync = {
    getBlob: vi.fn(async () => ({ data: new Uint8Array([1, 2, 3]), headers: { 'content-type': 'image/jpeg' } })),
  }
  const agent = { did: 'did:plc:reader', com: { atproto: { repo, sync } } }
  const onUnauthorized = vi.fn()
  const client = createBlueskyClient({
    userKey: READER,
    agent: agent as unknown as BlueskyAgent,
    moderation: { post: (v) => moderationFor(v.uri), profile: (v) => moderationFor(v.did) },
    onUnauthorized,
  })
  return { client, repo, sync, onUnauthorized }
}

describe('blueskyDeletePost', () => {
  it('deletes the post record by its rkey, in the reader repo', async () => {
    const { client, repo } = setup()
    await client.blueskyDeletePost!(OWN)
    expect(repo.deleteRecord).toHaveBeenCalledWith({ repo: 'did:plc:reader', collection: 'app.bsky.feed.post', rkey: '3kown' })
  })

  it.each([
    ['another repo', 'at://did:plc:bob/app.bsky.feed.post/3kbob'],
    ['a like record', 'at://did:plc:reader/app.bsky.feed.like/3klike'],
    ['a repost record', 'at://did:plc:reader/app.bsky.feed.repost/3krp'],
    ['not an AT URI', 'https://bsky.app/profile/did:plc:reader/post/3kown'],
    ['no rkey', 'at://did:plc:reader/app.bsky.feed.post/'],
  ])('refuses %s before any request', async (_, uri) => {
    const { client, repo } = setup()
    await expect(client.blueskyDeletePost!(uri)).rejects.toMatchObject({ code: 'not_found' })
    expect(repo.deleteRecord).not.toHaveBeenCalled()
  })

  it('never shares a request: two deletes are two requests', async () => {
    const { client, repo } = setup()
    await Promise.all([client.blueskyDeletePost!(OWN), client.blueskyDeletePost!(OWN)])
    expect(repo.deleteRecord).toHaveBeenCalledTimes(2)
  })

  it('a refusal is normalized; a 401 calls onUnauthorized', async () => {
    const { client, repo, onUnauthorized } = setup()
    repo.deleteRecord.mockRejectedValueOnce(xrpcError(500, 'InternalServerError'))
    await expect(client.blueskyDeletePost!(OWN)).rejects.toMatchObject({ code: 'server_error' })
    repo.deleteRecord.mockRejectedValueOnce(xrpcError(401, 'AuthRequired'))
    await expect(client.blueskyDeletePost!(OWN)).rejects.toMatchObject({ code: 'unauthorized' })
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })

  it('the Mastodon-shaped deleteStatus and fetchStatusSource name the Bluesky methods', async () => {
    const { client } = setup()
    await expect(client.deleteStatus(OWN)).rejects.toThrow(/blueskyDeletePost/)
    await expect(client.fetchStatusSource(OWN)).rejects.toThrow(/blueskyGetOwnPost/)
  })
})

describe('blueskyGetBlob', () => {
  it('reads the bytes from the reader repo on the PDS, typed from the answer', async () => {
    const { client, sync } = setup()
    const blob = await client.blueskyGetBlob!('bafkimg')
    expect(sync.getBlob).toHaveBeenCalledWith({ did: 'did:plc:reader', cid: 'bafkimg' })
    expect(blob.type).toBe('image/jpeg')
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3])
  })

  it('a failure is normalized', async () => {
    const { client, sync } = setup()
    sync.getBlob.mockRejectedValueOnce(xrpcError(400, 'BlobNotFound', 'Blob not found'))
    await expect(client.blueskyGetBlob!('bafkimg')).rejects.toMatchObject({ code: 'not_found' })
  })
})

// The real SDK, over a fake PDS: the requests it sends, and the bytes it answers.
describe('delete and getBlob through the real SDK', () => {
  it('deleteRecord posts the repo, collection and rkey; getBlob answers the bytes', async () => {
    const { Agent } = await import('@atproto/api')
    const seen: { path: string; body: unknown; query: string }[] = []
    const fetchHandler = async (url: string, init: RequestInit) => {
      const u = new URL(url, 'https://pds.example.test')
      const text = init.body ? await new Response(init.body as BodyInit).text() : ''
      seen.push({ path: u.pathname, query: u.search, body: text ? JSON.parse(text) : null })
      if (u.pathname.endsWith('com.atproto.sync.getBlob')) {
        return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { headers: { 'content-type': 'image/jpeg' } })
      }
      return new Response('{}', { headers: { 'content-type': 'application/json' } })
    }
    const agent = new Agent({ did: 'did:plc:reader', fetchHandler } as never)
    const client = createBlueskyClient({
      userKey: READER,
      agent: agent as unknown as BlueskyAgent,
      moderation: { post: (v) => moderationFor(v.uri), profile: (v) => moderationFor(v.did) },
    })
    await client.blueskyDeletePost!(OWN)
    expect(seen[0]).toMatchObject({
      path: '/xrpc/com.atproto.repo.deleteRecord',
      body: { repo: 'did:plc:reader', collection: 'app.bsky.feed.post', rkey: '3kown' },
    })
    const blob = await client.blueskyGetBlob!('bafkimg')
    expect(seen[1]!.path).toBe('/xrpc/com.atproto.sync.getBlob')
    expect(new URLSearchParams(seen[1]!.query).get('did')).toBe('did:plc:reader')
    expect(blob.type).toBe('image/jpeg')
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0xff, 0xd8, 0xff, 0xd9])
  })
})
