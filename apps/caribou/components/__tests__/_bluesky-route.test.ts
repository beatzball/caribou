import { describe, expect, it } from 'vitest'
import { blueskyActor, blueskyPostUri, decodeSegment, didOfUserKey, postRouteOf, rendersBluesky, routeOf, routeSegment } from '../_bluesky-route.js'

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

describe('routeOf: the route rules, in order (spec 8.4)', () => {
  it('rule 1: a second @ is a remote Mastodon account', () => {
    expect(routeOf('@alice@example.social')).toEqual({ network: 'mastodon', remote: true })
  })

  it('rule 2: did: is Bluesky by DID', () => {
    expect(routeOf('did:plc:alice')).toEqual({ network: 'bluesky', by: 'did', actor: 'did:plc:alice' })
    expect(routeOf('@did:web:example.com')).toEqual({ network: 'bluesky', by: 'did', actor: 'did:web:example.com' })
  })

  it('rule 3: a dot is a Bluesky handle', () => {
    expect(routeOf('@alice.example.com')).toEqual({ network: 'bluesky', by: 'handle', actor: 'alice.example.com' })
  })

  it('rule 4: no dot is a local Mastodon account', () => {
    expect(routeOf('alice')).toEqual({ network: 'mastodon', remote: false })
  })

  it('rule 1 comes first: a dotted name with a host is Mastodon', () => {
    expect(routeOf('first.last@example.social')).toEqual({ network: 'mastodon', remote: true })
    expect(routeOf('did:plc:alice@example.social')).toEqual({ network: 'mastodon', remote: true })
  })

  it('rule 2 comes before rule 3: a DID with a dot is a DID', () => {
    expect(routeOf('did:web:alice.example.com')).toEqual({ network: 'bluesky', by: 'did', actor: 'did:web:alice.example.com' })
  })

  it('an empty segment is a Mastodon one, as before', () => {
    expect(routeOf('')).toEqual({ network: 'mastodon', remote: false })
  })
})

describe('one segment, one route on both sides', () => {
  // The server decodes the router param with `decodeSegment`; the client
  // reads the address with `routeSegment`. Encoded forms agree.
  it.each([
    ['alice%40example.social', { network: 'mastodon', remote: true }],
    ['did%3Aplc%3Aalice', { network: 'bluesky', by: 'did', actor: 'did:plc:alice' }],
    ['%40alice.example.com', { network: 'bluesky', by: 'handle', actor: 'alice.example.com' }],
  ])('%s', (raw, route) => {
    expect(routeOf(decodeSegment(raw))).toEqual(route)
    expect(routeOf(routeSegment(`/@${raw}`))).toEqual(route)
    expect(routeOf(routeSegment(`/@${raw}/3k1`))).toEqual(route)
  })

  it('a segment that does not decode is empty, on both sides', () => {
    expect(decodeSegment('%E0%A4%A')).toBe('')
    expect(routeSegment('/@%E0%A4%A')).toBe('')
  })
})

describe('postRouteOf: rule 5 (spec 8.4)', () => {
  it('a post under a DID or a handle is a Bluesky post, whatever the id looks like', () => {
    expect(postRouteOf('did:plc:alice', '3kabc')).toEqual({ network: 'bluesky', actor: 'did:plc:alice', rkey: '3kabc' })
    expect(postRouteOf('alice.example.com', '109876543210')).toEqual({ network: 'bluesky', actor: 'alice.example.com', rkey: '109876543210' })
  })

  it('a post under a Mastodon segment is a Mastodon post, whatever the id looks like', () => {
    expect(postRouteOf('alice', '3kabc')).toEqual({ network: 'mastodon' })
    expect(postRouteOf('first.last@example.social', '3kabc')).toEqual({ network: 'mastodon' })
  })
})

describe('helpers', () => {
  it('builds a post URI and reads a DID from a user key', () => {
    expect(blueskyPostUri('did:plc:alice', '3k1')).toBe('at://did:plc:alice/app.bsky.feed.post/3k1')
    expect(didOfUserKey('did:plc:alice@bsky')).toBe('did:plc:alice')
  })

  it('renders Bluesky views only for a Bluesky client', () => {
    const bsky = { capabilities: { network: 'bluesky' } } as never
    const masto = { capabilities: { network: 'mastodon' } } as never
    expect(rendersBluesky(bsky)).toBe(true)
    expect(rendersBluesky(masto)).toBe(false)
    expect(rendersBluesky(null)).toBe(false)
  })
})
