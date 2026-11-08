// Shared setup for the Bluesky view tests (#184). Posts go through the real
// pipeline: AppView JSON → `createBlueskyClient` (real mappers) → the real
// `moderate()` with the reader's prefs → a JSON round trip, as page data
// would → the rendered component. A test that rendered straight from an SDK
// decision would miss what JSON drops (spec 7.4).
import { vi } from 'vitest'
import type { CaribouClient, Status } from '@beatzball/caribou-mastodon-client'
import { createBlueskyClient, type BlueskyAgent } from '@beatzball/caribou-bluesky-client/browser'
import {
  LOGGED_OUT_PREFS, labelDefsFromServices, moderate, type BlueskyReader, type LabelDefs,
} from '@beatzball/caribou-bluesky-client/moderation'
import { mapPost } from '@beatzball/caribou-bluesky-client'
import { addUserSession } from '@beatzball/caribou-state'
import {
  BSKY_LABELER, BSKY_SERVICE, LABELER, LABELER_SERVICE,
} from '../../../../packages/bluesky-client/src/__fixtures__/moderation.js'
import { setBlueskyReader } from '../_bluesky-moderation.js'
import { blueskyClients } from './_bluesky-clients.js'

export {
  ALICE, BOB, BSKY_LABELER, CAROL, LABELER, author, label, post, quoting,
} from '../../../../packages/bluesky-client/src/__fixtures__/moderation.js'

/** The signed-in reader. Placeholder DID. */
export const READER_DID = 'did:plc:reader'
export const READER_KEY = `${READER_DID}@bsky` as const

type Prefs = NonNullable<Parameters<typeof moderate>[2]>

/** The reader's prefs: adult content off, Bluesky's labeler and LABELER. */
export function prefs(over: Partial<Prefs> = {}): Prefs {
  return {
    adultContentEnabled: false,
    labels: {},
    labelers: [{ did: BSKY_LABELER, labels: {} }, { did: LABELER, labels: {} }],
    mutedWords: [],
    hiddenPosts: [],
    ...over,
  }
}

export const DEFS: LabelDefs = labelDefsFromServices([LABELER_SERVICE, BSKY_SERVICE])

export interface ModerationOptions {
  /** `null`: prefs failed to load. */
  prefs?: Prefs | null
  /** `null`: label definitions failed to load. */
  defs?: LabelDefs | null
  /** What the AppView said it covered (`atproto-content-labelers`). */
  covered?: string[]
}

/** The moderation source a reader fetch maps with: the real `moderate()`. */
export function moderationSource(o: ModerationOptions = {}) {
  const p = o.prefs === undefined ? prefs() : o.prefs
  const d = o.defs === undefined ? DEFS : o.defs
  const labelersCovered = o.covered ?? [BSKY_LABELER, LABELER]
  return {
    post: (view: never) => moderate({ kind: 'post', view }, READER_DID, p, d, { labelersCovered }),
    profile: (view: never) => moderate({ kind: 'profile', view }, READER_DID, p, d, { labelersCovered }),
  }
}

/** A fake signed-in agent: every read is a `vi.fn`, overridable. */
export function fakeAgent(over: Record<string, unknown> = {}) {
  return {
    did: READER_DID,
    getTimeline: vi.fn(),
    getAuthorFeed: vi.fn(),
    getPostThread: vi.fn(),
    getPosts: vi.fn(),
    getProfile: vi.fn(),
    getProfiles: vi.fn(async () => ({ data: { profiles: [] } })),
    app: { bsky: { bookmark: { getBookmarks: vi.fn() }, graph: { getMutes: vi.fn(), getBlocks: vi.fn() } } },
    ...over,
  }
}

export type FakeAgent = ReturnType<typeof fakeAgent>

export function blueskyClient(agent: FakeAgent, mod: ModerationOptions = {}): CaribouClient {
  return createBlueskyClient({
    userKey: READER_KEY,
    agent: agent as unknown as BlueskyAgent,
    moderation: moderationSource(mod) as never,
  })
}

/**
 * Makes `client` the active account's client. The test file must mock
 * `createCaribouClient` to answer from `blueskyClients` (see
 * `_bluesky-clients.ts`). `reader` is what the session glue would hand the
 * veil; `null` leaves the veil without a reader.
 */
export function signInBluesky(client: CaribouClient, reader: BlueskyReader | null = readerOf()): void {
  blueskyClients.set(READER_KEY, client)
  addUserSession({
    userKey: READER_KEY, server: 'bsky.social', token: '', vapidKey: '', account: null, createdAt: 0,
  })
  setBlueskyReader(reader)
}

/** The reader the veil checks against, by default with every labeler's definitions. */
export function readerOf(o: { prefs?: Prefs | null; defs?: LabelDefs | null } = {}): BlueskyReader {
  return {
    userKey: READER_KEY,
    prefs: o.prefs === undefined ? prefs() : o.prefs,
    labelDefs: o.defs === undefined ? DEFS : o.defs,
  }
}

/** A post view as the AppView sends it, with the `$type` `getPosts` items carry. */
export function asPostView<T extends object>(view: T): T {
  return { $type: 'app.bsky.feed.defs#postView', ...view }
}

/**
 * One post through the real client (`getPosts` → mapper → moderation), then
 * through JSON, as page data reaches the client.
 */
export async function mappedPost(view: object, mod: ModerationOptions = {}): Promise<Status> {
  const agent = fakeAgent({ getPosts: vi.fn(async () => ({ data: { posts: [asPostView(view)] } })) })
  const status = await blueskyClient(agent, mod).fetchStatus((view as { uri: string }).uri)
  return JSON.parse(JSON.stringify(status)) as Status
}

/**
 * One post as a signed-out reader gets it (the server's copy): mapped with
 * no viewer and moderated with the logged-out defaults, then through JSON.
 */
export function publicPost(view: object): Status {
  const status = mapPost(asPostView(view) as never, {
    viewerOf: null,
    moderatePost: (v) => moderate({ kind: 'post', view: v }, undefined, LOGGED_OUT_PREFS, DEFS, { labelersCovered: [BSKY_LABELER] }),
  })
  return JSON.parse(JSON.stringify(status)) as Status
}
