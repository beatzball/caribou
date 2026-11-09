import { BSKY_LABELER_DID, type AppBskyFeedDefs, type ModerationPrefs } from '@atproto/api'
import { describe, expect, it, vi } from 'vitest'
import { createBlueskyClient, type BlueskyAgent } from '../client.js'
import { answerCoverage, parseContentLabelers } from '../content-labelers.js'
import { blueskyCheckSettled, readerModerationSource, type LabelDefs } from '../moderation.js'
import { fixture, READER } from './_helpers.js'

// The labeler coverage of a signed-in read, through the production source:
// the real `readerModerationSource` (what `restoreClient` uses), the SDK's
// moderation and the real reader veil check. Nothing here makes coverage up:
// it comes from the answer's `atproto-content-labelers` header.

vi.mock('../facets.js', () => ({ renderFacets: vi.fn((text: string) => `<p>${text}</p>`) }))
vi.mock('../embeds.js', () => ({ mapEmbed: vi.fn(() => ({ mediaAttachments: [], card: null, recordCard: null, quote: null })) }))

const PREFS: ModerationPrefs = { adultContentEnabled: false, labels: {}, labelers: [], mutedWords: [], hiddenPosts: [] }
const DEFS: LabelDefs = { [BSKY_LABELER_DID]: [] }
const reader = { userKey: READER, prefs: PREFS, labelDefs: DEFS }
const basePost = () => fixture<{ feed: AppBskyFeedDefs.FeedViewPost[] }>('feed-page.json').feed[0]!.post

function setup(opts: {
  listHeaders?: Record<string, string>[]; postHeaders?: Record<string, string>
  inputs?: { prefs: ModerationPrefs | null; labelDefs: LabelDefs | null }
} = {}) {
  const page = fixture<{ cursor?: string; notifications: unknown[] }>('notifications-page.json')
  let call = 0
  const agent = {
    did: 'did:plc:alice',
    listNotifications: vi.fn(async () => ({ data: page, headers: opts.listHeaders?.[call++] ?? opts.listHeaders?.at(-1) ?? {} })),
    getPosts: vi.fn(async ({ uris }: { uris: string[] }) => ({
      data: { posts: uris.map((uri) => ({ ...basePost(), uri, $type: 'app.bsky.feed.defs#postView' })) },
      headers: opts.postHeaders ?? {},
    })),
  }
  const client = createBlueskyClient({
    userKey: READER,
    agent: agent as unknown as BlueskyAgent,
    moderation: readerModerationSource('did:plc:alice', () => opts.inputs ?? { prefs: PREFS, labelDefs: DEFS }),
  })
  return { client, agent }
}

const covered = (labelers: string) => ({ 'atproto-content-labelers': labelers })

describe('parseContentLabelers', () => {
  it('reads each DID without its parameters; anything else is []', () => {
    expect(parseContentLabelers(`${BSKY_LABELER_DID};redact, did:web:labeler.example.com`))
      .toEqual([BSKY_LABELER_DID, 'did:web:labeler.example.com'])
    expect(parseContentLabelers('')).toEqual([])
    expect(parseContentLabelers('not a did, ;')).toEqual([])
    expect(parseContentLabelers(undefined)).toEqual([])
    expect(answerCoverage({ 'Atproto-Content-Labelers': BSKY_LABELER_DID }, [], [])).toEqual([BSKY_LABELER_DID])
    expect(answerCoverage(undefined, [], [])).toEqual([])
  })
})

describe('notification authors and posts carry the coverage their answer established', () => {
  it('a clean author settles once the reader is loaded, from the listNotifications header', async () => {
    const { client } = setup({ listHeaders: [covered(`${BSKY_LABELER_DID};redact`)], postHeaders: covered(BSKY_LABELER_DID) })
    const [like] = await client.fetchNotifications()
    const author = like!.account.bluesky!.moderation!
    expect(author.labelersCovered).toEqual([BSKY_LABELER_DID])
    expect(author.contexts.contentList).toMatchObject({ filter: false, blur: false })
    expect(blueskyCheckSettled({ viewerOf: READER, moderation: author }, reader)).toBe(true)
    // The post comes from getPosts, with that answer's own coverage.
    expect(like!.status!.bluesky!.moderation.labelersCovered).toEqual([BSKY_LABELER_DID])
    expect(blueskyCheckSettled(like!.status!.bluesky!, reader)).toBe(true)
  })

  it('no header: no coverage, never settled', async () => {
    const { client } = setup()
    const [like] = await client.fetchNotifications()
    expect(like!.account.bluesky!.moderation!.labelersCovered).toEqual([])
    expect(blueskyCheckSettled({ viewerOf: READER, moderation: like!.account.bluesky!.moderation! }, reader)).toBe(false)
    expect(blueskyCheckSettled(like!.status!.bluesky!, reader)).toBe(false)
  })

  it('a header without a subscribed labeler: not settled', async () => {
    const withOther = { ...reader, prefs: { ...PREFS, labelers: [{ did: 'did:web:other.example.com', labels: {} }] }, labelDefs: { ...DEFS, 'did:web:other.example.com': [] } }
    const { client } = setup({ listHeaders: [covered(BSKY_LABELER_DID)] })
    const [like] = await client.fetchNotifications()
    expect(blueskyCheckSettled({ viewerOf: READER, moderation: like!.account.bluesky!.moderation! }, withOther)).toBe(false)
  })

  it('reader inputs missing: not settled, whatever the header says', async () => {
    const { client } = setup({ listHeaders: [covered(BSKY_LABELER_DID)] })
    const [like] = await client.fetchNotifications()
    const moderation = like!.account.bluesky!.moderation!
    expect(blueskyCheckSettled({ viewerOf: READER, moderation }, { ...reader, prefs: null })).toBe(false)
    expect(blueskyCheckSettled({ viewerOf: READER, moderation }, { ...reader, labelDefs: null })).toBe(false)
  })

  it('a catch-up over several answers keeps only what every answer covered', async () => {
    // The first page's answer covered Bluesky's labeler; the later ones did not.
    const { client, agent } = setup({ listHeaders: [{}] })
    agent.listNotifications.mockImplementationOnce(async () => ({
      data: { cursor: 'c', notifications: fixture<{ notifications: unknown[] }>('notifications-page.json').notifications.slice(0, 2) },
      headers: covered(BSKY_LABELER_DID),
    }))
    const res = await client.fetchNotifications({ sinceId: 'at://did:plc:bob/app.bsky.feed.like/gone' })
    expect(res.length).toBeGreaterThan(0)
    expect(agent.listNotifications.mock.calls.length).toBeGreaterThan(1)
    expect(res[0]!.account.bluesky!.moderation!.labelersCovered).toEqual([])
  })

  it('a catch-up whose every answer covered a labeler keeps it', async () => {
    const { client } = setup({ listHeaders: [covered(BSKY_LABELER_DID)] })
    const res = await client.fetchNotifications({ sinceId: 'at://did:plc:bob/app.bsky.feed.like/gone' })
    expect(res[0]!.account.bluesky!.moderation!.labelersCovered).toEqual([BSKY_LABELER_DID])
  })
})
