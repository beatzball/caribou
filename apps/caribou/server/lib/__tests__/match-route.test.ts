import { describe, it, expect } from 'vitest'
import type { LitroRoute } from '@beatzball/litro'
import { matchRoute } from '../match-route.js'

const route = (over: Partial<LitroRoute> & Pick<LitroRoute, 'path'>): LitroRoute => ({
  filePath: '/fake.ts',
  componentTag: 'fake-page',
  isDynamic: false,
  isCatchAll: false,
  ...over,
})

describe('matchRoute — Mastodon-style /@handle URLs', () => {
  // Regression for the Litro page-scanner bug where the @[handle] segment
  // was emitted as the literal `@[handle]` instead of `@:handle`. Without
  // the patches/@beatzball__litro@0.9.1.patch fix, the manifest produces
  // /@[handle]/:statusId and Nitro's matcher treats `[handle]` as a
  // character class — breaking every /@user URL. See follow-ups.md.
  const handleRoute = route({
    path: '/@:handle',
    isDynamic: true,
  })
  const statusRoute = route({
    path: '/@:handle/:statusId',
    isDynamic: true,
  })

  it('matches a host-qualified handle on the profile route', () => {
    const result = matchRoute([handleRoute], '/@oerinfo@bildung.social')
    expect(result?.params).toEqual({ handle: 'oerinfo@bildung.social' })
  })

  it('matches /@handle/statusId with a numeric status id', () => {
    const result = matchRoute(
      [statusRoute],
      '/@oerinfo@bildung.social/116527400563438575',
    )
    expect(result?.params).toEqual({
      handle: 'oerinfo@bildung.social',
      statusId: '116527400563438575',
    })
  })

  it('matches a bare handle (no host) on /@:handle', () => {
    const result = matchRoute([handleRoute], '/@me')
    expect(result?.params).toEqual({ handle: 'me' })
  })

  it('does NOT match /@handle/extra/segment as the status route', () => {
    const result = matchRoute([statusRoute], '/@me/extra/segment')
    expect(result).toBeUndefined()
  })

  it('prefers a static route over a dynamic match when listed first', () => {
    const staticHome = route({ path: '/home' })
    const wildcard = route({ path: '/:rest', isDynamic: true })
    const result = matchRoute([staticHome, wildcard], '/home')
    expect(result?.route.path).toBe('/home')
  })
})
