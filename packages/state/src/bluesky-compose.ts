// Bluesky drafts and sending (#189, spec 7.2). Rules: README, "Bluesky drafts".
import type {
  BlueskyFacet, BlueskyPostRecord, CaribouClient, Status,
} from '@beatzball/caribou-mastodon-client'
import { cacheStatus } from './caches.js'
import {
  draftRev, loadDraft, storeDraftIf,
  type BlueskyDraft, type BlueskySentRecord, type ComposeDraft, type DraftSlot, type PostedDetail,
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
   * Hears every draft the send makes (R3): the frozen one before the
   * network, the unfrozen one after a refused freeze or a create the check
   * found absent, the kept edits after `earlier-posted`. The open dialog
   * takes it as its own draft.
   */
  onDraft?: (draft: ComposeDraft) => void
}

/**
 * Storage refused the frozen draft (R3), so nothing was sent: without it, a
 * reload could post twice.
 */
export class DraftNotSaved extends Error {
  constructor() {
    super('Could not save the draft, so the post was not sent.')
    this.name = 'DraftNotSaved'
  }
}

/**
 * Another save came into the slot while the send was getting ready (R4).
 * Nothing was frozen or sent; the newer draft stays.
 */
export class DraftChanged extends Error {
  constructor() {
    super('The draft changed while it was being sent, so nothing was sent.')
    this.name = 'DraftChanged'
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

/** The record on the PDS is the one this send froze (R1). */
function sameRecord(a: BlueskyPostRecord, b: BlueskyPostRecord): boolean {
  return a.createdAt === b.createdAt && a.text === b.text
}

/**
 * Sends a Bluesky draft, at most once. The rules (R1 to R5) are in the
 * README, "One post per click".
 */
export async function postBlueskyDraft(
  client: CaribouClient, slot: DraftSlot, draft: ComposeDraft, opts: PostBlueskyOptions = {},
): Promise<BlueskyPostOutcome> {
  const getOwnPost = need(client, 'blueskyGetOwnPost')
  const createPost = need(client, 'blueskyCreatePost')
  const nextRkey = need(client, 'blueskyNextRkey')
  const userKey = client.userKey
  const b = draft.bluesky ?? emptyBlueskyDraft()
  const input = blueskyDraftInput(draft)
  // R4: the revision this send owns. Every write is conditional on it.
  let rev = draftRev(userKey, slot)
  const stillOwned = () => {
    if (draftRev(userKey, slot) !== rev) throw new DraftChanged()
  }
  const write = (next: ComposeDraft | null): boolean => {
    const out = storeDraftIf(userKey, slot, rev, next)
    if (out === false) return false
    rev = out.rev
    return true
  }
  // The found record decides (R1). Edits, or another record, keep the
  // reader's current draft with a new rkey.
  const settle = async (found: { uri: string; value: BlueskyPostRecord }, sent: BlueskySentRecord): Promise<BlueskyPostOutcome> => {
    if (sameRecord(found.value, sent.record) && input === sent.input) {
      write(null)
      return posted(client, found.uri, opts)
    }
    const kept: ComposeDraft = { ...draft, bluesky: { ...b, rkey: await nextRkey(), sent: null } }
    write(kept)
    opts.onDraft?.(kept)
    return { kind: 'earlier-posted', uri: found.uri, draft: kept }
  }

  // R2: a pending send is checked first. A failed check throws: nothing sent.
  let reuse: BlueskySentRecord | null = null
  if (b.rkey && b.sent) {
    const found = await getOwnPost(b.rkey)
    if (found) return settle(found, b.sent)
    stillOwned()
    // Absent: the rkey is unused. Unchanged, the frozen record goes again
    // as it is; edited, the current draft is frozen on the same rkey.
    if (b.sent.input === input) reuse = b.sent
  }

  const rkey = b.rkey ?? await nextRkey()
  stillOwned()
  let sent: BlueskySentRecord = reuse ?? { input, record: blueskyRecord(draft, [], '') }
  if (!reuse) {
    const facets = await need(client, 'blueskyDetectFacets')(draft.text)
    stillOwned()
    sent = { input, record: blueskyRecord(draft, facets, new Date().toISOString()) }
  }
  const frozen: ComposeDraft = { ...draft, bluesky: { ...b, rkey, sent } }
  const unfrozen: ComposeDraft = { ...draft, bluesky: { ...b, rkey, sent: null } }

  // R3: durable before the network, read back to confirm.
  if (!write(frozen) || loadDraft(userKey, slot)?.bluesky?.sent?.record.createdAt !== sent.record.createdAt) {
    opts.onDraft?.(unfrozen)
    throw new DraftNotSaved()
  }
  opts.onDraft?.(frozen)

  let ref
  try {
    ref = await createPost(sent.record, rkey)
  } catch (err) {
    // R1: only the check decides. A failed check leaves the send pending.
    let found
    try {
      found = await getOwnPost(rkey)
    } catch {
      throw err
    }
    if (found) return settle(found, sent)
    // Absent: the rkey is unused. Unfreeze, keeping the current draft.
    write(unfrozen)
    opts.onDraft?.(unfrozen)
    throw err
  }
  return settle({ uri: ref.uri, value: sent.record }, sent)
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
