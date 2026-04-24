import { describe, expect, it } from 'vitest'
import { parseCallbackFragment } from '../parse-callback-fragment.js'

describe('parseCallbackFragment', () => {
  it('parses a valid fragment with token, server, userKey, vapidKey', () => {
    const r = parseCallbackFragment(
      '#token=abc&server=fosstodon.org&userKey=beatzball%40fosstodon.org&vapidKey=BP...',
    )
    expect(r).toEqual({
      token: 'abc',
      server: 'fosstodon.org',
      userKey: 'beatzball@fosstodon.org',
      vapidKey: 'BP...',
    })
  })

  it('also accepts fragments without a leading #', () => {
    const r = parseCallbackFragment('token=a&server=s&userKey=u%40s&vapidKey=v')
    expect(r?.token).toBe('a')
  })

  it('returns null when token is missing', () => {
    expect(parseCallbackFragment('#server=fosstodon.org&userKey=u%40s')).toBeNull()
  })

  it('returns null when userKey is not a valid UserKey', () => {
    expect(parseCallbackFragment('#token=a&server=s&userKey=malformed')).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(parseCallbackFragment('')).toBeNull()
    expect(parseCallbackFragment('#')).toBeNull()
  })
})
