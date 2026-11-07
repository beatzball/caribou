// AppView JSON shapes for moderation tests (`app.bsky.feed.defs#postView`,
// `app.bsky.actor.defs#profileViewBasic`, `app.bsky.labeler.defs#labelerViewDetailed`).
// Placeholder accounts only.
import type { AppBskyActorDefs, AppBskyFeedDefs, AppBskyLabelerDefs, ComAtprotoLabelDefs } from '@atproto/api'

export const ALICE = 'did:plc:alice'
export const BOB = 'did:plc:bob'
/** A third-party labeler the reader subscribes to. */
export const LABELER = 'did:plc:labelerexample'
/** Bluesky's own moderation labeler (`BSKY_LABELER_DID`). */
export const BSKY_LABELER = 'did:plc:ar7c4by46qjdydhdevvrndac'
export const CTS = '2026-11-06T00:00:00.000Z'

const POST_URI = `at://${ALICE}/app.bsky.feed.post/3kabc2xyzaa22`

export function label(val: string, src: string, uri = POST_URI, extra: Partial<ComAtprotoLabelDefs.Label> = {}): ComAtprotoLabelDefs.Label {
  return { ver: 1, src, uri, cid: 'bafyreiexamplecid', val, cts: CTS, ...extra }
}

export function author(did = ALICE, labels: ComAtprotoLabelDefs.Label[] = []): AppBskyActorDefs.ProfileViewBasic {
  return {
    did,
    handle: did === ALICE ? 'alice.example.com' : 'bob.example.com',
    displayName: did === ALICE ? 'Alice' : 'Bob',
    avatar: `https://cdn.bsky.app/img/avatar/plain/${did}/bafkreiexample@jpeg`,
    viewer: { muted: false, blockedBy: false },
    labels,
    createdAt: CTS,
  }
}

export function post(opts: { labels?: ComAtprotoLabelDefs.Label[]; author?: AppBskyActorDefs.ProfileViewBasic } = {}): AppBskyFeedDefs.PostView {
  return {
    uri: POST_URI,
    cid: 'bafyreiexamplecid',
    author: opts.author ?? author(),
    record: { $type: 'app.bsky.feed.post', text: 'Hello from the fixture', createdAt: CTS, langs: ['en'] },
    embed: {
      $type: 'app.bsky.embed.images#view',
      images: [{
        thumb: `https://cdn.bsky.app/img/feed_thumbnail/plain/${ALICE}/bafkreiimg@jpeg`,
        fullsize: `https://cdn.bsky.app/img/feed_fullsize/plain/${ALICE}/bafkreiimg@jpeg`,
        alt: 'A test image',
        aspectRatio: { width: 4, height: 3 },
      }],
    },
    replyCount: 0, repostCount: 0, likeCount: 1, quoteCount: 0,
    indexedAt: CTS,
    viewer: { threadMuted: false, embeddingDisabled: false },
    labels: opts.labels ?? [],
  }
}

/** `getServices?detailed=true` for LABELER: one custom label, `spoiler`, set to warn. */
export const LABELER_SERVICE: AppBskyLabelerDefs.LabelerViewDetailed = {
  $type: 'app.bsky.labeler.defs#labelerViewDetailed',
  uri: `at://${LABELER}/app.bsky.labeler.service/self`,
  cid: 'bafyreilabeler',
  creator: { did: LABELER, handle: 'labeler.example.com', labels: [] } as AppBskyActorDefs.ProfileView,
  policies: {
    labelValues: ['spoiler', 'scam-strict'],
    labelValueDefinitions: [
      {
        identifier: 'spoiler',
        severity: 'inform',
        blurs: 'content',
        defaultSetting: 'warn',
        adultOnly: false,
        locales: [{ lang: 'en', name: 'Spoiler', description: 'Talks about a plot.' }],
      },
      {
        identifier: 'scam-strict',
        severity: 'alert',
        blurs: 'content',
        defaultSetting: 'hide',
        adultOnly: false,
        locales: [{ lang: 'en', name: 'Scam', description: 'A known scam.' }],
      },
    ],
  },
  likeCount: 0,
  indexedAt: CTS,
}
