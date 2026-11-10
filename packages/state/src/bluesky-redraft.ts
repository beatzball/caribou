// Bluesky delete and redraft (#190). Rules: README, "Bluesky delete and redraft".
// The rule: nothing can be lost after the delete. Everything that can fail
// (read, re-encode, upload, rkey, storage) happens before it.
import type { UserKey } from '@beatzball/caribou-auth'
import type {
  BlueskyBlobRef, BlueskyFacet, BlueskyPostRecord, BlueskyStrongRef, CaribouClient, Status,
} from '@beatzball/caribou-mastodon-client'
import { cacheStatus } from './caches.js'
import {
  draftRev, emptyDraft, isDraftEmpty, loadDraft, patchRevealed, renameDraftIf, revealDraftSlot, storeDraftIf, storedDrafts,
  type BlueskyDraftImage, type ComposeDraft, type DraftSlot,
} from './compose.js'
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

/**
 * A redraft stored for its account, before the delete, in a `staged:` slot
 * no composer opens. `redraftSlot` is where the delete's outcome moves it,
 * and where its image bytes are stored from the start.
 */
export interface StoredBlueskyRedraft {
  userKey: UserKey
  slot: DraftSlot
  redraftSlot: DraftSlot
  /** The staged slot's revision: only this one is removed or moved. */
  rev: string
  draft: ComposeDraft
}

/** The own record is not there: the post is already deleted. */
export class BlueskyRedraftGone extends Error {
  override name = 'BlueskyRedraftGone'
  constructor() {
    super('This post is already deleted.')
  }
}

/** The redraft would be empty: nothing in the post can be kept in a draft. */
export const NOTHING_KEPT = 'Nothing in this post can be kept in a draft. Use Delete.'

// The staged slots this tab is deleting for, so a check for slots left by
// a closed tab skips them.
const staging = new Set<string>()
const stagingKey = (userKey: UserKey, slot: DraftSlot) => `${userKey}\u0000${slot}`

/**
 * A staged draft a closed tab left, whose post is still up, is shown as a
 * normal redraft (with the "still up" note) once it is this old. Younger,
 * another tab may still be deleting for it.
 */
export const STAGED_MAX_AGE_MS = 24 * 60 * 60 * 1000

// Exposed (rule E): a draft the reader can see or has edited. Only its
// send or the reader removes it.
function exposed(slot: DraftSlot, d: ComposeDraft): boolean {
  return slot.startsWith('redraft:') || !!d.bluesky?.exposed
}

/**
 * The stored redraft made from the post `source` (a `redraft:` slot, or an
 * exposed `staged:` one), or null. The stored redraft wins: a new redraft
 * of the same post opens it instead (it may hold the reader's edits).
 */
export function findRedraftOf(userKey: UserKey, source: string): DraftSlot | null {
  for (const [slot, d] of storedDrafts(userKey)) {
    if (exposed(slot, d) && d.bluesky?.source === source && !isDraftEmpty(d)) return slot
  }
  return null
}

