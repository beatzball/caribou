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

  it('refuses a name that cannot be a hashtag', () => {
    for (const raw of ['', '%23', 'a%20b', 'a-b', '123', 'a%2Fb', '%E0%A4%A', 'x'.repeat(201)]) {
      expect(parseTagParam(raw), raw).toBeNull()
    }
  })
})
