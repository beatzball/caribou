import { describe, expect, it, vi } from 'vitest'
import { createBlueskyClient, type BlueskyAgent } from '../client.js'
import { BlueskyDeleteUnknown } from '../errors.js'
import { moderationFor, READER } from './_helpers.js'

function xrpcError(status: number, error: string, message = error) {
  return Object.assign(new Error(message), { status, error })
}

const OWN = 'at://did:plc:reader/app.bsky.feed.post/3kown'

const THREADGATE = 'app.bsky.feed.threadgate'
const POSTGATE = 'app.bsky.feed.postgate'

function setup(gates: string[] = []) {
  const repo = {
    deleteRecord: vi.fn(async () => ({ data: {} })),
    applyWrites: vi.fn(async () => ({ data: { results: [] } })),
    // The gates a test names are there; the post is gone (after a delete in
    // doubt) unless a test says otherwise.
    getRecord: vi.fn(async ({ collection }: { collection: string }): Promise<unknown> => {
      if (gates.includes(collection)) return { data: { uri: `at://did:plc:reader/${collection}/3kown`, value: { $type: collection } } }
      throw xrpcError(400, 'RecordNotFound', 'Could not locate record')
    }),
  }
  const postReads = () => repo.getRecord.mock.calls.filter(([a]) => a.collection === 'app.bsky.feed.post')
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
  return { client, repo, sync, onUnauthorized, postReads }
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

  it('an answered 4xx refusal is thrown as it is, with no check; a 401 calls onUnauthorized', async () => {
    const { client, repo, onUnauthorized, postReads } = setup()
    repo.deleteRecord.mockRejectedValueOnce(xrpcError(400, 'InvalidRequest'))
    await expect(client.blueskyDeletePost!(OWN)).rejects.toMatchObject({ code: 'unknown', status: 400 })
    repo.deleteRecord.mockRejectedValueOnce(xrpcError(401, 'AuthRequired'))
    await expect(client.blueskyDeletePost!(OWN)).rejects.toMatchObject({ code: 'unauthorized' })
    expect(onUnauthorized).toHaveBeenCalledOnce()
    expect(postReads()).toEqual([])
  })

  // Only getRecord decides a delete in doubt (README, "Delete").
  it.each([
    ['no answer', xrpcError(1, 'Unknown', 'fetch failed')],
    ['a 5xx', xrpcError(502, 'UpstreamFailure')],
  ])('%s, then the record is not found: the delete happened', async (_, err) => {
    const { client, repo } = setup()
    repo.deleteRecord.mockRejectedValueOnce(err)
    await expect(client.blueskyDeletePost!(OWN)).resolves.toBeUndefined()
    expect(repo.getRecord).toHaveBeenCalledWith({ repo: 'did:plc:reader', collection: 'app.bsky.feed.post', rkey: '3kown' })
  })

  it('a 5xx, then the record is found: the delete failed, and its error is thrown', async () => {
    const { client, repo } = setup()
    repo.deleteRecord.mockRejectedValueOnce(xrpcError(500, 'InternalServerError'))
    repo.getRecord.mockImplementation(async ({ collection }: { collection: string }) => {
      if (collection === 'app.bsky.feed.post') return { data: { uri: OWN, cid: 'bafy', value: {} } }
      throw xrpcError(400, 'RecordNotFound')
    })
    await expect(client.blueskyDeletePost!(OWN)).rejects.toMatchObject({ code: 'server_error' })
  })

  it('a 5xx, then the check fails too: BlueskyDeleteUnknown', async () => {
    const { client, repo } = setup()
    repo.deleteRecord.mockRejectedValueOnce(xrpcError(500, 'InternalServerError'))
    repo.getRecord.mockImplementation(async ({ collection }: { collection: string }) => {
      throw collection === 'app.bsky.feed.post' ? xrpcError(502, 'UpstreamFailure') : xrpcError(400, 'RecordNotFound')
    })
    const err = await client.blueskyDeletePost!(OWN).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BlueskyDeleteUnknown)
    expect((err as BlueskyDeleteUnknown).code).toBe('unknown')
    expect((err as Error).name).toBe('BlueskyDeleteUnknown')
  })

  // #262, rule 1: a post with no gate is one deleteRecord, as before.
  it('no gate: reads both gates, then one deleteRecord of the post', async () => {
    const { client, repo } = setup()
    await client.blueskyDeletePost!(OWN)
    expect(repo.getRecord).toHaveBeenCalledWith({ repo: 'did:plc:reader', collection: THREADGATE, rkey: '3kown' })
    expect(repo.getRecord).toHaveBeenCalledWith({ repo: 'did:plc:reader', collection: POSTGATE, rkey: '3kown' })
    expect(repo.deleteRecord).toHaveBeenCalledOnce()
    expect(repo.applyWrites).not.toHaveBeenCalled()
  })

  // #262, rules 2 and 3: one applyWrites, naming only the gates found.
  it.each([
    ['both gates', [THREADGATE, POSTGATE]],
    ['only a thread gate', [THREADGATE]],
    ['only a post gate', [POSTGATE]],
  ])('%s: one applyWrites deletes the post and each gate found', async (_, found) => {
    const { client, repo } = setup(found)
    await client.blueskyDeletePost!(OWN)
    expect(repo.deleteRecord).not.toHaveBeenCalled()
    const del = (collection: string) => ({ $type: 'com.atproto.repo.applyWrites#delete', collection, rkey: '3kown' })
    expect(repo.applyWrites).toHaveBeenCalledWith({
      repo: 'did:plc:reader',
      writes: [del('app.bsky.feed.post'), ...[THREADGATE, POSTGATE].filter((c) => found.includes(c)).map(del)],
    })
  })

  // #262, rule 4: a gate read that fails writes nothing.
  it('a gate read that fails fails the delete, with nothing written', async () => {
    const { client, repo } = setup()
    repo.getRecord.mockImplementation(async ({ collection }: { collection: string }) => {
      throw collection === POSTGATE ? xrpcError(502, 'UpstreamFailure') : xrpcError(400, 'RecordNotFound')
    })
    await expect(client.blueskyDeletePost!(OWN)).rejects.toMatchObject({ code: 'server_error' })
    expect(repo.deleteRecord).not.toHaveBeenCalled()
    expect(repo.applyWrites).not.toHaveBeenCalled()
  })

  // #262: the applyWrites is decided in doubt as the deleteRecord is.
  it('the applyWrites in doubt: the post not found means post and gates are gone', async () => {
    const { client, repo, postReads } = setup([THREADGATE])
    repo.applyWrites.mockRejectedValueOnce(xrpcError(1, 'Unknown', 'fetch failed'))
    await expect(client.blueskyDeletePost!(OWN)).resolves.toBeUndefined()
    expect(postReads()).toHaveLength(1)
  })

  it('a gate gone before the applyWrites (the PDS 500s, the post is found): the delete failed', async () => {
    const { client, repo } = setup([THREADGATE])
    repo.applyWrites.mockImplementationOnce(async () => {
      repo.getRecord.mockImplementation(async ({ collection }: { collection: string }) => {
        if (collection === 'app.bsky.feed.post') return { data: { uri: OWN, cid: 'bafy', value: {} } }
        throw xrpcError(400, 'RecordNotFound')
      })
      throw xrpcError(500, 'InternalServerError', 'Could not find a record with key: app.bsky.feed.threadgate/3kown')
    })
    await expect(client.blueskyDeletePost!(OWN)).rejects.toMatchObject({ code: 'server_error' })
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
  it('delete reads the gates, then deleteRecord or applyWrites; getBlob answers the bytes', async () => {
    const { Agent } = await import('@atproto/api')
    let gateFound = false
    const seen: { path: string; body: unknown; query: string }[] = []
    const fetchHandler = async (url: string, init: RequestInit) => {
      const u = new URL(url, 'https://pds.example.test')
      const text = init.body ? await new Response(init.body as BodyInit).text() : ''
      seen.push({ path: u.pathname, query: u.search, body: text ? JSON.parse(text) : null })
      if (u.pathname.endsWith('com.atproto.repo.getRecord')) {
        const found = gateFound && u.searchParams.get('collection') === THREADGATE
        return found
          ? Response.json({ uri: `at://did:plc:reader/${THREADGATE}/3kown`, value: { $type: THREADGATE } })
          : Response.json({ error: 'RecordNotFound', message: 'Could not locate record' }, { status: 400 })
      }
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
    expect(seen.map((r) => r.path).slice(0, 2)).toEqual(['/xrpc/com.atproto.repo.getRecord', '/xrpc/com.atproto.repo.getRecord'])
    expect(seen[2]).toMatchObject({
      path: '/xrpc/com.atproto.repo.deleteRecord',
      body: { repo: 'did:plc:reader', collection: 'app.bsky.feed.post', rkey: '3kown' },
    })
    // #262: a gate found → one applyWrites.
    gateFound = true
    seen.length = 0
    await client.blueskyDeletePost!(OWN)
    expect(seen[2]).toMatchObject({
      path: '/xrpc/com.atproto.repo.applyWrites',
      body: {
        repo: 'did:plc:reader',
        writes: [
          { $type: 'com.atproto.repo.applyWrites#delete', collection: 'app.bsky.feed.post', rkey: '3kown' },
          { $type: 'com.atproto.repo.applyWrites#delete', collection: THREADGATE, rkey: '3kown' },
        ],
      },
    })
    seen.length = 0
    const blob = await client.blueskyGetBlob!('bafkimg')
    expect(seen[0]!.path).toBe('/xrpc/com.atproto.sync.getBlob')
    expect(new URLSearchParams(seen[0]!.query).get('did')).toBe('did:plc:reader')
    expect(blob.type).toBe('image/jpeg')
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0xff, 0xd8, 0xff, 0xd9])
  })
})