// Rule E, case 3: removes an unexposed staged copy (revision-checked) and
// the bytes under its final slot. Only a redraft's own flow calls this.
async function dropStaged(userKey: UserKey, slot: DraftSlot, rev: string): Promise<void> {
  const d = loadDraft(userKey, slot)
  if (!d || exposed(slot, d)) return
  const target: DraftSlot = `redraft:${slot.slice('staged:'.length)}`
  if (storeDraftIf(userKey, slot, rev, null) && !loadDraft(userKey, target)) await removeDraftFiles(userKey, target)
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

// Reads the post replied to or quoted, into the cache for the dialog. An
// answer after an account switch writes nothing.
async function checkTarget(
  client: CaribouClient, uri: string, flag: 'replyDisabled' | 'embeddingDisabled', generation: number,
): Promise<RedraftTarget> {
  try {
    const fresh = await client.fetchStatus(uri)
    if (generation !== ownerGeneration()) return 'unknown'
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
  if (!own) throw new BlueskyRedraftGone()
  // Same rkey in another repo is another post.
  if (own.uri !== uri || !isObject(own.value)) throw new Error('The post is not on your server.')
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
    reply ? checkTarget(client, reply.parent.uri, 'replyDisabled', generation) : null,
    quote ? checkTarget(client, quote.uri, 'embeddingDisabled', generation) : null,
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
 * False when the draft made from `source` would be empty: no text, no
 * image, no quote (a post that is only a link card, a video or a feed
 * card). Then a redraft would delete the post and keep nothing.
 */
export function redraftKeepsSomething(source: BlueskyRedraftSource): boolean {
  const { record, files } = source
  const { quote, images } = embedParts(record)
  const text = redraftTextOf(typeof record.text === 'string' ? record.text : '', record.facets)
  return text.trim() !== '' || !!quote
    || images.some((img) => { const ref = blobRef(img.image); return !!ref && files.has(ref.ref.$link) })
}

/**
 * Step 3: builds the draft, re-encodes and uploads each image, makes the
 * rkey, and stores the draft for the owner account in a new `staged:<key>`
 * slot, and the image bytes under `redraft:<key>`. All before any delete.
 * Throws when any step fails, or when the draft would be empty, leaving
 * nothing stored. Resolves null when the account changed (nothing stored
 * then either). `settleBlueskyRedraft` then follows the delete's outcome.
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
    bluesky: emptyBlueskyDraft({
      reply, quote, labels: redraftLabelsOf(record), images, rkey, source: source.status.bluesky?.uri ?? source.status.id,
      // Set now, so the rename after the delete only changes its value
      // (and needs no more storage).
      sourceMaybeLive: false, stagedAt: Date.now(),
    }),
  })
  if (isDraftEmpty(draft)) throw new Error(NOTHING_KEPT)
  const key = draft.idempotencyKey
  const userKey = client.userKey
  const slot: DraftSlot = `staged:${key}`
  const saved = storeDraftIf(userKey, slot, null, draft)
  if (!saved || saved.rev === null) throw new Error('Could not save the draft.')
  const stored: StoredBlueskyRedraft = { userKey, slot, redraftSlot: `redraft:${key}`, rev: saved.rev, draft }
  staging.add(stagingKey(userKey, slot))
  // A post with no images needs no IndexedDB.
  if (Object.keys(files).length > 0) {
    try {
      await putDraftFiles(userKey, stored.redraftSlot, files)
    } catch (err) {
      await discardBlueskyRedraft(stored)
      throw err
    }
  }
  if (stale()) {
    await discardBlueskyRedraft(stored)
    return null
  }
  return stored
}

/**
 * Removes a staged redraft and its image bytes: the post was not deleted.
 * Only while the slot still holds the staged revision, so nothing written
 * there since is erased.
 */
export async function discardBlueskyRedraft(stored: StoredBlueskyRedraft): Promise<void> {
  staging.delete(stagingKey(stored.userKey, stored.slot))
  const cleared = storeDraftIf(stored.userKey, stored.slot, stored.rev, null)
  if (cleared && !loadDraft(stored.userKey, stored.redraftSlot)) await removeDraftFiles(stored.userKey, stored.redraftSlot)
}

/**
 * Follows the delete's outcome. Deleted: other unexposed staged copies of
 * the same post that no flow of this tab runs (a closed tab's) go too, so
 * the text cannot come back a second time. Failed: the staged draft is removed
 * (`discardBlueskyRedraft`). Deleted or unknown: it is renamed to its
 * `redraft:<key>` slot in place, where a new post finds it; unknown marks
 * it `sourceMaybeLive`. When a redraft of the same post is stored already,
 * that one wins: the staged copy and its bytes go, and the stored one takes
 * the mark. Answers the slot that holds the draft now (the staged one,
 * found by a new post in this page, when the rename could not be written),
 * or null. When another tab's redraft of the same post removed this copy,
 * it answers that tab's redraft (`findRedraftOf`), so this tab can say
 * where the text is.
 */
export async function settleBlueskyRedraft(
  stored: StoredBlueskyRedraft, outcome: 'deleted' | 'failed' | 'unknown',
): Promise<DraftSlot | null> {
  if (outcome === 'failed') {
    await discardBlueskyRedraft(stored)
    return null
  }
  staging.delete(stagingKey(stored.userKey, stored.slot))
  const at = await promote(stored.userKey, stored.slot, outcome === 'unknown')
  const source = stored.draft.bluesky?.source
  if (outcome === 'deleted' && source) {
    for (const [slot, d] of storedDrafts(stored.userKey)) {
      if (slot === at || !slot.startsWith('staged:') || staging.has(stagingKey(stored.userKey, slot)) || d.bluesky?.source !== source) continue
      await dropStaged(stored.userKey, slot, d.rev ?? '')
    }
  }
  return at ?? (source ? findRedraftOf(stored.userKey, source) : null)
}

async function promote(userKey: UserKey, slot: DraftSlot, maybeLive: boolean): Promise<DraftSlot | null> {
  const target: DraftSlot = `redraft:${slot.slice('staged:'.length)}`
  const rev = draftRev(userKey, slot)
  const draft = loadDraft(userKey, slot)
  // Moved already (another tab).
  if (!draft || rev === null) return loadDraft(userKey, target) ? target : null
  const source = draft.bluesky?.source
  const kept = source ? findRedraftOf(userKey, source) : null
  if (kept && kept !== target) {
    // The stored redraft wins: it may hold the reader's edits. This copy
    // goes only while unexposed (rule E).
    await dropStaged(userKey, slot, rev)
    const held = loadDraft(userKey, kept)
    if (held?.bluesky && held.bluesky.sourceMaybeLive !== maybeLive) {
      storeDraftIf(userKey, kept, held.rev ?? '', { ...held, bluesky: { ...held.bluesky, sourceMaybeLive: maybeLive } })
    }
    return kept
  }
  const renamed = renameDraftIf(userKey, slot, rev, target, (d) => {
    const { stagedAt: _, ...b } = d.bluesky ?? emptyBlueskyDraft()
    return { ...d, bluesky: { ...b, sourceMaybeLive: maybeLive, exposed: true } }
  })
  if (renamed) return target
  // Storage refused even the rename: the staged slot stays, exposed, with
  // the outcome's mark, found by a new post; its bytes are under
  // `redraft:<key>` (`draftFilesSlot`).
  revealDraftSlot(userKey, slot, { sourceMaybeLive: maybeLive })
  return slot
}

/**
 * Staged redrafts this tab is not deleting for: a tab closed, or the page
 * reloaded, between the store and the delete's answer. For each, asks the
 * reader's PDS for the post: gone → the draft moves to `redraft:<key>`, as
 * after a delete (unless a redraft of that post is stored: it wins);
 * still there → it stays hidden (the post has the text) while younger
 * than `STAGED_MAX_AGE_MS`, then it moves too, marked `sourceMaybeLive`
 * (rule E: recovery promotes, it never removes). Answers the slots that
 * hold a found draft now. A read that fails, or an account switch, leaves
 * them for next time.
 */
export async function recoverStagedRedrafts(client: CaribouClient): Promise<DraftSlot[]> {
  const generation = ownerGeneration()
  const userKey = client.userKey
  const moved: DraftSlot[] = []
  for (const [slot, d] of storedDrafts(userKey)) {
    if (!slot.startsWith('staged:') || exposed(slot, d) || staging.has(stagingKey(userKey, slot))) continue
    const source = d.bluesky?.source
    if (!source || !client.blueskyGetOwnPost) continue
    let own: Awaited<ReturnType<NonNullable<CaribouClient['blueskyGetOwnPost']>>>
    try {
      own = await client.blueskyGetOwnPost(source.split('/').pop() ?? '')
    } catch {
      continue
    }
    if (generation !== ownerGeneration()) return moved
    // Another tab may have moved or removed it meanwhile.
    if (staging.has(stagingKey(userKey, slot))) continue
    // Still up and young: another tab may be deleting for it; ask again
    // next time. Still up and a day old: shown as a normal redraft, with
    // the "still up" note; the reader decides (rule E). Gone: moved.
    const stagedAt = d.bluesky?.stagedAt
    if (own && typeof stagedAt === 'number' && Date.now() - stagedAt <= STAGED_MAX_AGE_MS) continue
    const kept = source ? findRedraftOf(userKey, source) : null
    const at = await promote(userKey, slot, !!own)
    // A stored redraft that won is not news.
    if (at && !kept) moved.push(at)
  }
  return moved
}

/** Tests only: forget this tab's running flows, as another tab sees them. */
export function _testOnlyForgetStaging(): void {
  staging.clear()
}

/** True when the account has staged redrafts this tab is not deleting for. */
export function hasOrphanStagedRedrafts(userKey: UserKey): boolean {
  return storedDrafts(userKey).some(([slot, d]) => slot.startsWith('staged:') && !exposed(slot, d) && !staging.has(stagingKey(userKey, slot)))
}

/**
 * For a stored redraft marked `sourceMaybeLive`: asks the reader's PDS
 * whether its post is still up. True: it is. False: it is gone, and the
 * mark is cleared. Null: no answer, or there is nothing to check.
 */
export async function checkRedraftSource(client: CaribouClient, slot: DraftSlot): Promise<boolean | null> {
  const generation = ownerGeneration()
  const draft = loadDraft(client.userKey, slot)
  const source = draft?.bluesky?.source
  if (!draft?.bluesky?.sourceMaybeLive || !source || !client.blueskyGetOwnPost) return null
  let own: Awaited<ReturnType<NonNullable<CaribouClient['blueskyGetOwnPost']>>>
  try {
    own = await client.blueskyGetOwnPost(source.split('/').pop() ?? '')
  } catch {
    return null
  }
  if (generation !== ownerGeneration()) return null
  if (own && own.uri === source) return true
  patchRevealed(client.userKey, slot, { sourceMaybeLive: false })
  const now = loadDraft(client.userKey, slot)
  if (now?.bluesky) storeDraftIf(client.userKey, slot, now.rev ?? '', { ...now, bluesky: { ...now.bluesky, sourceMaybeLive: false } })
  return false
}
