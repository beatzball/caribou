import type { AppBskyRichtextFacet } from '@atproto/api'

// The rules are in the package README, "Facets to HTML".

const LINK = 'app.bsky.richtext.facet#link'
const MENTION = 'app.bsky.richtext.facet#mention'
const TAG = 'app.bsky.richtext.facet#tag'

const LINK_ATTRS = 'rel="nofollow noopener noreferrer" target="_blank"'

// `did:<method>:<id>`. The id characters are the DID spec's, minus `%`, so
// the value is safe in a path and an attribute as it is.
const DID = /^did:[a-z]+:[A-Za-z0-9._:-]+$/

// The host rule (README, "A link does not hide its host"). Only ASCII
// whitespace makes text prose; every other code point goes to the URL
// parser, which drops or maps it the way a browser would.
const ASCII_SPACE = /[\t\n\f\r ]/
const ASCII_TRIM = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g
const EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
// The dots the URL parser reads as ".": full stop, ideographic, fullwidth
// and halfwidth ideographic.
const DOTS = /[.\u3002\uff0e\uff61]/g
// A domain: a dot, and a last label of two or more characters with a letter.
const DOMAIN = /\.(?=[^.]*[a-z\u00a1-\uffff])[^.]{2,}$/i
const IPV4 = /^\d+\.\d+\.\d+\.\d+$/

// Never equal to a real host: the text names a host we cannot read, so the
// link shows its real URI.
const UNREADABLE = '\u0000'

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

/** True when a host, as written or as parsed, is a domain or an IP address. */
function isHostLike(host: string): boolean {
  if (host.startsWith('[')) return true
  const h = host.replace(DOTS, '.').replace(/\.$/, '')
  return IPV4.test(h) || DOMAIN.test(h)
}

/** The host part of text as written: no scheme, user info, path or port. */
function writtenHost(t: string): string {
  const authority = t.replace(EXPLICIT_SCHEME, '').split(/[/?#]/, 1)[0] as string
  return (authority.split('@').pop() as string).replace(/:\d*$/, '')
}

/** The host the visible text names, or null when it names none. */
function textHost(text: string): string | null {
  const t = text.replace(ASCII_TRIM, '')
  if (t === '' || ASCII_SPACE.test(t)) return null
  const explicit = EXPLICIT_SCHEME.test(t)
  let url: URL
  try {
    url = new URL(explicit ? t : `https://${t}`)
  } catch {
    // Unreadable, but it claims to be a URL: fail closed.
    return explicit || isHostLike(writtenHost(t)) ? UNREADABLE : null
  }
  // "bank.example.com@evil.example" names one host and goes to another.
  if (url.username !== '' || url.password !== '') return UNREADABLE
  if (!explicit && !isHostLike(url.hostname)) return null
  // The parser reads "3.14" as the IPv4 address 3.0.0.14; only four
  // written parts make an address.
  if (!explicit && IPV4.test(url.hostname) && !IPV4.test(writtenHost(t).replace(DOTS, '.'))) return null
  return hostOf(url)
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
  if (named !== null && named !== hostOf(url)) return () => `${open}${escapeText(url.href)}</a>`
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
