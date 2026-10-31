import { afterEach, describe, expect, it } from 'vitest'
import type { H3Event } from 'h3'
import { clearSigninCookie, readSigninCookie, setSigninCookie } from '../signin-binding.js'

function mockEvent(headers: Record<string, string> = {}): H3Event & { _out: Map<string, string[]> } {
  const out = new Map<string, string[]>()
  return {
    path: '/api/signin/start',
    node: {
      req: { url: '/api/signin/start', headers: { host: 'caribou.local', ...headers } },
      res: {
        getHeader: (k: string) => out.get(k),
        setHeader: (k: string, v: string | string[]) => out.set(k, Array.isArray(v) ? v : [v]),
      },
    },
    _out: out,
  } as unknown as H3Event & { _out: Map<string, string[]> }
}

const setCookie = (e: { _out: Map<string, string[]> }) =>
  e._out.get('set-cookie')?.find((c) => c.startsWith('caribou.signin=')) ?? ''

afterEach(() => { delete process.env.PUBLIC_BASE_URL })

describe('the sign-in cookie', () => {
  it('is HttpOnly, SameSite=Lax, short-lived, on /api/signin only, Secure on https', () => {
    process.env.PUBLIC_BASE_URL = 'https://caribou.quest'
    const e = mockEvent()
    setSigninCookie(e, 'N1')
    const c = setCookie(e)
    expect(c).toMatch(/^caribou\.signin=N1;/)
    expect(c).toMatch(/; HttpOnly/i)
    expect(c).toMatch(/; SameSite=Lax/i)
    expect(c).toMatch(/; Path=\/api\/signin(;|$)/)
    expect(c).toMatch(/; Max-Age=600(;|$)/)
    expect(c).toMatch(/; Secure/i)
  })

  it('is not Secure on a plain-http site (development)', () => {
    const e = mockEvent()
    setSigninCookie(e, 'N1')
    expect(setCookie(e)).not.toMatch(/Secure/i)
  })

  it('is read from the request and cleared on the same path', () => {
    expect(readSigninCookie(mockEvent({ cookie: 'a=b; caribou.signin=N2' }))).toBe('N2')
    expect(readSigninCookie(mockEvent())).toBeUndefined()
    const e = mockEvent()
    clearSigninCookie(e)
    expect(setCookie(e)).toMatch(/^caribou\.signin=;.*Max-Age=0.*Path=\/api\/signin/)
  })
})
