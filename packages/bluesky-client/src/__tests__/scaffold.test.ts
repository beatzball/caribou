import { describe, expect, it } from 'vitest'
import { feedEntryId, mapAccount, mapEmbed, mapFeedEntry, mapPost, mapRelationship, renderFacets } from '../index.js'

// The scaffold (#177) fixes each module's signature. Each owner deletes its
// line here when the real code and its tests land.
describe('scaffold stubs', () => {
  const post = { uri: 'at://did:plc:alice/app.bsky.feed.post/3kabc', cid: 'bafy', author: { did: 'did:plc:alice', handle: 'alice.example.com' }, record: {}, indexedAt: '2026-11-06T00:00:00.000Z' }
  const ctx = { viewerOf: null, moderatePost: () => { throw new Error('unused') } }
  const cases: [string, () => unknown][] = [
    ['#177', () => mapPost(post, ctx)],
    ['#177', () => mapAccount(post.author)],
    ['#177', () => mapRelationship(post.author)],
    ['#177', () => feedEntryId({ post })],
    ['#177', () => mapFeedEntry({ post }, ctx)],
    ['#178', () => renderFacets('hi', undefined)],
    ['#179', () => mapEmbed(undefined, ctx)],
  ]
  it.each(cases)('%s owns a stub that says TODO', (owner, call) => {
    expect(call).toThrow(`TODO(${owner})`)
  })
})
