// Bluesky delete and redraft (#190). Rules: README, "Bluesky delete and redraft".
// The rule: nothing can be lost after the delete. Everything that can fail
// (read, re-encode, upload, rkey, storage) happens before it.
import type { UserKey } from '@beatzball/caribou-auth'
import type {
  BlueskyBlobRef, BlueskyFacet, BlueskyPostRecord, BlueskyStrongRef, CaribouClient, Status,
} from '@beatzball/caribou-mastodon-client'
import { cacheStatus } from './caches.js'
import { clearDraft, emptyDraft, storeDraftIf, type BlueskyDraftImage, type ComposeDraft, type DraftSlot } from './compose.js'
import { emptyBlueskyDraft } from './bluesky-compose.js'
import { putDraftFiles, removeDraftFiles } from './draft-files.js'
import { ownerGeneration } from './keep-alive.js'

/** What the read found about the post replied to or quoted. Null: there is none. */
export type RedraftTarget = 'ok' | 'gone' | 'limited' | 'unknown'

/** What a redraft read before anything else: the record, each image's bytes by CID, the targets. */
export interface BlueskyRedraftSource {
  status: Status
  record: BlueskyPostRecord
  files: Map<string, Blob>
  targets: { reply: RedraftTarget | null; quote: RedraftTarget | null }
  generation: number
}

/** An image made again through the canvas (the card's `fitImage`). */
export interface PreparedImage {
  blob: Blob
  width: number
  height: number
}

export interface StoreRedraftOptions {
  /** Re-encodes one image. Rejects or answers null when it cannot. */
  prepareImage: (bytes: Blob) => Promise<PreparedImage | null>
}

/** A redraft stored for its account, before the delete. */
export interface StoredBlueskyRedraft {
  userKey: UserKey
  slot: DraftSlot
  draft: ComposeDraft
}

interface RecordImage {
  image: unknown
  alt?: unknown
  aspectRatio?: unknown
}

const LINK = 'app.bsky.richtext.facet#link'
const POST_COLLECTION = 'app.bsky.feed.post'

