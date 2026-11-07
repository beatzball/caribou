import type { AppBskyRichtextFacet } from '@atproto/api'

// The rules are in the package README, "Facets to HTML".

const LINK = 'app.bsky.richtext.facet#link'
const MENTION = 'app.bsky.richtext.facet#mention'
const TAG = 'app.bsky.richtext.facet#tag'

const LINK_ATTRS = 'rel="nofollow noopener noreferrer" target="_blank"'

// `did:<method>:<id>`. The id characters are the DID spec's, minus `%`, so
// the value is safe in a path and an attribute as it is.
const DID = /^did:[a-z]+:[A-Za-z0-9._:-]+$/

// What the visible text names when it looks like a URL: one word, an
// optional http(s) scheme, then a host whose last label has a letter and two
// or more characters ("example.com", not "v1.2" or "e.g."). Bluesky shortens
// long link text with "…", so anything may follow the host.
const SCHEME = /^https?:\/\//i
const LAST_LABEL = /\.(?=[^.]*[a-z\u00a1-\uffff])[^.]{2,}$/i

// Never equal to a real host: the text names a host we cannot read, so the
// link shows its real URI.
const UNREADABLE = '\u0000'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Text as the DOM writes it back, so DOMPurify returns the same string. */
function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\u00a0/g, '&nbsp;')
    .replace(/\r\n|\r|\n/g, '<br>')
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

function hostOf(url: URL): string {
  return url.hostname.replace(/^www\./, '')
}

/** The host the visible text names, or null when it does not look like a URL. */
function textHost(text: string): string | null {
  const t = text.trim()
  if (t === '' || /\s/.test(t)) return null
  const authority = t.replace(SCHEME, '').split(/[/?#]/, 1)[0] as string
  const hostPart = authority.replace(/:\d*$/, '')
  if (!LAST_LABEL.test(hostPart.replace(/\.$/, ''))) return null
  // "bank.example.com@evil.example" names one host and goes to another.
  if (authority.includes('@')) return UNREADABLE
  try {
    return hostOf(new URL(`https://${authority}`))
  } catch {
    return UNREADABLE
  }
}

type Wrap = (inner: string) => string

function linkWrap(uri: unknown, text: string): Wrap | null {
  if (typeof uri !== 'string') return null
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const named = textHost(text)
  const open = `<a href="${escapeAttr(url.href)}" ${LINK_ATTRS}>`
  // A link must not pretend to go somewhere else: show the real URI.
  if (named !== null && named !== hostOf(url)) return () => `${open}${escapeText(uri)}</a>`
  return (inner) => `${open}${inner}</a>`
}

/** Wraps a segment for the facet's first known feature; null leaves it as text. */
function wrapFor(features: unknown, text: string): Wrap | null {
  if (!Array.isArray(features)) return null
  for (const f of features as unknown[]) {
    if (!f || typeof f !== 'object') continue
    const feature = f as { $type?: unknown; uri?: unknown; did?: unknown; tag?: unknown }
    switch (feature.$type) {
      case LINK:
        return linkWrap(feature.uri, text)
      case MENTION:
        if (typeof feature.did !== 'string' || !DID.test(feature.did)) return null
        return (inner) => `<a href="/@${feature.did as string}">${inner}</a>`
      case TAG:
        if (typeof feature.tag !== 'string' || feature.tag === '') return null
        return (inner) => `<a href="/tags/${encodeURIComponent(feature.tag as string)}?net=bsky">${inner}</a>`
      default:
        continue
    }
  }
  return null
}

/** True when byte `i` starts a character (or is the end of the text). */
function onBoundary(bytes: Uint8Array, i: number): boolean {
  return i === bytes.length || ((bytes[i] as number) & 0xc0) !== 0x80
}

function validRanges(bytes: Uint8Array, facets: unknown): { start: number; end: number; features: unknown }[] {
  if (!Array.isArray(facets)) return []
  const ranges: { start: number; end: number; features: unknown }[] = []
  for (const facet of facets as unknown[]) {
    const index = (facet as { index?: unknown } | null)?.index as { byteStart?: unknown; byteEnd?: unknown } | null | undefined
    if (!index || typeof index !== 'object') continue
    const { byteStart: start, byteEnd: end } = index
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue
    const s = start as number
    const e = end as number
    if (s < 0 || e > bytes.length || s >= e) continue
    if (!onBoundary(bytes, s) || !onBoundary(bytes, e)) continue
    ranges.push({ start: s, end: e, features: (facet as { features?: unknown }).features })
  }
  // Stable sort: equal starts keep the order the record gave.
  ranges.sort((a, b) => a.start - b.start)
  const kept: typeof ranges = []
  for (const r of ranges) {
    const prev = kept[kept.length - 1]
    if (prev && r.start < prev.end) continue
    kept.push(r)
  }
  return kept
}

/**
 * Post text plus facets → HTML (spec 7.1). Byte offsets, http(s) links only,
 * mentions by DID, tags to `/tags/<tag>?net=bsky`, wrapped in `<p>`. Pure and
 * server-safe; never throws. The caller still runs `PURIFY_OPTS` over the
 * result.
 */
export function renderFacets(text: string, facets: AppBskyRichtextFacet.Main[] | undefined): string {
  if (typeof text !== 'string' || text === '') return ''
  const bytes = encoder.encode(text)
  const decode = (s: number, e: number): string => decoder.decode(bytes.subarray(s, e))
  let html = ''
  let pos = 0
  for (const r of validRanges(bytes, facets)) {
    const segment = decode(r.start, r.end)
    const wrap = wrapFor(r.features, segment)
    // A range whose features give no link stays as text, merged with the
    // text around it.
    if (!wrap) continue
    html += escapeText(decode(pos, r.start)) + wrap(escapeText(segment))
    pos = r.end
  }
  html += escapeText(decode(pos, bytes.length))
  return `<p>${html}</p>`
}
