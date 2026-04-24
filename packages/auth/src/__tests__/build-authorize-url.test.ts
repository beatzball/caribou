import { describe, expect, it } from 'vitest'
import { buildAuthorizeUrl } from '../build-authorize-url.js'

describe('buildAuthorizeUrl', () => {
  it('builds https URL to instance /oauth/authorize with all query params', () => {
    const url = buildAuthorizeUrl({
      server: 'fosstodon.org',
      clientId: 'abc123',
      redirectUri: 'https://caribou.quest/api/signin/callback',
      scope: 'read write follow push',
      state: 'Xyz-AbC_dEf',
    })
    const u = new URL(url)
    expect(u.origin).toBe('https://fosstodon.org')
    expect(u.pathname).toBe('/oauth/authorize')
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('client_id')).toBe('abc123')
    expect(u.searchParams.get('redirect_uri')).toBe('https://caribou.quest/api/signin/callback')
    expect(u.searchParams.get('scope')).toBe('read write follow push')
    expect(u.searchParams.get('state')).toBe('Xyz-AbC_dEf')
  })

  it('strips scheme from server if included', () => {
    const url = buildAuthorizeUrl({
      server: 'https://mastodon.social',
      clientId: 'x', redirectUri: 'https://caribou.quest/api/signin/callback',
      scope: 'read', state: 's',
    })
    expect(new URL(url).origin).toBe('https://mastodon.social')
  })

  it('throws on empty server', () => {
    expect(() => buildAuthorizeUrl({
      server: '', clientId: 'x', redirectUri: 'y', scope: 'z', state: 'w',
    })).toThrow(/server/)
  })
})
