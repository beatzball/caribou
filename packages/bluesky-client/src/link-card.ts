/**
 * Link card data for compose (#200, spec 7.2), from Bluesky's `cardyb`
 * service, the one the official app uses. Plain `fetch`, no SDK. Rules C1
 * to C5, and why the fetch is not a Caribou route: README, "Link cards".
 */

export const CARDYB_ORIGIN = 'https://cardyb.bsky.app'
export const CARDYB_EXTRACT = `${CARDYB_ORIGIN}/v1/extract`
/** Only images through this proxy are fetched (C4). */
const CARDYB_IMAGE_PREFIX = `${CARDYB_ORIGIN}/`

export const CARD_TITLE_MAX = 300
export const CARD_DESCRIPTION_MAX = 1000
const TIMEOUT_MS = 5000
const CARD_MAX_BYTES = 64 * 1024
const IMAGE_MAX_BYTES = 5_000_000

/** What a link card shows and posts, before its image is uploaded. */
export interface LinkCardData {
  /** The link the reader typed (C3). */
  uri: string
  title: string
  description: string
  /** A `cardyb` image URL, or null (C4). */
  image: string | null
}

export interface LinkCardFetchOptions {
  fetch?: typeof fetch
  signal?: AbortSignal
}

function isHttp(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** A signal that fires on the caller's abort or after `TIMEOUT_MS` (C3). */
function deadline(signal?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  const onAbort = () => ctl.abort()
  if (signal?.aborted) ctl.abort()
  else signal?.addEventListener('abort', onAbort, { once: true })
  return {
    signal: ctl.signal,
    done: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

/**
 * The body as bytes, refused when over `max` (C3). The stream is read in
 * chunks and cancelled as soon as it passes `max`, so a large or endless
 * body is never read whole. A body refused by its Content-Length is
 * cancelled without being read.
 */
async function cappedBytes(res: Response, max: number): Promise<ArrayBuffer> {
  const declared = Number(res.headers.get('content-length'))
  if (res.headers.has('content-length') && Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {})
    throw new Error('Too large')
  }
  const reader = res.body?.getReader()
  if (!reader) return new ArrayBuffer(0)
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => {})
      throw new Error('Too large')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out.buffer
}

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max).trim() : ''
}

/** The card for `url`, or null when there is none (C1). Never throws. */
export async function fetchLinkCard(url: string, opts: LinkCardFetchOptions = {}): Promise<LinkCardData | null> {
  if (!isHttp(url)) return null
  const f = opts.fetch ?? globalThis.fetch
  const d = deadline(opts.signal)
  try {
    const res = await f(`${CARDYB_EXTRACT}?url=${encodeURIComponent(url)}`, {
      signal: d.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
    })
    if (!res.ok) return null
    const body = JSON.parse(new TextDecoder().decode(await cappedBytes(res, CARD_MAX_BYTES))) as Record<string, unknown>
    if (!body || typeof body !== 'object' || (typeof body.error === 'string' && body.error !== '')) return null
    const title = text(body.title, CARD_TITLE_MAX)
    if (title === '') return null
    const image = typeof body.image === 'string' && body.image.startsWith(CARDYB_IMAGE_PREFIX) ? body.image : null
    return { uri: url, title, description: text(body.description, CARD_DESCRIPTION_MAX), image }
  } catch {
    return null
  } finally {
    d.done()
  }
}

/** The card's image, through the `cardyb` proxy only (C4). Throws on any failure. */
export async function fetchCardImage(url: string, opts: LinkCardFetchOptions = {}): Promise<Blob> {
  if (!url.startsWith(CARDYB_IMAGE_PREFIX)) throw new Error('Not a card image URL')
  const f = opts.fetch ?? globalThis.fetch
  const d = deadline(opts.signal)
  try {
    const res = await f(url, { signal: d.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
    if (!res.ok) throw new Error(`Image answered ${res.status}`)
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    if (!type.startsWith('image/')) throw new Error('Not an image')
    return new Blob([await cappedBytes(res, IMAGE_MAX_BYTES)], { type })
  } finally {
    d.done()
  }
}
