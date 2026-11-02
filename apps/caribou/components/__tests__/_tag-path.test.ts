import { describe, expect, it } from 'vitest'
import { parseTagParam, tagPath } from '../_tag-path.js'

describe('tagPath', () => {
  it('builds the in-app path, keeping the case the post wrote', () => {
    expect(tagPath('Caturday')).toBe('/tags/Caturday')
  })

  it('encodes a non-ASCII name', () => {
    expect(tagPath('日本')).toBe(`/tags/${encodeURIComponent('日本')}`)
  })
})

describe('parseTagParam', () => {
  it('decodes the path segment', () => {
    expect(parseTagParam(encodeURIComponent('café'))).toBe('café')
  })

  it('keeps case', () => {
    expect(parseTagParam('AI')).toBe('AI')
  })

  it('drops one leading # (an encoded %23 in a hand-typed link)', () => {
    expect(parseTagParam('%23ai')).toBe('ai')
  })

  it('composes a decomposed accent, so one tag has one name', () => {
    expect(parseTagParam(encodeURIComponent('café'))).toBe('café')
  })

  it('accepts digits, underscores and the middle dot', () => {
    expect(parseTagParam('web_3')).toBe('web_3')
    expect(parseTagParam(encodeURIComponent('l·l'))).toBe('l·l')
  })

  // Names Mastodon's HASHTAG_NAME_RE accepts (checked against the Ruby
  // expression from app/models/tag.rb).
  it('accepts every name Mastodon accepts', () => {
    for (const name of ['1_2', 'トム・ジェリー', 'a', '_a', '1a', 'a_', 'ＡＩ', 'हिन्दी', 'a\u200cb', 'Ⓐbc']) {
      expect(parseTagParam(encodeURIComponent(name)), name).toBe(name.normalize('NFC'))
    }
  })

  it('refuses a name that cannot be a hashtag', () => {
    for (const raw of ['', '%23', 'a%20b', 'a-b', '123', '_', '__', '_1_', 'a%2Fb', '..', '%2e%2e', 'ai%00',
      'ai%3Fx', 'ai%23x', 'a%5Cb', '%F0%9F%98%80', '%E0%A4%A', 'x'.repeat(201)]) {
      expect(parseTagParam(raw), raw).toBeNull()
    }
  })
})