function need<K extends keyof CaribouClient>(client: CaribouClient, name: K): NonNullable<CaribouClient[K]> {
  const fn = client[name]
  if (typeof fn !== 'function') throw new TypeError(`${String(name)} is Bluesky's`)
  return (fn as (...a: unknown[]) => unknown).bind(client) as NonNullable<CaribouClient[K]>
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

// A blob in a record read through the SDK has a CID object, in JSON a
// `{ $link }`; a very old record has `{ cid, mimeType }`.
function blobRef(b: unknown): BlueskyBlobRef | null {
  if (!isObject(b)) return null
  const ref = b.ref as { $link?: unknown; toString(): string } | undefined
  const link = isObject(ref) && typeof ref.$link === 'string' ? ref.$link
    : isObject(ref) ? ref.toString()
    : typeof b.cid === 'string' ? b.cid : ''
  if (!link || typeof b.mimeType !== 'string') return null
  return { $type: 'blob', ref: { $link: link }, mimeType: b.mimeType, size: typeof b.size === 'number' ? b.size : 0 }
}

function strongRef(r: unknown): BlueskyStrongRef | null {
  return isObject(r) && typeof r.uri === 'string' && typeof r.cid === 'string' ? { uri: r.uri, cid: r.cid } : null
}

// A quote only when the embedded record is a post. A feed, list, starter
// pack or labeler is a card, and is not kept.
function postRef(r: unknown): BlueskyStrongRef | null {
  const ref = strongRef(r)
  return ref && ref.uri.split('/')[3] === POST_COLLECTION ? ref : null
}

function embedParts(record: BlueskyPostRecord): { quote: BlueskyStrongRef | null; images: RecordImage[] } {
  const e = record.embed as unknown
  if (!isObject(e)) return { quote: null, images: [] }
  const imagesOf = (m: unknown): RecordImage[] => isObject(m) && m.$type === 'app.bsky.embed.images' && Array.isArray(m.images)
    ? m.images.filter(isObject) as unknown as RecordImage[] : []
  if (e.$type === 'app.bsky.embed.record') return { quote: postRef(e.record), images: [] }
  if (e.$type === 'app.bsky.embed.recordWithMedia') {
    return { quote: postRef(isObject(e.record) ? e.record.record : null), images: imagesOf(e.media) }
  }
  return { quote: null, images: imagesOf(e) }
}

function replyOf(record: BlueskyPostRecord): { root: BlueskyStrongRef; parent: BlueskyStrongRef } | null {
  const r = record.reply as unknown
  if (!isObject(r)) return null
  const root = strongRef(r.root)
  const parent = strongRef(r.parent)
  return root && parent ? { root, parent } : null
}

// Reads the post replied to or quoted, into the cache for the dialog.
async function checkTarget(client: CaribouClient, uri: string, flag: 'replyDisabled' | 'embeddingDisabled'): Promise<RedraftTarget> {
  try {
    const fresh = await client.fetchStatus(uri)
    cacheStatus(fresh)
    return fresh.bluesky?.[flag] ? 'limited' : 'ok'
  } catch (err) {
    return (err as { code?: unknown } | null)?.code === 'not_found' ? 'gone' : 'unknown'
  }
}

/**
 * Step 1: reads what a redraft needs, before anything else. The record from
 * the reader's PDS, each image's bytes (typed from the record), and the
 * targets. Throws when the record or an image cannot be read; resolves
 * null when the account changed.
 */
export async function readBlueskyRedraft(client: CaribouClient, status: Status): Promise<BlueskyRedraftSource | null> {
  const post = status.reblog ?? status
  const uri = post.bluesky?.uri ?? post.id
  const generation = ownerGeneration()
  const rkey = uri.split('/').pop() ?? ''
  const own = await need(client, 'blueskyGetOwnPost')(rkey)
  if (generation !== ownerGeneration()) return null
  // Same rkey in another repo is another post.
  if (!own || own.uri !== uri || !isObject(own.value)) throw new Error('The post is not on your server.')
  const record = own.value
  const files = new Map<string, Blob>()
  const { quote, images } = embedParts(record)
  for (const img of images) {
    const ref = blobRef(img.image)
    if (!ref || files.has(ref.ref.$link)) continue
    const bytes = await need(client, 'blueskyGetBlob')(ref.ref.$link)
    if (generation !== ownerGeneration()) return null
    // The record's type: a PDS may answer octet-stream.
    files.set(ref.ref.$link, new Blob([bytes], { type: ref.mimeType }))
  }
  const reply = replyOf(record)
  const [replyState, quoteState] = await Promise.all([
    reply ? checkTarget(client, reply.parent.uri, 'replyDisabled') : null,
    quote ? checkTarget(client, quote.uri, 'embeddingDisabled') : null,
  ])
  if (generation !== ownerGeneration()) return null
  return { status: post, record, files, targets: { reply: replyState, quote: quoteState }, generation }
}

/**
 * The text to redraft. Facets are made again from the text at send, so a
 * link whose shown text is not its URL (shortened by another app) gets its
 * URL back. A link the text makes again by itself stays as it is.
 */
export function redraftTextOf(text: string, facets: readonly BlueskyFacet[] | undefined): string {
  const bytes = new TextEncoder().encode(text)
  const dec = new TextDecoder()
  const links = (Array.isArray(facets) ? facets : [])
    .filter((f): f is BlueskyFacet => isObject(f) && isObject(f.index) && Array.isArray(f.features))
    .map((f) => ({ f, uri: f.features.find((x) => isObject(x) && x.$type === LINK)?.uri }))
    .filter((x): x is { f: BlueskyFacet; uri: string } => typeof x.uri === 'string')
    .filter(({ f }) => Number.isInteger(f.index.byteStart) && Number.isInteger(f.index.byteEnd)
      && f.index.byteStart >= 0 && f.index.byteStart < f.index.byteEnd && f.index.byteEnd <= bytes.length)
    .sort((a, b) => a.f.index.byteStart - b.f.index.byteStart)
  let out = ''
  let at = 0
  for (const { f, uri } of links) {
    if (f.index.byteStart < at) continue
    const shown = dec.decode(bytes.slice(f.index.byteStart, f.index.byteEnd))
    if (shown === uri || `https://${shown}` === uri) continue
    out += dec.decode(bytes.slice(at, f.index.byteStart)) + uri
    at = f.index.byteEnd
  }
  return out + dec.decode(bytes.slice(at))
}

/** The record's self-label values that are strings, once each. */
export function redraftLabelsOf(record: BlueskyPostRecord): string[] {
  const labels = record.labels as unknown
  const values = isObject(labels) && Array.isArray(labels.values) ? labels.values : []
  const out: string[] = []
  for (const v of values) {
    if (isObject(v) && typeof v.val === 'string' && v.val !== '' && !out.includes(v.val)) out.push(v.val)
  }
  return out
}

/**
 * Step 3: builds the draft, re-encodes and uploads each image, makes the
 * rkey, and stores the draft and the image bytes for the owner account, in
 * a new `redraft:<key>` slot. All before any delete. Throws when any step
 * fails, leaving nothing stored. Resolves null when the account changed
 * (nothing stored then either).
 */
export async function storeBlueskyRedraft(
  client: CaribouClient, source: BlueskyRedraftSource, opts: StoreRedraftOptions,
): Promise<StoredBlueskyRedraft | null> {
  const { record, generation } = source
  const stale = () => generation !== ownerGeneration()
  if (stale()) return null
  const { quote, images: recordImages } = embedParts(record)
  const images: BlueskyDraftImage[] = []
  const files: Record<string, Blob> = {}
  for (const img of recordImages) {
    const old = blobRef(img.image)
    const bytes = old ? source.files.get(old.ref.$link) : undefined
    if (!old || !bytes) continue
    // A new encoding gives a new CID, so the delete cannot take the blob
    // with the old record.
    // A failure after an account switch is that account's no more: null.
    let fit: PreparedImage | null
    let blob: BlueskyBlobRef
    try {
      fit = await opts.prepareImage(bytes)
      if (stale()) return null
      if (!fit) throw new Error('An image could not be prepared.')
      blob = await need(client, 'blueskyUploadBlob')(fit.blob)
    } catch (err) {
      if (stale()) return null
      throw err
    }
    if (stale()) return null
    const id = globalThis.crypto.randomUUID()
    const ar = isObject(img.aspectRatio) ? img.aspectRatio : null
    const w = ar?.width
    const h = ar?.height
    images.push({
      id, blob, mime: blob.mimeType, size: blob.size,
      alt: typeof img.alt === 'string' ? img.alt : '',
      aspectRatio: typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0
        ? { width: w, height: h }
        : fit.width > 0 && fit.height > 0 ? { width: fit.width, height: fit.height } : null,
    })
    files[id] = fit.blob
  }
  let rkey: string
  try {
    rkey = await need(client, 'blueskyNextRkey')()
  } catch (err) {
    if (stale()) return null
    throw err
  }
  if (stale()) return null
  const reply = replyOf(record)
  const langs = Array.isArray(record.langs) ? record.langs : []
  const language = langs.find((l): l is string => typeof l === 'string' && l !== '') ?? null
  const draft = emptyDraft({
    text: redraftTextOf(typeof record.text === 'string' ? record.text : '', record.facets),
    inReplyToId: reply?.parent.uri ?? null,
    language,
    // A new record with a new rkey (R6), stored with the first save.
    bluesky: emptyBlueskyDraft({ reply, quote, labels: redraftLabelsOf(record), images, rkey }),
  })
  const stored: StoredBlueskyRedraft = { userKey: client.userKey, slot: `redraft:${draft.idempotencyKey}`, draft }
  if (!storeDraftIf(stored.userKey, stored.slot, null, draft)) throw new Error('Could not save the draft.')
  try {
    await putDraftFiles(stored.userKey, stored.slot, files)
  } catch (err) {
    clearDraft(stored.userKey, stored.slot)
    throw err
  }
  if (stale()) {
    await discardBlueskyRedraft(stored)
    return null
  }
  return stored
}

/** Removes a stored redraft and its image bytes: the post was not deleted. */
export async function discardBlueskyRedraft(stored: StoredBlueskyRedraft): Promise<void> {
  clearDraft(stored.userKey, stored.slot)
  await removeDraftFiles(stored.userKey, stored.slot)
}
