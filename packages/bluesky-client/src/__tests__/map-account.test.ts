import type { AppBskyActorDefs } from '@atproto/api'
import { describe, expect, it, vi } from 'vitest'
import { renderFacets } from '../facets.js'
import { mapAccount, mapRelationship } from '../map/account.js'
import { fixture } from './_helpers.js'

vi.mock('../facets.js', () => ({
  renderFacets: vi.fn((text: string) => `<p>${text}</p>`),
}))

const profile = () => fixture<AppBskyActorDefs.ProfileViewDetailed>('profile-detailed.json')

describe('mapAccount', () => {
  it('maps a detailed profile', () => {
    const a = mapAccount(profile())
    expect(a).toMatchObject({
      id: 'did:plc:alice', username: 'alice.example.com', acct: 'alice.example.com',
      url: 'https://bsky.app/profile/alice.example.com', displayName: 'Alice 🌷',
      avatar: expect.stringContaining('avatar'), avatarStatic: expect.stringContaining('avatar'),
      header: expect.stringContaining('banner'), headerStatic: expect.stringContaining('banner'),
      statusesCount: 345, followersCount: 120, followingCount: 80,
      createdAt: '2024-01-02T03:04:05.000Z', locked: false, bot: false, fields: [], emojis: [], roles: [],
    })
    expect(a.bluesky).toEqual({
      did: 'did:plc:alice', handleInvalid: false,
      labels: [{ src: 'did:plc:alice', uri: 'at://did:plc:alice/app.bsky.actor.profile/self', cid: 'bafyreialiceprofile', val: '!no-unauthenticated', cts: '2024-01-02T03:04:05.000Z' }],
    })
  })

  it('renders the description with no facets', () => {
    const a = mapAccount(profile())
    expect(renderFacets).toHaveBeenLastCalledWith('Hi <there>\nI post at https://example.com', [])
    expect(a.note).toBe('<p>Hi <there>\nI post at https://example.com</p>')
  })

  it('fills what a basic profile lacks with empty values', () => {
    const a = mapAccount({ did: 'did:plc:bob', handle: 'bob.example.com' })
    expect(a).toMatchObject({ displayName: '', note: '', avatar: '', header: '', statusesCount: 0, followersCount: 0, followingCount: 0, createdAt: '' })
  })

  it('links an unverified handle by DID', () => {
    const a = mapAccount({ did: 'did:plc:bob', handle: 'handle.invalid' })
    expect(a.url).toBe('https://bsky.app/profile/did:plc:bob')
    expect(a.bluesky!.handleInvalid).toBe(true)
  })

  it('leaves moderation to the caller', () => {
    expect(mapAccount(profile()).bluesky!.moderation).toBeUndefined()
  })
})

describe('mapRelationship', () => {
  it('maps the viewer state and keeps the follow record', () => {
    expect(mapRelationship(profile())).toEqual({
      id: 'did:plc:alice', following: true, showingReblogs: true, notifying: false, followedBy: true,
      blocking: false, blockedBy: false, muting: false, mutingNotifications: false, requested: false,
      domainBlocking: false, endorsed: false, note: null, requestedBy: false,
      bluesky: { followUri: 'at://did:plc:reader/app.bsky.graph.follow/3lreaderfollow', blockUri: null, blockingByList: null, mutingByList: null },
    })
  })

  it('counts a block by list as blocking, with no record to delete', () => {
    const list = { uri: 'at://did:plc:reader/app.bsky.graph.list/3l', name: 'l', purpose: 'app.bsky.graph.defs#modlist', cid: 'c' }
    const r = mapRelationship({ did: 'did:plc:bob', handle: 'bob.example.com', viewer: { blockingByList: list, muted: true, mutedByList: list } })
    expect(r).toMatchObject({ blocking: true, muting: true, mutingNotifications: true, bluesky: { blockUri: null, blockingByList: list.uri, mutingByList: list.uri } })
  })

  it('keeps the block record, and reads reposts-only mutes as hidden reposts', () => {
    const r = mapRelationship({ did: 'did:plc:bob', handle: 'bob.example.com', viewer: { blocking: 'at://did:plc:reader/app.bsky.graph.block/3l', blockedBy: true, mutedOnlyReposts: true } })
    expect(r).toMatchObject({ blocking: true, blockedBy: true, muting: false, showingReblogs: false, bluesky: { blockUri: 'at://did:plc:reader/app.bsky.graph.block/3l' } })
  })

  it('reads a profile with no viewer as no relationship', () => {
    expect(mapRelationship({ did: 'did:plc:bob', handle: 'bob.example.com' })).toMatchObject({ following: false, followedBy: false, blocking: false, muting: false, bluesky: { followUri: null, blockUri: null } })
  })
})
