import { describe, it, expect } from 'vitest'
import { renderStatusLi, renderStatusLiList } from '../_render-status-li.js'
import type { mastodon } from 'masto'

const baseStatus = {
  id: '99',
  content: 'hi',
  createdAt: '2026-06-01T00:00:00.000Z',
} as unknown as mastodon.v1.Status

describe('renderStatusLi', () => {
  it('emits an <li data-key> wrapping a <caribou-status-card>', () => {
    const html = renderStatusLi(baseStatus)
    expect(html).toMatch(
      /^<li data-key="99"><caribou-status-card status=".*"><\/caribou-status-card><\/li>$/,
    )
  })

  it('escapes HTML-special characters in data-key (id)', () => {
    const s = { ...baseStatus, id: 'a"b&c<d>e' } as mastodon.v1.Status
    const html = renderStatusLi(s)
    expect(html).toContain('data-key="a&quot;b&amp;c&lt;d&gt;e"')
  })

  it('escapes HTML-special characters in the JSON status attribute', () => {
    const s = { ...baseStatus, content: '<script>"&\'</script>' } as mastodon.v1.Status
    const html = renderStatusLi(s)
    expect(html).not.toContain('"<')
    expect(html).toContain('&quot;')
    expect(html).toContain('&lt;')
    expect(html).toContain('&amp;')
  })

  it('round-trips: JSON.parse(unescape(attr-value)) === status', () => {
    const s = {
      ...baseStatus,
      content: '<p>hello "world" &amp; friends</p>',
    } as mastodon.v1.Status
    const html = renderStatusLi(s)
    const m = /status="([^"]*)"/.exec(html)!
    const raw = m[1]!
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
    expect(JSON.parse(raw)).toEqual(s)
  })

  it('handles unicode in id and content without corruption', () => {
    const s = { ...baseStatus, id: '🦣42', content: 'héllo 🌍' } as mastodon.v1.Status
    const html = renderStatusLi(s)
    expect(html).toContain('data-key="🦣42"')
    const m = /status="([^"]*)"/.exec(html)!
    const raw = m[1]!
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
    expect(JSON.parse(raw)).toEqual(s)
  })
})

describe('renderStatusLiList', () => {
  it('concatenates items with no separator', () => {
    const a = { ...baseStatus, id: '1' } as mastodon.v1.Status
    const b = { ...baseStatus, id: '2' } as mastodon.v1.Status
    const html = renderStatusLiList([a, b])
    expect(html).toBe(renderStatusLi(a) + renderStatusLi(b))
  })

  it('returns empty string for empty input', () => {
    expect(renderStatusLiList([])).toBe('')
  })
})
