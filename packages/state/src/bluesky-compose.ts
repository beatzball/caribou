// Bluesky drafts and sending (#189, spec 7.2). Rules: README, "Bluesky drafts".
import type {
  BlueskyFacet, BlueskyPostRecord, CaribouClient, Status,
} from '@beatzball/caribou-mastodon-client'
import { cacheStatus } from './caches.js'
import {
  clearDraft, loadDraft, saveDraft, storeDraft,
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
  /**
   * Hears every draft the send makes (rule 2): the frozen one before the
   * network, the unfrozen one after a blob refusal, the kept edits after
   * `earlier-posted`. The open dialog takes it as its own draft.
   */
  onDraft?: (draft: ComposeDraft) => void
}

/**
 * Storage refused the draft with its rkey and frozen record (rule 2), so
 * nothing was sent: without it, a reload could post twice.
 */
export class DraftNotSaved extends Error {
  constructor() {
    super('Could not save the draft, so the post was not sent.')
    this.name = 'DraftNotSaved'
  }
}

// The AppView can lag behind the PDS; a few tries before giving up on it.
const READ_TRIES = 3
const READ_WAIT_MS = 1000

function need<K extends keyof CaribouClient>(client: CaribouClient, name: K): NonNullable<CaribouClient[K]> {
  const fn = client[name]
  if (typeof fn !== 'function') throw new TypeError(`Not a Bluesky client: no ${String(name)}`)
  return (fn as (...a: unknown[]) => unknown).bind(client) as NonNullable<CaribouClient[K]>
}

/** The client's `BlueskyBlobNotFound`, by name: this package does not import the client. */
function isBlobRefused(err: unknown): boolean {
  return err instanceof Error && err.name === 'BlueskyBlobNotFound'
}

/** The record on the PDS is the one this send froze (rule 1). */
function sameRecord(a: BlueskyPostRecord, b: BlueskyPostRecord): boolean {
  return a.createdAt === b.createdAt && a.text === b.text
}

/**
 * Sends a Bluesky draft, at most once. The four rules are in the README,
 * "One post per click". In short: an rkey carries one frozen record until
 * it is resolved; the frozen draft is in memory and storage before the
 * network; a send clears only the stored draft it owns; and only
 * `RecordNotFound` means "not there".
 */
export async function postBlueskyDraft(
  client: CaribouClient, slot: DraftSlot, draft: ComposeDraft, opts: PostBlueskyOptions = {},
): Promise<BlueskyPostOutcome> {
  const getOwnPost = need(client, 'blueskyGetOwnPost')
  const createPost = need(client, 'blueskyCreatePost')
  const b = draft.bluesky ?? emptyBlueskyDraft()
  const input = blueskyDraftInput(draft)

  // Rule 1: a pending rkey is resolved with its own record, never another.
  if (b.rkey && b.sent) {
    const rkey = b.rkey
    const sent = b.sent
    let found = await getOwnPost(rkey)
    if (!found) {
      // Rule 2: the pending draft is stored before the network too, unless
      // the slot now holds a draft this send does not own.
      const stored = loadDraft(client.userKey, slot)
      if ((!stored || ownsStored(stored, rkey, sent)) && !storeDraft(client.userKey, slot, stored ?? draft)) {
        throw new DraftNotSaved()
      }
      const ref = await createPost(sent.record, rkey)
      found = { uri: ref.uri, cid: ref.cid, value: sent.record }
    }
    return resolved(client, slot, draft, rkey, sent, found.uri, sameRecord(found.value, sent.record) && input === sent.input, opts)
  }

  const rkey = b.rkey ?? await need(client, 'blueskyNextRkey')()
  const record = blueskyRecord(draft, await need(client, 'blueskyDetectFacets')(draft.text), new Date().toISOString())
  const sent = { input, record }
  const frozen: ComposeDraft = { ...draft, bluesky: { ...b, rkey, sent } }
  // Rule 2: memory, then storage, then the network.
  opts.onDraft?.(frozen)
  if (!storeDraft(client.userKey, slot, frozen)) throw new DraftNotSaved()
  let ref
  try {
    ref = await createPost(record, rkey)
  } catch (err) {
    if (isBlobRefused(err)) {
      // The PDS refused this exact record: the rkey is unused (README).
      const open: ComposeDraft = { ...frozen, bluesky: { ...frozen.bluesky!, sent: null } }
      opts.onDraft?.(open)
      settleStored(client, slot, rkey, sent, open)
    }
    throw err
  }
  return resolved(client, slot, frozen, rkey, sent, ref.uri, true, opts)
}

type Sent = { input: string; record: BlueskyPostRecord }

/** Rule 3: the stored draft is still this send's (same rkey and frozen record). */
function ownsStored(stored: ComposeDraft | null, rkey: string, sent: Sent): stored is ComposeDraft {
  const sb = stored?.bluesky
  return !!sb && sb.rkey === rkey && !!sb.sent && sameRecord(sb.sent.record, sent.record)
}

/** Replaces the stored draft only while this send owns it (rule 3). */
function settleStored(client: CaribouClient, slot: DraftSlot, rkey: string, sent: Sent, next: ComposeDraft): void {
  if (ownsStored(loadDraft(client.userKey, slot), rkey, sent)) saveDraft(client.userKey, slot, next)
}

/**
 * The rkey holds a post now. `unchanged`: it is the frozen record and the
 * caller's draft has no edits since the freeze. Edits, in the caller's
 * draft or in the stored one, are kept with a new rkey.
 */
async function resolved(
  client: CaribouClient, slot: DraftSlot, draft: ComposeDraft, rkey: string,
  sent: Sent, uri: string, unchanged: boolean, opts: PostBlueskyOptions,
): Promise<BlueskyPostOutcome> {
  let fresh: string | null = null
  const freshRkey = async () => (fresh ??= await need(client, 'blueskyNextRkey')())
  const reopen = async (d: ComposeDraft): Promise<ComposeDraft> =>
    ({ ...d, bluesky: { ...(d.bluesky ?? emptyBlueskyDraft()), rkey: await freshRkey(), sent: null } })

  const stored = loadDraft(client.userKey, slot)
  if (ownsStored(stored, rkey, sent)) {
    if (blueskyDraftInput(stored) === sent.input && unchanged) clearDraft(client.userKey, slot)
    else saveDraft(client.userKey, slot, await reopen(blueskyDraftInput(stored) === sent.input ? draft : stored))
  }
  if (!unchanged) {
    const kept = await reopen(draft)
    // An empty slot takes the edits; another draft in it is left alone.
    if (!loadDraft(client.userKey, slot)) saveDraft(client.userKey, slot, kept)
    opts.onDraft?.(kept)
    return { kind: 'earlier-posted', uri, draft: kept }
  }
  return posted(client, uri, opts)
}

async function posted(client: CaribouClient, uri: string, opts: PostBlueskyOptions): Promise<BlueskyPostOutcome> {
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
