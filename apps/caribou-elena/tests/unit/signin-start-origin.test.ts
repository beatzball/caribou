import { afterEach, describe, expect, it } from 'vitest'
import { resolveOrigin } from '../../server/routes/api/signin/start.post.js'

function fakeEvent(host: string, proto: string = 'http'): Parameters<typeof resolveOrigin>[0] {
  return {
    node: { req: { headers: { host, 'x-forwarded-proto': proto }, url: '/api/signin/start' } },
    path: '/api/signin/start',
  } as unknown as Parameters<typeof resolveOrigin>[0]
}

describe('resolveOrigin', () => {
  const original = process.env.PUBLIC_BASE_URL
  afterEach(() => {
    if (original === undefined) delete process.env.PUBLIC_BASE_URL
    else process.env.PUBLIC_BASE_URL = original
  })

  it('falls back to request URL when PUBLIC_BASE_URL is unset', () => {
    delete process.env.PUBLIC_BASE_URL
    expect(resolveOrigin(fakeEvent('127.0.0.1:3000'))).toBe('http://127.0.0.1:3000')
  })

  it('uses PUBLIC_BASE_URL when set, ignoring the request Host', () => {
    process.env.PUBLIC_BASE_URL = 'https://caribou.quest'
    expect(resolveOrigin(fakeEvent('evil.example'))).toBe('https://caribou.quest')
  })

  it('strips a trailing slash from PUBLIC_BASE_URL', () => {
    process.env.PUBLIC_BASE_URL = 'https://caribou.quest/'
    expect(resolveOrigin(fakeEvent('caribou.quest'))).toBe('https://caribou.quest')
  })

  it('treats blank PUBLIC_BASE_URL as unset', () => {
    process.env.PUBLIC_BASE_URL = '   '
    expect(resolveOrigin(fakeEvent('127.0.0.1:3000'))).toBe('http://127.0.0.1:3000')
  })
})
