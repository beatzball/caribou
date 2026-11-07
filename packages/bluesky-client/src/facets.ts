import type { AppBskyRichtextFacet } from '@atproto/api'

// The rules are in the package README, "Facets to HTML".

const LINK = 'app.bsky.richtext.facet#link'
const MENTION = 'app.bsky.richtext.facet#mention'
const TAG = 'app.bsky.richtext.facet#tag'

const LINK_ATTRS = 'rel="nofollow noopener noreferrer" target="_blank"'

// `did:<method>:<id>`. The id characters are the DID spec's, minus `%`, so
// the value is safe in a path and an attribute as it is.
const DID = /^did:[a-z]+:[A-Za-z0-9._:-]+$/

// The host allow-list (README, "A link does not hide its host").
const ASCII_TRIM = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
// Format and invisible characters. `\p{Cf}` covers U+00AD, U+200B–U+200F,
// U+202A–U+202E, U+2060–U+206F and U+FEFF; U+2028 and U+2029 are separators.
const INVISIBLE = /[\p{Cf}\u2028\u2029]/u
// Characters that make text look like an address, after NFKC (which turns
// fullwidth and small stops into ".").
const ADDRESS = /[.:/@[\]\\\u3002\u06d4\u0701\u0702\u1362\u2e3c]/

const encoder = new TextEncoder()
// A post's U+FEFF is content, not a byte-order mark: keep it.
const decoder = new TextDecoder('utf-8', { ignoreBOM: true })

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

/** Rule 1: the text, read as a URL, has no user info and gives `url`'s host. */
function namesSameHost(text: string, url: URL): boolean {
  const t = text.replace(ASCII_TRIM, '')
  let parsed: URL
  try {
    parsed = new URL(HAS_SCHEME.test(t) ? t : `https://${t}`)
  } catch {
    return false
  }
  return parsed.username === '' && parsed.password === '' && hostOf(parsed) === hostOf(url)
}

/** Rule 2: plain prose, with no invisible character and nothing address-like. */
function isProse(text: string): boolean {
  const t = text.normalize('NFKC')
  return !INVISIBLE.test(t) && !ADDRESS.test(t)
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
  const open = `<a href="${escapeAttr(url.href)}" ${LINK_ATTRS}>`
  // A link must not pretend to go somewhere else: keep the text only when
  // it is allowed, otherwise show the real URI.
  if (!namesSameHost(text, url) && !isProse(text)) return () => `${open}${escapeText(url.href)}</a>`
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
      case TAG: {
        if (typeof feature.tag !== 'string' || feature.tag === '') return null
        let encoded: string
        try {
          encoded = encodeURIComponent(feature.tag)
        } catch {
          // A lone surrogate cannot be URL-encoded.
          return null
        }
        return (inner) => `<a href="/tags/${encoded}?net=bsky">${inner}</a>`
      }
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

interface Segment {
  start: number
  end: number
  wrap: Wrap
}

/**
 * The facets that will render, in order, without overlaps. A facet that
 * would render as text drops before the overlap pass, so it cannot hide a
 * good facet inside its range.
 */
function segments(bytes: Uint8Array, facets: unknown, decode: (s: number, e: number) => string): Segment[] {
  if (!Array.isArray(facets)) return []
  const found: Segment[] = []
  for (const facet of facets as unknown[]) {
    const index = (facet as { index?: unknown } | null)?.index as { byteStart?: unknown; byteEnd?: unknown } | null | undefined
    if (!index || typeof index !== 'object') continue
    const { byteStart: start, byteEnd: end } = index
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue
    const s = start as number
    const e = end as number
    if (s < 0 || e > bytes.length || s >= e) continue
    if (!onBoundary(bytes, s) || !onBoundary(bytes, e)) continue
    const wrap = wrapFor((facet as { features?: unknown }).features, decode(s, e))
    if (wrap) found.push({ start: s, end: e, wrap })
  }
  // Stable sort: equal starts keep the order the record gave.
  found.sort((a, b) => a.start - b.start)
  const kept: Segment[] = []
  for (const seg of found) {
    const prev = kept[kept.length - 1]
    if (prev && seg.start < prev.end) continue
    kept.push(seg)
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
  for (const seg of segments(bytes, facets, decode)) {
    html += escapeText(decode(pos, seg.start)) + seg.wrap(escapeText(decode(seg.start, seg.end)))
    pos = seg.end
  }
  html += escapeText(decode(pos, bytes.length))
  return `<p>${html}</p>`
}
