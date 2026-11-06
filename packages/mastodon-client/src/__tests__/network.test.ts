import { describe, expect, it } from 'vitest'
import { canActOn, MASTODON_CAPABILITIES, resourceNetwork, type Account, type Capabilities, type Status } from '../index.js'

const mastodonPost = { id: '1' } as Status
const blueskyPost = { id: 'at://did:plc:bob/app.bsky.feed.post/3k1', bluesky: { uri: 'at://x' } } as Status
const blueskyAccount = { id: 'did:plc:bob', bluesky: { did: 'did:plc:bob', handleInvalid: false } } as Account
const mastodon = { capabilities: MASTODON_CAPABILITIES }
const bluesky = { capabilities: { ...MASTODON_CAPABILITIES, network: 'bluesky' } as Capabilities }

describe('resourceNetwork', () => {
  it('reads the network off the resource', () => {
    expect(resourceNetwork(mastodonPost)).toBe('mastodon')
    expect(resourceNetwork(blueskyPost)).toBe('bluesky')
    expect(resourceNetwork({ id: 'a1' } as Account)).toBe('mastodon')
    expect(resourceNetwork(blueskyAccount)).toBe('bluesky')
  })
})

describe('canActOn', () => {
  it('only on the client\'s own network', () => {
    expect(canActOn(mastodon, mastodonPost)).toBe(true)
    expect(canActOn(mastodon, blueskyPost)).toBe(false)
    expect(canActOn(mastodon, blueskyAccount)).toBe(false)
    expect(canActOn(bluesky, blueskyPost)).toBe(true)
    expect(canActOn(bluesky, mastodonPost)).toBe(false)
    expect(canActOn(null, mastodonPost)).toBe(false)
  })
})
