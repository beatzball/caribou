import { describe, expect, it } from 'vitest'
import { BLUESKY_FLAG_KEY } from '../_bluesky.js'
import { blueskyActor, blueskyPostUri, didOfUserKey, rendersBluesky } from '../_bluesky-route.js'

describe('blueskyActor (spec 8.4)', () => {
  it.each([
    ['alice@example.social', null],
    ['@alice@example.social', null],
    ['alice', null],
    ['', null],
    ['did:plc:alice', 'did:plc:alice'],
    ['alice.example.com', 'alice.example.com'],
    ['@alice.example.com', 'alice.example.com'],
    ['first.last@example.social', null],
  ])('%s → %s', (segment, actor) => {
    expect(blueskyActor(segment)).toBe(actor)
  })
})

describe('helpers', () => {
  it('builds a post URI and reads a DID from a user key', () => {
    expect(blueskyPostUri('did:plc:alice', '3k1')).toBe('at://did:plc:alice/app.bsky.feed.post/3k1')
    expect(didOfUserKey('did:plc:alice@bsky')).toBe('did:plc:alice')
  })

  it('renders Bluesky views only with the flag on and a Bluesky client', () => {
    const on = { localStorage: { getItem: (k: string) => (k === BLUESKY_FLAG_KEY ? '1' : null) } } as unknown as Window
    const off = { localStorage: { getItem: () => null } } as unknown as Window
    const bsky = { capabilities: { network: 'bluesky' } } as never
    const masto = { capabilities: { network: 'mastodon' } } as never
    expect(rendersBluesky(on, bsky)).toBe(true)
    expect(rendersBluesky(off, bsky)).toBe(false)
    expect(rendersBluesky(on, masto)).toBe(false)
    expect(rendersBluesky(on, null)).toBe(false)
  })
})
