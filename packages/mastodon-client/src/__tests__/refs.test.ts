import { describe, expect, it } from 'vitest'
import { accountRef, statusRef } from '../refs.js'
import type { Relationship, Status, StatusBluesky } from '../types.js'

describe('statusRef', () => {
  it('gives only the id for a Mastodon post', () => {
    expect(statusRef({ id: '110' } as Status)).toEqual({ id: '110' })
  })

  it('keeps the URI, CID and record refs of a Bluesky post, and nothing else', () => {
    const bluesky = {
      uri: 'at://did:plc:bob/app.bsky.feed.post/3k1', cid: 'bafy1',
      likeUri: 'at://did:plc:me/app.bsky.feed.like/3l1', repostUri: null,
      labels: [], replyRef: null,
    } as unknown as StatusBluesky
    expect(statusRef({ id: bluesky.uri, bluesky })).toEqual({
      id: bluesky.uri,
      bluesky: { uri: bluesky.uri, cid: 'bafy1', likeUri: bluesky.likeUri, repostUri: null },
    })
  })
})

describe('accountRef', () => {
  it('gives only the id with no relationship, or a Mastodon one', () => {
    expect(accountRef('42')).toEqual({ id: '42' })
    expect(accountRef('42', { id: '42', following: true } as Relationship)).toEqual({ id: '42' })
  })

  it('keeps the follow and block records of a Bluesky relationship', () => {
    const bluesky = { followUri: 'at://did:plc:me/app.bsky.graph.follow/3f1', blockUri: null }
    expect(accountRef('did:plc:bob', { bluesky })).toEqual({ id: 'did:plc:bob', bluesky })
  })
})
