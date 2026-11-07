import type { AppBskyRichtextFacet } from '@atproto/api'
import DOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { PURIFY_OPTS, installPurifyHooks } from '@beatzball/caribou-mastodon-client/sanitize-opts'
import { postRecord } from '../__fixtures__/facets.js'
import { renderFacets } from '../facets.js'

type Feature = AppBskyRichtextFacet.Main['features'][number]

const LINK = 'app.bsky.richtext.facet#link'
const MENTION = 'app.bsky.richtext.facet#mention'
const TAG = 'app.bsky.richtext.facet#tag'
const A_EXT = 'rel="nofollow noopener noreferrer" target="_blank"'

const enc = new TextEncoder()
const bytes = (s: string): number => enc.encode(s).length

/** A facet over the first `sub` in `text`, with UTF-8 byte offsets. */
function at(text: string, sub: string, ...features: Feature[]): AppBskyRichtextFacet.Main {
  const i = text.indexOf(sub)
  if (i < 0) throw new Error(`"${sub}" not in "${text}"`)
  const byteStart = bytes(text.slice(0, i))
  return { index: { byteStart, byteEnd: byteStart + bytes(sub) }, features }
}
const raw = (byteStart: number, byteEnd: number, ...features: Feature[]): AppBskyRichtextFacet.Main => ({
  index: { byteStart, byteEnd },
  features,
})
const link = (uri: string): Feature => ({ $type: LINK, uri })
const mention = (did: string): Feature => ({ $type: MENTION, did })
const tag = (t: string): Feature => ({ $type: TAG, tag: t })

const purify = DOMPurify(new JSDOM('').window as unknown as Parameters<typeof DOMPurify>[0])
installPurifyHooks(purify)
const sanitize = (html: string): string => purify.sanitize(html, PURIFY_OPTS) as unknown as string

describe('renderFacets: the AppView fixture', () => {
  it('renders a real post record', () => {
    expect(renderFacets(postRecord.text, postRecord.facets)).toBe(
      '<p>👋 hi <a href="/@did:plc:alice">@alice.example.com</a>, café notes at ' +
        `<a href="https://example.com/notes/2026/caribou" ${A_EXT}>example.com/notes…</a> ` +
        '<a href="/tags/caribou?net=bsky">#caribou</a></p>',
    )
  })
})

describe('renderFacets: text', () => {
  it('wraps plain text in <p> and escapes HTML', () => {
    expect(renderFacets('a < b && c > d "q" \'s\'', undefined)).toBe(
      '<p>a &lt; b &amp;&amp; c &gt; d "q" \'s\'</p>',
    )
  })

  it('turns every kind of line break into <br>', () => {
    expect(renderFacets('one\ntwo\r\nthree\rfour', [])).toBe('<p>one<br>two<br>three<br>four</p>')
  })

  it('writes a no-break space as &nbsp;, the way the DOM does', () => {
    expect(renderFacets('a b', [])).toBe('<p>a&nbsp;b</p>')
  })

  it('gives an empty string for empty or non-string text', () => {
    expect(renderFacets('', [])).toBe('')
    expect(renderFacets(undefined as unknown as string, [])).toBe('')
    expect(renderFacets(42 as unknown as string, [])).toBe('')
  })

  it('escapes markup inside a facet', () => {
    const text = '<b>#x</b>'
    expect(renderFacets(text, [at(text, '<b>#x</b>', tag('x'))])).toBe(
      '<p><a href="/tags/x?net=bsky">&lt;b&gt;#x&lt;/b&gt;</a></p>',
    )
  })
})

