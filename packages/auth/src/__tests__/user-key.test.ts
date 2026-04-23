import { describe, expect, it } from 'vitest'
import { isUserKey, parseUserKey, toUserKey, type UserKey } from '../user-key.js'

describe('UserKey', () => {
  it('toUserKey composes handle and server', () => {
    expect(toUserKey('beatzball', 'fosstodon.org')).toBe('beatzball@fosstodon.org')
  })

  it('isUserKey accepts well-formed values', () => {
    expect(isUserKey('beatzball@fosstodon.org')).toBe(true)
  })

  it('isUserKey rejects values without exactly one @', () => {
    expect(isUserKey('fosstodon.org')).toBe(false)
    expect(isUserKey('beatzball@@fosstodon.org')).toBe(false)
    expect(isUserKey('beatzball@')).toBe(false)
    expect(isUserKey('@fosstodon.org')).toBe(false)
    expect(isUserKey('')).toBe(false)
  })

  it('parseUserKey round-trips', () => {
    const parsed = parseUserKey('beatzball@fosstodon.org' satisfies UserKey)
    expect(parsed).toEqual({ handle: 'beatzball', server: 'fosstodon.org' })
  })

  it('parseUserKey throws on malformed input', () => {
    expect(() => parseUserKey('not-a-user-key' as UserKey)).toThrow(/invalid UserKey/i)
  })
})
