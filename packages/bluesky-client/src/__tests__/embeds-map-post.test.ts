import type { AppBskyFeedDefs } from '@atproto/api'
import type { Quote, Status } from '@beatzball/caribou-mastodon-client'
import { describe, expect, it, vi } from 'vitest'
import { mapPost } from '../map/post.js'
import type { MapContext } from '../map/context.js'
import * as fx from '../__fixtures__/embeds.js'
import { moderationFor } from './_helpers.js'

// Embeds through the real `mapPost`: the post URI reaches the video and
// fallback cards, the record card reaches `bluesky.recordCard`, and a quoted
// post is mapped by the same code as the outer one. Only the facet renderer
// (#178, not merged yet) is a stand-in.
vi.mock('../facets.js', () => ({ renderFacets: (text: string) => `<p>${text}</p>` }))

const signedOut: MapContext = { viewerOf: null, moderatePost: (view) => moderationFor(view.uri) }
const signedIn: MapContext = { ...signedOut, viewerOf: 'did:plc:reader@bsky' }

// `mapEmbed` always gives a full quote, never a shallow one.
const quoteOf = (s: Status) => s.quote as Quote | null | undefined

const BOB_URL = 'https://bsky.app/profile/did:plc:bob/post/3kquoted'

function post(embed: unknown): AppBskyFeedDefs.PostView {
  return {
    uri: fx.POST_URI,
    cid: 'bafkpost',
    author: { did: 'did:plc:alice', handle: 'alice.example.com' },
    record: { $type: 'app.bsky.feed.post', text: 'hi', createdAt: '2026-11-01T09:00:00.000Z' },
    embed: embed as AppBskyFeedDefs.PostView['embed'],
    indexedAt: '2026-11-01T09:00:01.000Z',
  }
}

describe('embeds through mapPost', () => {
  it('links a video to its own post on bsky.app', () => {
    const s = mapPost(post(fx.videoView), signedOut)
    expect(s.card).toMatchObject({ type: 'video', url: fx.POST_URL })
    expect(s.url).toBe(fx.POST_URL)
  })

  it('links the fallback card to its own post', () => {
    expect(mapPost(post({ $type: 'x#view' }), signedOut).card).toMatchObject({ url: fx.POST_URL, title: 'Not supported here — open on bsky.app' })
  })

  it('puts a feed next to images in bluesky.recordCard', () => {
    const s = mapPost(post(fx.feedWithImagesView), signedOut)
    expect(s.mediaAttachments).toHaveLength(2)
    expect(s.card).toBeNull()
    expect(s.bluesky?.recordCard).toMatchObject({ title: 'Caribou pictures', url: 'https://bsky.app/profile/did:plc:alice/feed/caribous' })
  })

  it('leaves recordCard null when the post embeds no record', () => {
    expect(mapPost(post(fx.imagesView), signedOut).bluesky?.recordCard).toBeNull()
  })

  it('maps a quoted post, whose own video links to the quoted post', () => {
    const quoted = { ...fx.viewRecord, embeds: [fx.videoView] }
    const s = mapPost(post({ ...fx.recordView, record: quoted }), signedOut)
    const q = quoteOf(s)?.quotedStatus
    expect(q?.id).toBe(fx.viewRecord.uri)
    expect(q?.account.acct).toBe('bob.example.com')
    expect(q?.content).toContain('The quoted post')
    expect(q?.bluesky?.labels.map((l) => l.val)).toEqual(['spam', 'graphic-media'])
    expect(q?.bluesky?.moderation).toEqual(moderationFor(fx.viewRecord.uri))
    expect(q?.card).toMatchObject({ type: 'video', url: BOB_URL })
  })

  it('maps one level of quote in a chain that quotes itself', () => {
    const chain: Record<string, unknown> = { ...fx.viewRecord }
    const view = { $type: 'app.bsky.embed.record#view', record: chain }
    chain.embeds = [view]
    const s = mapPost(post(view), signedOut)
    expect(quoteOf(s)?.quotedStatus?.id).toBe(fx.viewRecord.uri)
    expect(quoteOf(s)?.quotedStatus?.quote).toEqual({ state: 'accepted', quotedStatus: null })
  })

  describe('a quoted author with !no-unauthenticated (spec 8.3)', () => {
    const label = { src: 'did:plc:bob', uri: 'at://did:plc:bob/app.bsky.actor.profile/self', val: '!no-unauthenticated', cts: '2026-01-01T00:00:00.000Z' }
    const hidden = { ...fx.recordView, record: { ...fx.viewRecord, author: { ...fx.viewRecord.author, labels: [label] } } }

    it('keeps none of the quoted post for a signed-out reader', () => {
      const s = mapPost(post(hidden), signedOut)
      expect(s.quote).toEqual({ state: 'unauthorized', quotedStatus: null, bluesky: { hidden: 'no-unauthenticated' } })
      const json = JSON.stringify(s)
      for (const text of ['The quoted post', 'bob.example.com', 'Bob', '3kquoted']) expect(json).not.toContain(text)
    })

    it('shows it to a signed-in Bluesky reader', () => {
      expect(quoteOf(mapPost(post(hidden), signedIn))?.quotedStatus?.id).toBe(fx.viewRecord.uri)
    })
  })
})