describe('renderFacets: byte offsets', () => {
  it('cuts after emoji by bytes, not UTF-16 units', () => {
    // "🦌🦌 " is 9 bytes and 5 UTF-16 units; the tag starts at byte 9.
    const text = '🦌🦌 #deer'
    expect(renderFacets(text, [raw(9, 14, tag('deer'))])).toBe('<p>🦌🦌 <a href="/tags/deer?net=bsky">#deer</a></p>')
  })

  it('handles a ZWJ emoji sequence and a flag', () => {
    const text = '👩‍👩‍👧 🇨🇦 see https://example.com ok'
    expect(renderFacets(text, [at(text, 'https://example.com', link('https://example.com'))])).toBe(
      `<p>👩‍👩‍👧 🇨🇦 see <a href="https://example.com/" ${A_EXT}>https://example.com</a> ok</p>`,
    )
  })

  it('handles CJK text', () => {
    const text = '日本語のテキスト #タグ です'
    expect(renderFacets(text, [at(text, '#タグ', tag('タグ'))])).toBe(
      '<p>日本語のテキスト <a href="/tags/%E3%82%BF%E3%82%B0?net=bsky">#タグ</a> です</p>',
    )
  })

  it('keeps combining marks with their base letter', () => {
    // "é" is e plus a combining acute: 3 bytes.
    const text = 'café @bob.example.com'
    expect(renderFacets(text, [at(text, '@bob.example.com', mention('did:plc:bob'))])).toBe(
      '<p>café <a href="/@did:plc:bob">@bob.example.com</a></p>',
    )
  })

  it('takes a facet that covers a whole emoji', () => {
    expect(renderFacets('x🦌y', [raw(1, 5, tag('deer'))])).toBe('<p>x<a href="/tags/deer?net=bsky">🦌</a>y</p>')
  })
})

describe('renderFacets: bad facets never throw', () => {
  const text = 'hello #world'
  const good = at(text, '#world', tag('world'))
  const goodHtml = '<p>hello <a href="/tags/world?net=bsky">#world</a></p>'

  it.each([
    ['past the end', raw(6, 99, tag('world'))],
    ['starts past the end', raw(50, 60, tag('world'))],
    ['negative start', raw(-1, 3, tag('world'))],
    ['empty range', raw(3, 3, tag('world'))],
    ['reversed range', raw(5, 2, tag('world'))],
    ['fractional offsets', raw(1.5, 3, tag('world'))],
    ['string offsets', { index: { byteStart: '0', byteEnd: '3' }, features: [tag('world')] }],
    ['no index', { features: [tag('world')] }],
    ['null index', { index: null, features: [tag('world')] }],
    ['no features', { index: { byteStart: 0, byteEnd: 3 } }],
    ['empty features', raw(0, 3)],
    ['null feature', { index: { byteStart: 0, byteEnd: 3 }, features: [null] }],
    ['null facet', null],
  ])('drops a facet with %s', (_name, facet) => {
    const facets = [facet, good] as unknown as AppBskyRichtextFacet.Main[]
    expect(() => renderFacets(text, facets)).not.toThrow()
    expect(renderFacets(text, facets)).toBe(goodHtml)
  })

  it('drops a facet that cuts a character in half', () => {
    // "🦌" is bytes 0–3; a range ending at byte 2 splits it.
    expect(renderFacets('🦌 #x', [raw(0, 2, tag('x'))])).toBe('<p>🦌 #x</p>')
    expect(renderFacets('🦌 #x', [raw(1, 4, tag('x'))])).toBe('<p>🦌 #x</p>')
  })

  it('drops a facet that overlaps the one before it, after sorting', () => {
    const t = 'abcdefgh'
    // Given out of order: [4,8) then [0,6). After sorting, [0,6) wins.
    expect(renderFacets(t, [raw(4, 8, tag('late')), raw(0, 6, tag('early'))])).toBe(
      '<p><a href="/tags/early?net=bsky">abcdef</a>gh</p>',
    )
  })

  it('keeps facets that only touch', () => {
    expect(renderFacets('abcd', [raw(0, 2, tag('a')), raw(2, 4, tag('b'))])).toBe(
      '<p><a href="/tags/a?net=bsky">ab</a><a href="/tags/b?net=bsky">cd</a></p>',
    )
  })

  it('ignores a facets value that is not an array', () => {
    expect(renderFacets('hi', 'nope' as unknown as AppBskyRichtextFacet.Main[])).toBe('<p>hi</p>')
  })

  it('does not change the caller’s array', () => {
    const facets = [raw(2, 4, tag('b')), raw(0, 2, tag('a'))]
    const copy = structuredClone(facets)
    renderFacets('abcd', facets)
    expect(facets).toEqual(copy)
  })
})

