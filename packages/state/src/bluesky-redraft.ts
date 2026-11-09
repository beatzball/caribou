// Bluesky delete and redraft (#190). Rules: README, "Bluesky delete and redraft".
import type {
  BlueskyBlobRef, BlueskyFacet, BlueskyPostRecord, BlueskyStrongRef, CaribouClient, Status,
} from '@beatzball/caribou-mastodon-client'
import { emptyDraft, type BlueskyDraftImage, type ComposeDraft } from './compose.js'
import { BLUESKY_SELF_LABELS, emptyBlueskyDraft } from './bluesky-compose.js'
import { ownerGeneration } from './keep-alive.js'

/** What a redraft read before the delete: the record and each image's bytes, by CID. */
export interface BlueskyRedraftSource {
  status: Status
  record: BlueskyPostRecord
  files: Map<string, Blob>
  generation: number
}

/** The new draft, and the bytes of each of its images by image id (for the dialog). */
export interface BlueskyRedraft {
  draft: ComposeDraft
  files: Record<string, Blob>
}

interface RecordImage {
  image: unknown
  alt?: unknown
  aspectRatio?: { width?: unknown; height?: unknown }
}

const LINK = 'app.bsky.richtext.facet#link'

function need<K extends keyof CaribouClient>(client: CaribouClient, name: K): NonNullable<CaribouClient[K]> {
  const fn = client[name]
  if (typeof fn !== 'function') throw new TypeError(`${String(name)} is Bluesky's`)
  return (fn as (...a: unknown[]) => unknown).bind(client) as NonNullable<CaribouClient[K]>
}

// A blob in a record read through the SDK has a CID object, in JSON a
// `{ $link }`; a very old record has `{ cid, mimeType }`.
function blobRef(b: unknown): BlueskyBlobRef | null {
  const o = b as { ref?: { $link?: unknown; toString(): string }; cid?: unknown; mimeType?: unknown; size?: unknown } | null
  if (!o || typeof o !== 'object') return null
  const link = typeof o.ref?.$link === 'string' ? o.ref.$link
    : o.ref ? o.ref.toString()
    : typeof o.cid === 'string' ? o.cid : ''
  if (!link || typeof o.mimeType !== 'string') return null
  return { $type: 'blob', ref: { $link: link }, mimeType: o.mimeType, size: typeof o.size === 'number' ? o.size : 0 }
}

function strongRef(r: unknown): BlueskyStrongRef | null {
  const o = r as { uri?: unknown; cid?: unknown } | null
  return o && typeof o.uri === 'string' && typeof o.cid === 'string' ? { uri: o.uri, cid: o.cid } : null
}

type Embed = { $type?: string; images?: RecordImage[]; record?: unknown; media?: Embed }

function embedParts(record: BlueskyPostRecord): { quote: BlueskyStrongRef | null; images: RecordImage[] } {
  const e = record.embed as Embed | undefined
  if (!e) return { quote: null, images: [] }
  const imagesOf = (m: Embed | undefined) => m?.$type === 'app.bsky.embed.images' && Array.isArray(m.images) ? m.images : []
  if (e.$type === 'app.bsky.embed.record') return { quote: strongRef(e.record), images: [] }
  if (e.$type === 'app.bsky.embed.recordWithMedia') {
    return { quote: strongRef((e.record as { record?: unknown } | undefined)?.record), images: imagesOf(e.media) }
  }
  return { quote: null, images: imagesOf(e) }
}

/**
 * Reads what a redraft needs, before anything is deleted: the record from
 * the reader's PDS and each image's bytes. Throws when any of it fails or
 * the record is not there; resolves null when the account changed.
 */
export async function readBlueskyRedraft(client: CaribouClient, status: Status): Promise<BlueskyRedraftSource | null> {
  const post = status.reblog ?? status
  const uri = post.bluesky?.uri ?? post.id
  const generation = ownerGeneration()
  const rkey = uri.split('/').pop() ?? ''
  const own = await need(client, 'blueskyGetOwnPost')(rkey)
  if (generation !== ownerGeneration()) return null
  // Same rkey in another repo is another post.
  if (!own || own.uri !== uri) throw new Error('The post is not on your server.')
  const files = new Map<string, Blob>()
  for (const img of embedParts(own.value).images) {
    const ref = blobRef(img.image)
    if (!ref || files.has(ref.ref.$link)) continue
    const bytes = await need(client, 'blueskyGetBlob')(ref.ref.$link)
    if (generation !== ownerGeneration()) return null
    files.set(ref.ref.$link, bytes.type ? bytes : new Blob([bytes], { type: ref.mimeType }))
  }
  return { status: post, record: own.value, files, generation }
}

/**
 * The text to redraft. Facets are made again from the text at send, so a
 * link whose shown text is not its URL (shortened by another app) gets its
 * URL back. A link the text makes again by itself stays as it is.
 */
export function redraftTextOf(text: string, facets: readonly BlueskyFacet[] | undefined): string {
  const bytes = new TextEncoder().encode(text)
  const dec = new TextDecoder()
  const links = (facets ?? [])
    .map((f) => ({ f, uri: f.features.find((x) => x.$type === LINK)?.uri }))
    .filter((x): x is { f: BlueskyFacet; uri: string } => typeof x.uri === 'string')
    .filter(({ f }) => f.index.byteStart >= 0 && f.index.byteStart < f.index.byteEnd && f.index.byteEnd <= bytes.length)
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

/**
 * After the delete: uploads each image again (the PDS dropped the old
 * blobs with the post) and builds the new draft. A failed upload keeps the
 * old ref; its bytes go to the dialog, which uploads them at Post. Never
 * throws; resolves null when the account changed.
 */
export async function finishBlueskyRedraft(client: CaribouClient, source: BlueskyRedraftSource): Promise<BlueskyRedraft | null> {
  const { record } = source
  if (source.generation !== ownerGeneration()) return null
  const { quote, images: recordImages } = embedParts(record)
  const images: BlueskyDraftImage[] = []
  const files: Record<string, Blob> = {}
  for (const img of recordImages) {
    const old = blobRef(img.image)
    const file = old ? source.files.get(old.ref.$link) : undefined
    if (!old || !file) continue
    let blob = old
    try {
      blob = await need(client, 'blueskyUploadBlob')(file)
    } catch {
      // The dialog's blob recovery uploads the bytes at Post.
    }
    if (source.generation !== ownerGeneration()) return null
    const id = globalThis.crypto.randomUUID()
    const w = img.aspectRatio?.width
    const h = img.aspectRatio?.height
    images.push({
      id, blob, mime: blob.mimeType, size: blob.size,
      alt: typeof img.alt === 'string' ? img.alt : '',
      aspectRatio: typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0 ? { width: w, height: h } : null,
    })
    files[id] = file
  }
  const root = strongRef(record.reply?.root)
  const parent = strongRef(record.reply?.parent)
  const reply = root && parent ? { root, parent } : null
  const menu = BLUESKY_SELF_LABELS.map((l) => l.value)
  const labels = (record.labels?.values ?? []).map((v) => v.val).filter((v) => menu.includes(v))
  const language = record.langs?.find((l) => typeof l === 'string' && l !== '') ?? null
  const draft = emptyDraft({
    text: redraftTextOf(record.text ?? '', record.facets),
    inReplyToId: reply?.parent.uri ?? null,
    language,
    // A new record: the dialog gives it a new rkey (R6).
    bluesky: emptyBlueskyDraft({ reply, quote, labels, images }),
  })
  return { draft, files }
}
