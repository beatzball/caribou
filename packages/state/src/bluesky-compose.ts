// Bluesky drafts and sending (#189, spec 7.2). Rules: README, "Bluesky drafts".
import type {
  BlueskyFacet, BlueskyPostRecord, CaribouClient, Status,
} from '@beatzball/caribou-mastodon-client'
import { cacheStatus } from './caches.js'
import {
  draftRev, loadDraft, storeDraftIf,
  type BlueskyDraft, type BlueskySentRecord, type ComposeDraft, type DraftSlot, type PostedDetail,
} from './compose.js'
import { blueskySentGates, sameBlueskyGates } from './bluesky-gates.js'
import { activeUserKey } from './users.js'

/**
 * The self-label menu (spec 7.4), in menu order. Values from the
 * `com.atproto.label.defs` self-labels the SDK defines.
 */
export const BLUESKY_SELF_LABELS: readonly { value: string; label: string }[] = Object.freeze([
  { value: 'porn', label: 'Adult' },
  { value: 'sexual', label: 'Suggestive' },
  { value: 'nudity', label: 'Nudity' },
  { value: 'graphic-media', label: 'Graphic' },
])

export function emptyBlueskyDraft(init: Partial<BlueskyDraft> = {}): BlueskyDraft {
  return { reply: null, quote: null, labels: [], images: [], rkey: null, sent: null, ...init }
}

/**
 * The labels the record carries: the menu's values in menu order, only
 * with images (they label media), then any other value a redraft carried,
 * as it is (#190).
 */
function sentLabels(b: BlueskyDraft): string[] {
  const menu = BLUESKY_SELF_LABELS.map((l) => l.value)
  const other = b.labels.filter((v, i) => !menu.includes(v) && b.labels.indexOf(v) === i)
  return [...(b.images.length > 0 ? menu.filter((v) => b.labels.includes(v)) : []), ...other]
}

/**
 * Everything the reader chose that goes into the record, as one string.
 * Two drafts with the same input make the same record, facets aside (they
 * come from the text).
 */
export function blueskyDraftInput(d: ComposeDraft): string {
  const b = d.bluesky ?? emptyBlueskyDraft()
  // G2: no `gates` key without a limit, so the string is as before #199.
  const gates = blueskySentGates(b)
  return JSON.stringify({
    text: d.text,
    language: d.language ?? null,
    reply: b.reply,
    quote: b.quote,
    labels: sentLabels(b),
    images: b.images.map((i) => ({ cid: i.blob.ref.$link, alt: i.alt, aspectRatio: i.aspectRatio })),
    ...(gates ? { gates } : {}),
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

/** A blob's CID, from the JSON form (`{ $link }`) or the SDK's CID object. */
function cidOf(blob: unknown): string {
  const ref = (blob as { ref?: unknown } | null)?.ref as { $link?: unknown } | undefined
  if (!ref) return ''
  return typeof ref.$link === 'string' ? ref.$link : String(ref)
}

function strongRef(r: unknown): string {
  const x = r as { uri?: unknown; cid?: unknown } | null | undefined
  return x ? `${String(x.uri)} ${String(x.cid)}` : ''
}

/**
 * A record's content, field by field (R7): text, reply and quote refs, image
 * CIDs and alt text, self-labels, langs. Not facets: a mention's facet
 * depends on whether its lookup worked, and facets come from the text. Never
 * `createdAt`, and never a deep compare: `getRecord` gives SDK `BlobRef`s.
 */
function contentOf(r: BlueskyPostRecord): string {
  const embed = r.embed as {
    $type?: string; images?: { image?: unknown; alt?: unknown }[]
    record?: { record?: unknown } & Record<string, unknown>; media?: { images?: { image?: unknown; alt?: unknown }[] }
  } | undefined
  const images = embed?.images ?? embed?.media?.images ?? []
  const quote = embed?.$type === 'app.bsky.embed.record' ? embed.record
    : embed?.$type === 'app.bsky.embed.recordWithMedia' ? embed.record?.record : null
  return JSON.stringify({
    text: r.text,
    reply: r.reply ? [strongRef(r.reply.root), strongRef(r.reply.parent)] : null,
    quote: quote ? strongRef(quote) : null,
    images: images.map((i) => [cidOf(i.image), String(i.alt ?? '')]),
    labels: (r.labels?.values ?? []).map((l) => l.val),
    langs: r.langs ?? [],
  })
}

/** The record found at the rkey is this send's post (R7). */
function sameContent(found: BlueskyPostRecord, sent: BlueskyPostRecord): boolean {
  return contentOf(found) === contentOf(sent)
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
  // R6: the draft has carried its rkey since it was made.
  if (!b.rkey) throw new TypeError('A Bluesky draft has its rkey from the start (README, R6)')
  const rkey = b.rkey
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
  // reader's current draft with a new rkey. `checked`: found by the check,
  // not answered by this send's own create. Then the gate records are read
  // too (G4): an earlier send on this rkey may have had other limits, and
  // the post record alone cannot tell. A failed read throws: still pending.
  const settle = async (
    found: { uri: string; value: BlueskyPostRecord }, sent: BlueskySentRecord, checked: boolean,
  ): Promise<BlueskyPostOutcome> => {
    if (sameContent(found.value, sent.record) && input === sent.input
      && (!checked || sameBlueskyGates(await need(client, 'blueskyGetOwnGates')(rkey), sent.gates))) {
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
  if (b.sent) {
    const found = await getOwnPost(rkey)
    if (found) return settle(found, b.sent, true)
    stillOwned()
    // Absent: the rkey is unused. Unchanged, the frozen record goes again
    // as it is; edited, the current draft is frozen on the same rkey.
    if (b.sent.input === input) reuse = b.sent
  }

  // G4: the limits are frozen with the record.
  const gates = blueskySentGates(b)
  let sent: BlueskySentRecord = reuse ?? { input, record: blueskyRecord(draft, [], '') }
  if (!reuse) {
    const facets = await need(client, 'blueskyDetectFacets')(draft.text)
    stillOwned()
    sent = { input, record: blueskyRecord(draft, facets, new Date().toISOString()), ...(gates ? { gates } : {}) }
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
    // G2, G3: no limits is the post alone; limits go in the same call.
    ref = sent.gates ? await createPost(sent.record, rkey, sent.gates) : await createPost(sent.record, rkey)
  } catch (err) {
    // R1: only the check decides. A failed check leaves the send pending.
    let found
    try {
      found = await getOwnPost(rkey)
    } catch {
      throw err
    }
    if (found) {
      try {
        return await settle(found, sent, true)
      } catch {
        // The gate read failed: unknown, still pending (R1).
        throw err
      }
    }
    // Absent: the rkey is unused. Unfreeze, keeping the current draft.
    write(unfrozen)
    opts.onDraft?.(unfrozen)
    throw err
  }
  return settle({ uri: ref.uri, value: sent.record }, sent, false)
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