describe('renderFacets: links', () => {
  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['JavaScript: mixed case', 'JavaScript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['mailto:', 'mailto:alice@example.com'],
    ['a relative path', '/@did:plc:alice'],
    ['garbage', 'not a url'],
    ['a non-string', 42],
  ])('renders %s as plain text', (_name, uri) => {
    const text = 'click me'
    expect(renderFacets(text, [at(text, 'me', { $type: LINK, uri } as Feature)])).toBe('<p>click me</p>')
  })

  it('keeps http and https links and adds rel and target', () => {
    const text = 'a http://example.com/x b'
    expect(renderFacets(text, [at(text, 'http://example.com/x', link('http://example.com/x'))])).toBe(
      `<p>a <a href="http://example.com/x" ${A_EXT}>http://example.com/x</a> b</p>`,
    )
  })

  it('escapes & in the href', () => {
    const text = 'see example.com/?a=1&b=2'
    expect(renderFacets(text, [at(text, 'example.com/?a=1&b=2', link('https://example.com/?a=1&b=2'))])).toBe(
      `<p>see <a href="https://example.com/?a=1&amp;b=2" ${A_EXT}>example.com/?a=1&amp;b=2</a></p>`,
    )
  })

  it('cannot break out of the href with a quote', () => {
    const text = 'x'
    const html = renderFacets(text, [raw(0, 1, link('https://example.com/"onmouseover="alert(1)'))])
    expect(html).toBe(`<p><a href="https://example.com/%22onmouseover=%22alert(1)" ${A_EXT}>x</a></p>`)
  })

  it('shows the real URI when the text names another host', () => {
    const text = 'login at bank.example.com now'
    expect(renderFacets(text, [at(text, 'bank.example.com', link('https://evil.example.net/phish'))])).toBe(
      `<p>login at <a href="https://evil.example.net/phish" ${A_EXT}>https://evil.example.net/phish</a> now</p>`,
    )
  })

  it('shows the real URI when the text has a scheme and another host', () => {
    const text = 'https://bank.example.com/login'
    expect(renderFacets(text, [raw(0, bytes(text), link('https://evil.example.net/'))])).toBe(
      `<p><a href="https://evil.example.net/" ${A_EXT}>https://evil.example.net/</a></p>`,
    )
  })

  it('catches a look-alike host (Cyrillic а), compared as punycode', () => {
    const text = 'exаmple.com'
    expect(renderFacets(text, [raw(0, bytes(text), link('https://example.com/'))])).toBe(
      `<p><a href="https://example.com/" ${A_EXT}>https://example.com/</a></p>`,
    )
  })

  it('keeps the text when only www., case or the path differ', () => {
    const text = 'WWW.Example.com/a… and example.com'
    const facets = [
      at(text, 'WWW.Example.com/a…', link('https://example.com/a/very/long/path')),
      at(text, 'and example.com'.slice(4), link('https://www.example.com/')),
    ]
    expect(renderFacets(text, facets)).toBe(
      `<p><a href="https://example.com/a/very/long/path" ${A_EXT}>WWW.Example.com/a…</a> and ` +
        `<a href="https://www.example.com/" ${A_EXT}>example.com</a></p>`,
    )
  })

  it.each([
    ['user info before the host', 'bank.example.com@evil.example.net'],
    ['a host the URL parser refuses', 'exa[mple.com'],
    ['a port too large', 'evil.example.net:999999'],
  ])('shows the real URI for text with %s', (_name, text) => {
    expect(renderFacets(text, [raw(0, bytes(text), link('https://evil.example.net/'))])).toBe(
      `<p><a href="https://evil.example.net/" ${A_EXT}>https://evil.example.net/</a></p>`,
    )
  })

  it.each([['a version number', 'v1.2'], ['an abbreviation', 'e.g.'], ['one word', 'here']])(
    'keeps text that is %s',
    (_name, text) => {
      expect(renderFacets(text, [raw(0, bytes(text), link('https://example.com/'))])).toBe(
        `<p><a href="https://example.com/" ${A_EXT}>${text}</a></p>`,
      )
    },
  )

  it('keeps the text for a host with a port', () => {
    const text = 'example.com:8080/x'
    expect(renderFacets(text, [raw(0, bytes(text), link('https://example.com:8080/x'))])).toBe(
      `<p><a href="https://example.com:8080/x" ${A_EXT}>example.com:8080/x</a></p>`,
    )
  })

  it('keeps text that does not look like a URL', () => {
    const text = 'read this'
    expect(renderFacets(text, [raw(0, 9, link('https://example.com/'))])).toBe(
      `<p><a href="https://example.com/" ${A_EXT}>read this</a></p>`,
    )
  })

  it('treats a dotted word with a space as not a URL', () => {
    const text = 'see example.com now'
    expect(renderFacets(text, [raw(0, bytes(text), link('https://other.example/'))])).toBe(
      `<p><a href="https://other.example/" ${A_EXT}>see example.com now</a></p>`,
    )
  })
})

