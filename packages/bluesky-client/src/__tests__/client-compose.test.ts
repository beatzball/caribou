import { CaribouError, type BlueskyPostRecord } from '@beatzball/caribou-mastodon-client'
import { describe, expect, it, vi } from 'vitest'
import { blobRefJson, createBlueskyClient, type BlueskyAgent } from '../client.js'
import { BlueskyBlobNotFound } from '../errors.js'
import { moderationFor, READER } from './_helpers.js'

function xrpcError(status: number, error: string, message = error) {
  return Object.assign(new Error(message), { status, error })
}

const RECORD: BlueskyPostRecord = { $type: 'app.bsky.feed.post', text: 'hello', createdAt: '2026-11-08T00:00:00.000Z' }

function setup(compose = true) {
  const repo = {
    createRecord: vi.fn(async () => ({ data: { uri: 'at://did:plc:reader/app.bsky.feed.post/3kabc', cid: 'bafypost' } })),
    getRecord: vi.fn(),
    uploadBlob: vi.fn(),
  }
  const agent = { did: 'did:plc:reader', com: { atproto: { repo } } }
  const onUnauthorized = vi.fn()
  const nextRkey = vi.fn(() => '3kabcdefghij2')
  const detectFacets = vi.fn(async () => [])
  const client = createBlueskyClient({
    userKey: READER,
    agent: agent as unknown as BlueskyAgent,
    moderation: { post: (v) => moderationFor(v.uri), profile: (v) => moderationFor(v.did) },
    onUnauthorized,
    ...(compose ? { compose: { nextRkey, detectFacets } } : {}),
  })
  return { client, repo, onUnauthorized, nextRkey, detectFacets }
}

describe('blueskyCreatePost', () => {
  it('writes the record with the given rkey to the reader repo, and answers its strong ref', async () => {
    const { client, repo } = setup()
    const ref = await client.blueskyCreatePost!(RECORD, '3kabcdefghij2')
    expect(repo.createRecord).toHaveBeenCalledWith({
      repo: 'did:plc:reader', collection: 'app.bsky.feed.post', rkey: '3kabcdefghij2', record: RECORD,
    })
    expect(ref).toEqual({ uri: 'at://did:plc:reader/app.bsky.feed.post/3kabc', cid: 'bafypost' })
  })

  it('never shares a request: two sends are two requests', async () => {
    const { client, repo } = setup()
    await Promise.all([client.blueskyCreatePost!(RECORD, 'k'), client.blueskyCreatePost!(RECORD, 'k')])
    expect(repo.createRecord).toHaveBeenCalledTimes(2)
  })

  it('a missing blob is BlueskyBlobNotFound, with its CID', async () => {
    const { client, repo } = setup()
    repo.createRecord.mockRejectedValueOnce(xrpcError(400, 'BlobNotFound', 'Could not find blob: bafkreiabc123'))
    const err = await client.blueskyCreatePost!(RECORD, 'k').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BlueskyBlobNotFound)
    expect((err as BlueskyBlobNotFound).cid).toBe('bafkreiabc123')
    expect((err as BlueskyBlobNotFound).code).toBe('not_found')
  })

  it('a used rkey gives a plain 500 (spec 7.2): server_error, not a special code', async () => {
    const { client, repo } = setup()
    repo.createRecord.mockRejectedValueOnce(xrpcError(500, 'InternalServerError', 'Internal Server Error'))
    await expect(client.blueskyCreatePost!(RECORD, 'k')).rejects.toMatchObject({ code: 'server_error' })
  })

  it('a 401 calls onUnauthorized', async () => {
    const { client, repo, onUnauthorized } = setup()
    repo.createRecord.mockRejectedValueOnce(xrpcError(401, 'AuthRequired'))
    await expect(client.blueskyCreatePost!(RECORD, 'k')).rejects.toMatchObject({ code: 'unauthorized' })
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })
})

describe('blueskyGetOwnPost', () => {
  it('reads the record from the reader repo on the PDS', async () => {
    const { client, repo } = setup()
    repo.getRecord.mockResolvedValueOnce({ data: { uri: 'at://did:plc:reader/app.bsky.feed.post/k', cid: 'bafy', value: RECORD } })
    await expect(client.blueskyGetOwnPost!('k')).resolves.toEqual({ uri: 'at://did:plc:reader/app.bsky.feed.post/k', cid: 'bafy', value: RECORD })
    expect(repo.getRecord).toHaveBeenCalledWith({ repo: 'did:plc:reader', collection: 'app.bsky.feed.post', rkey: 'k' })
  })

  it('answers null for RecordNotFound', async () => {
    const { client, repo } = setup()
    repo.getRecord.mockRejectedValueOnce(xrpcError(400, 'RecordNotFound', 'Could not locate record: at://x'))
    await expect(client.blueskyGetOwnPost!('k')).resolves.toBeNull()
  })

  it('throws on a network error: an unknown answer is never "not found"', async () => {
    const { client, repo } = setup()
    repo.getRecord.mockRejectedValueOnce(Object.assign(new Error('fetch failed'), { status: 1 }))
    await expect(client.blueskyGetOwnPost!('k')).rejects.toMatchObject({ code: 'unreachable' })
  })

  it('throws on a 5xx', async () => {
    const { client, repo } = setup()
    repo.getRecord.mockRejectedValueOnce(xrpcError(502, 'UpstreamFailure'))
    await expect(client.blueskyGetOwnPost!('k')).rejects.toMatchObject({ code: 'server_error' })
  })
})

describe('blueskyUploadBlob', () => {
  it('uploads the file with its type and answers the JSON blob ref', async () => {
    const { client, repo } = setup()
    const cid = { toString: () => 'bafkreiimg' }
    repo.uploadBlob.mockResolvedValueOnce({ data: { blob: { ref: cid, mimeType: 'image/jpeg', size: 1234 } } })
    const file = new Blob(['x'], { type: 'image/jpeg' })
    await expect(client.blueskyUploadBlob!(file)).resolves.toEqual({
      $type: 'blob', ref: { $link: 'bafkreiimg' }, mimeType: 'image/jpeg', size: 1234,
    })
    expect(repo.uploadBlob).toHaveBeenCalledWith(file, { encoding: 'image/jpeg' })
  })
})

describe('blobRefJson', () => {
  it('keeps a JSON ref as it is', () => {
    expect(blobRefJson({ ref: { $link: 'bafy' }, mimeType: 'image/png', size: 1 }))
      .toEqual({ $type: 'blob', ref: { $link: 'bafy' }, mimeType: 'image/png', size: 1 })
  })

  it('refuses a shape that is not a blob', () => {
    expect(() => blobRefJson({})).toThrow(CaribouError)
  })
})

describe('rkey and facets', () => {
  it('come from the compose helpers', async () => {
    const { client, nextRkey, detectFacets } = setup()
    await expect(client.blueskyNextRkey!()).resolves.toBe('3kabcdefghij2')
    await client.blueskyDetectFacets!('hi')
    expect(nextRkey).toHaveBeenCalledOnce()
    expect(detectFacets).toHaveBeenCalledWith('hi')
  })

  it('answer not_found without them', async () => {
    const { client } = setup(false)
    await expect(client.blueskyNextRkey!()).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('the Mastodon-shaped compose methods', () => {
  it('are not used for Bluesky', async () => {
    const { client } = setup()
    await expect(client.createStatus({ status: 'x' } as never)).rejects.toMatchObject({ code: 'not_found' })
    await expect(client.updateMedia('id', { description: 'x' })).rejects.toMatchObject({ code: 'not_found' })
  })
})
