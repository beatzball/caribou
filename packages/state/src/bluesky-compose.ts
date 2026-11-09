// Bluesky drafts and sending (#189, spec 7.2). Rules: README, "Bluesky drafts".
import type {
  BlueskyFacet, BlueskyPostRecord, CaribouClient, Status,
} from '@beatzball/caribou-mastodon-client'
import { cacheStatus } from './caches.js'
import {
  clearDraft, saveDraft,
  type BlueskyDraft, type ComposeDraft, type DraftSlot, type PostedDetail,
} from './compose.js'
import { activeUserKey } from './users.js'

/**
 * The self-label menu (spec 7.4), in menu order. Values from the
 * `com.atproto.label.defs` self-labels the SDK defines.
 */
export const BLUESKY_SELF_LABELS: readonly { value: string; label: string }[] = Object.freeze([
  { value: 'porn', label: 'Adult' },
  { value: 'nudity', label: 'Nudity' },
  { value: 'graphic-media', label: 'Graphic' },
])

export function emptyBlueskyDraft(init: Partial<BlueskyDraft> = {}): BlueskyDraft {
  return { reply: null, quote: null, labels: [], images: [], rkey: null, sent: null, ...init }
}

/** The labels the record carries: menu values only, in menu order, and only with images. */
function sentLabels(b: BlueskyDraft): string[] {
  if (b.images.length === 0) return []
  return BLUESKY_SELF_LABELS.map((l) => l.value).filter((v) => b.labels.includes(v))
}

/**
 * Everything the reader chose that goes into the record, as one string.
 * Two drafts with the same input make the same record, facets aside (they
 * come from the text).
 */
export function blueskyDraftInput(d: ComposeDraft): string {
  const b = d.bluesky ?? emptyBlueskyDraft()
  return JSON.stringify({
    text: d.text,
    language: d.language ?? null,
    reply: b.reply,
    quote: b.quote,
    labels: sentLabels(b),
    images: b.images.map((i) => ({ cid: i.blob.ref.$link, alt: i.alt, aspectRatio: i.aspectRatio })),
  })
}

/** The `app.bsky.feed.post` record a draft makes. */
export function blueskyRecord(d: ComposeDraft, facets: BlueskyFacet[], createdAt: string): BlueskyPostRecord {
  const b = d.bluesky ?? emptyBlueskyDraft()
  const images = b.images.length > 0 ? {
    $type: 'app.bsky.embed.images',
    images: b.images.map((i) => ({ image: i.blob, alt: i.alt, ...(i.aspectRatio ? { aspectRatio: i.aspectRatio } : {}) })),
  } : null
  const quote = b.quote ? { $type: 'app.bsky.embed.record', record: b.quote } : null
  const embed = quote && images
    ? { $type: 'app.bsky.embed.recordWithMedia', record: quote, media: images }
    : quote ?? images
  const labels = sentLabels(b)
  return {
    $type: 'app.bsky.feed.post',
    text: d.text,
    ...(facets.length > 0 ? { facets } : {}),
    ...(b.reply ? { reply: b.reply } : {}),
    ...(embed ? { embed } : {}),
    ...(labels.length > 0 ? { labels: { $type: 'com.atproto.label.defs#selfLabels', values: labels.map((val) => ({ val })) } } : {}),
    ...(d.language ? { langs: [d.language] } : {}),
    createdAt,
  }
}

export type BlueskyPostOutcome =
  /** The post is on the PDS. `status` is null when the AppView did not have it yet. */
  | { kind: 'posted'; uri: string; status: Status | null }
  /**
   * An earlier send went through, and the reader edited the draft since.
   * The edits stay in `draft`, with a new rkey, and nothing more was sent.
   */
  | { kind: 'earlier-posted'; uri: string; draft: ComposeDraft }

export interface PostBlueskyOptions {
  /** Waits between tries to read the new post (tests pass a no-op). */
  wait?: (ms: number) => Promise<void>
}

// The AppView can lag behind the PDS; a few tries before giving up on it.
const READ_TRIES = 3
const READ_WAIT_MS = 1000

function need<K extends keyof CaribouClient>(client: CaribouClient, name: K): NonNullable<CaribouClient[K]> {
  const fn = client[name]
  if (typeof fn !== 'function') throw new TypeError(`Not a Bluesky client: no ${String(name)}`)
  return (fn as (...a: unknown[]) => unknown).bind(client) as NonNullable<CaribouClient[K]>
}

/**
 * Sends a Bluesky draft, at most once (spec 7.2):
 *
 * 1. A draft with a `sent` record has a send whose outcome is unknown. Ask
 *    the PDS for that rkey first. Found, with no edits since: the post went
 *    through. Found, with edits: keep them with a new rkey and send nothing
 *    (`earlier-posted`). Not found: send again with the same rkey. A failed
 *    check sends nothing.
 * 2. Before a send, the rkey and the exact record are stored in the draft.
 * 3. Any error leaves the draft as stored, `sent` included, and is thrown.
 *
 * Posted: the draft is cleared. The post is read back, cached and announced
 * (`caribou:posted`) only while the client's account is still the active one.
 */
export async function postBlueskyDraft(
  client: CaribouClient, slot: DraftSlot, draft: ComposeDraft, opts: PostBlueskyOptions = {},
): Promise<BlueskyPostOutcome> {
  const getOwnPost = need(client, 'blueskyGetOwnPost')
  const createPost = need(client, 'blueskyCreatePost')
  const b = draft.bluesky ?? emptyBlueskyDraft()
  const input = blueskyDraftInput(draft)
  const pending = b.rkey && b.sent ? { rkey: b.rkey, sent: b.sent } : null

  if (pending) {
    const found = await getOwnPost(pending.rkey)
    if (found) {
      if (pending.sent.input === input) return posted(client, slot, found.uri, opts)
      const kept: ComposeDraft = {
        ...draft, bluesky: { ...b, rkey: await need(client, 'blueskyNextRkey')(), sent: null },
      }
      saveDraft(client.userKey, slot, kept)
      return { kind: 'earlier-posted', uri: found.uri, draft: kept }
    }
  }

  const rkey = b.rkey ?? await need(client, 'blueskyNextRkey')()
  // Not found and no edits: the same frozen record. Else a new one.
  const record = pending && pending.sent.input === input
    ? pending.sent.record
    : blueskyRecord(draft, await need(client, 'blueskyDetectFacets')(draft.text), new Date().toISOString())
  saveDraft(client.userKey, slot, { ...draft, bluesky: { ...b, rkey, sent: { input, record } } })
  const ref = await createPost(record, rkey)
  return posted(client, slot, ref.uri, opts)
}

async function posted(
  client: CaribouClient, slot: DraftSlot, uri: string, opts: PostBlueskyOptions,
): Promise<BlueskyPostOutcome> {
  clearDraft(client.userKey, slot)
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const stillActive = () => activeUserKey.peek() === client.userKey
  let status: Status | null = null
  for (let i = 0; i < READ_TRIES && stillActive(); i++) {
    if (i > 0) await wait(READ_WAIT_MS)
    try {
      status = await client.fetchStatus(uri)
      break
    } catch {
      status = null
    }
  }
  if (status && stillActive()) {
    cacheStatus(status)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<PostedDetail>('caribou:posted', { detail: { status } }))
    }
  }
  return { kind: 'posted', uri, status: stillActive() ? status : null }
}
