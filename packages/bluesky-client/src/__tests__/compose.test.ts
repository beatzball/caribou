import { describe, expect, it, vi } from 'vitest'
import { isValidTid } from '@atproto/syntax'
import { countPost, detectFacets, nextRkey, postFits, POST_MAX_BYTES, POST_MAX_GRAPHEMES } from '../compose.js'

describe('countPost: graphemes and bytes, as the PDS counts', () => {
  it('counts plain ASCII as one grapheme and one byte each', () => {
    expect(countPost('hello')).toEqual({ graphemes: 5, bytes: 5 })
  })

  it('counts a family emoji (a ZWJ sequence) as one grapheme of 25 bytes', () => {
    expect(countPost('👨‍👩‍👧‍👦')).toEqual({ graphemes: 1, bytes: 25 })
  })

  it('counts a flag as one grapheme', () => {
    expect(countPost('🇳🇴')).toEqual({ graphemes: 1, bytes: 8 })
  })

  it('counts a letter with many combining marks as one grapheme', () => {
    const zalgo = `a${'́'.repeat(50)}`
    expect(countPost(zalgo)).toEqual({ graphemes: 1, bytes: 101 })
  })

  it('a long combining sequence passes the grapheme limit but not the byte limit', () => {
    const text = `a${'́'.repeat(50)}`.repeat(30)
    const len = countPost(text)
    expect(len.graphemes).toBe(30)
    expect(len.bytes).toBe(3030)
    expect(postFits(len)).toBe(false)
  })

  it('counts CJK as one grapheme of 3 bytes', () => {
    expect(countPost('你好')).toEqual({ graphemes: 2, bytes: 6 })
    expect(postFits(countPost('你'.repeat(POST_MAX_GRAPHEMES)))).toBe(true)
    expect(postFits(countPost('你'.repeat(POST_MAX_GRAPHEMES + 1)))).toBe(false)
  })

  it('counts a link as its whole text (Bluesky does not shorten it)', () => {
    const url = 'https://example.com/a/very/long/path?with=query'
    expect(countPost(url)).toEqual({ graphemes: url.length, bytes: url.length })
  })

  it('fits at exactly 300 graphemes and 3000 bytes, not one over', () => {
    expect(postFits(countPost('x'.repeat(300)))).toBe(true)
    expect(postFits(countPost('x'.repeat(301)))).toBe(false)
    expect(postFits({ graphemes: 10, bytes: POST_MAX_BYTES })).toBe(true)
    expect(postFits({ graphemes: 10, bytes: POST_MAX_BYTES + 1 })).toBe(false)
  })
})

describe('nextRkey', () => {
  it('is a valid TID, and a new one each time', () => {
    const a = nextRkey()
    const b = nextRkey()
    expect(isValidTid(a)).toBe(true)
    expect(isValidTid(b)).toBe(true)
    expect(a).not.toBe(b)
  })
})

describe('detectFacets', () => {
  function agent(dids: Record<string, string>) {
    const resolveHandle = vi.fn(async ({ handle }: { handle: string }) => {
      const did = dids[handle]
      if (!did) throw new Error('Unable to resolve handle')
      return { data: { did } }
    })
    return { agent: { com: { atproto: { identity: { resolveHandle } } } }, resolveHandle }
  }

  it('finds links, tags and mentions, with each mention resolved to its DID', async () => {
    const { agent: a } = agent({ 'alice.example.com': 'did:plc:alice' })
    const text = 'hi @alice.example.com see https://example.com #caribou'
    const facets = await detectFacets(a as never, text)
    const kinds = facets.map((f) => f.features[0]!.$type)
    expect(kinds).toEqual([
      'app.bsky.richtext.facet#mention', 'app.bsky.richtext.facet#link', 'app.bsky.richtext.facet#tag',
    ])
    expect(facets[0]!.features[0]).toMatchObject({ did: 'did:plc:alice' })
    // Byte offsets: "hi " is 3 bytes.
    expect(facets[0]!.index).toEqual({ byteStart: 3, byteEnd: 21 })
  })

  it('drops a mention whose handle does not resolve; the text stays plain', async () => {
    const { agent: a } = agent({})
    const facets = await detectFacets(a as never, 'hi @nobody.example.com')
    expect(facets).toEqual([])
  })

  it('counts facet offsets in UTF-8 bytes after emoji', async () => {
    const { agent: a } = agent({})
    const facets = await detectFacets(a as never, '👨‍👩‍👧‍👦 https://example.com')
    expect(facets[0]!.index).toEqual({ byteStart: 26, byteEnd: 26 + 'https://example.com'.length })
  })

  it('answers plain data that survives JSON', async () => {
    const { agent: a } = agent({ 'alice.example.com': 'did:plc:alice' })
    const facets = await detectFacets(a as never, '@alice.example.com #tag')
    expect(JSON.parse(JSON.stringify(facets))).toEqual(facets)
  })
})

describe('cardLink: the link a card is for (C2)', () => {
  it('is the first link in the text', async () => {
    const { cardLink } = await import('../compose.js')
    expect(cardLink('see https://example.com/a and https://example.org/b')).toBe('https://example.com/a')
  })

  it('is null with no link', async () => {
    const { cardLink } = await import('../compose.js')
    expect(cardLink('no link here')).toBeNull()
    expect(cardLink('')).toBeNull()
  })

  it('takes a bare domain, as the SDK does', async () => {
    const { cardLink } = await import('../compose.js')
    expect(cardLink('go to example.com now')).toBe('https://example.com')
  })

  it('skips a link that is not http or https', async () => {
    const { cardLink } = await import('../compose.js')
    expect(cardLink('ftp://example.com/x')).toBeNull()
  })
})