describe('renderFacets: mentions and tags', () => {
  it('links a mention by its DID, not the text', () => {
    const text = 'hi @bob.example.com'
    expect(renderFacets(text, [at(text, '@bob.example.com', mention('did:plc:alice'))])).toBe(
      '<p>hi <a href="/@did:plc:alice">@bob.example.com</a></p>',
    )
  })

  it('accepts a did:web DID', () => {
    expect(renderFacets('@x', [raw(0, 2, mention('did:web:example.com'))])).toBe(
      '<p><a href="/@did:web:example.com">@x</a></p>',
    )
  })

  it.each([
    ['not a DID', 'alice.example.com'],
    ['a DID with a quote', 'did:plc:a"b'],
    ['a DID with a slash', 'did:plc:a/../b'],
    ['an empty string', ''],
    ['a non-string', 7],
  ])('renders a mention with %s as plain text', (_name, did) => {
    expect(renderFacets('@x', [raw(0, 2, { $type: MENTION, did } as Feature)])).toBe('<p>@x</p>')
  })

  it('URL-encodes a tag', () => {
    expect(renderFacets('#a&b', [raw(0, 4, tag('a&b?/c'))])).toBe('<p><a href="/tags/a%26b%3F%2Fc?net=bsky">#a&amp;b</a></p>')
  })

  it('renders an empty or non-string tag as plain text', () => {
    expect(renderFacets('#', [raw(0, 1, tag(''))])).toBe('<p>#</p>')
    expect(renderFacets('#', [raw(0, 1, { $type: TAG, tag: null } as unknown as Feature)])).toBe('<p>#</p>')
  })
})

describe('renderFacets: several features', () => {
  it('uses the first known feature', () => {
    expect(renderFacets('ab', [raw(0, 2, tag('t'), mention('did:plc:alice'))])).toBe('<p><a href="/tags/t?net=bsky">ab</a></p>')
  })

  it('passes over an unknown feature type', () => {
    const unknown = { $type: 'app.example.facet#sparkle' } as Feature
    expect(renderFacets('ab', [raw(0, 2, unknown, mention('did:plc:alice'))])).toBe('<p><a href="/@did:plc:alice">ab</a></p>')
  })

  it('fails closed when the first known feature is unsafe', () => {
    expect(renderFacets('ab', [raw(0, 2, link('javascript:alert(1)'), tag('t'))])).toBe('<p>ab</p>')
  })
})

describe('renderFacets: through PURIFY_OPTS', () => {
  const cases: [string, string, AppBskyRichtextFacet.Main[]][] = [
    ['the fixture', postRecord.text, postRecord.facets],
    ['escapes and breaks', 'a < b & c\n"d" e', []],
    ['a link with &', 'q', [raw(0, 1, link('https://example.com/?a=1&b=2'))]],
    ['a CJK tag', '#タグ', [raw(0, bytes('#タグ'), tag('タグ'))]],
  ]
  it.each(cases)('comes back unchanged: %s', (_name, text, facets) => {
    const html = renderFacets(text, facets)
    expect(sanitize(html)).toBe(html)
  })

  it('stays safe after DOMPurify when a link is unsafe', () => {
    const html = sanitize(renderFacets('x', [raw(0, 1, link('javascript:alert(1)'))]))
    expect(html).toBe('<p>x</p>')
  })
})
