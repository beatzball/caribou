// @vitest-environment node
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, createRouter, toNodeListener } from 'h3'
import type { CompleteSigninResult } from '../../server/lib/signin-callback.js'
import { jsonForScript } from '../../server/lib/signin-complete-page.js'

// The sign-in routes as a browser meets them: real h3, real cookies and
// headers. The token exchange is a request to the user's server, so the
// callback's `completeSignin` and the start's `startSignin` are stand-ins.

const complete = vi.fn<() => Promise<CompleteSigninResult>>()
const start = vi.fn(async () => ({ authorizeUrl: 'https://one.example/oauth/authorize?x=1', nonce: 'NONCE' }))

vi.mock('../../server/lib/signin-callback.js', () => ({
  completeSignin: (...args: unknown[]) => (complete as (...a: unknown[]) => unknown)(...args),
  exchangeCodeForToken: vi.fn(),
  verifyCredentialsFetch: vi.fn(),
}))
vi.mock('../../server/lib/signin-start.js', () => ({
  startSignin: (...args: unknown[]) => (start as (...a: unknown[]) => unknown)(...args),
  registerMastodonApp: vi.fn(),
}))
vi.mock('../../server/lib/storage.js', async (original) => ({
  ...(await original<object>()),
  getStorage: () => ({}),
}))

let server: Server
let base: string

beforeAll(async () => {
  const { default: callback } = await import('../../server/routes/api/signin/callback.get.js')
  const { default: startRoute } = await import('../../server/routes/api/signin/start.post.js')
  const { default: done } = await import('../../server/routes/signin/done.get.js')
  const router = createRouter()
    .get('/api/signin/callback', callback)
    .post('/api/signin/start', startRoute)
    .get('/signin/done', done)
  const app = createApp().use(router)
  server = createServer(toNodeListener(app))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((r) => server.close(() => r())))
beforeEach(() => { complete.mockReset(); start.mockClear() })
afterEach(() => { delete process.env.PUBLIC_BASE_URL })

const SESSION = { token: 'TOK</script><b>', server: 'two.example', userKey: 'bob@two.example', vapidKey: 'VK' }

const callback = (cookie = 'caribou.signin=NONCE') =>
  fetch(`${base}/api/signin/callback?code=C&state=S`, { headers: { cookie }, redirect: 'manual' })

function sessionJson(html: string): unknown {
  const m = html.match(/<script type="application\/json" id="session">([^<]*)<\/script>/)
  return m ? JSON.parse(m[1]!) : null
}

describe('GET /api/signin/callback', () => {
  it('on success answers 200 with the completion page holding the session', async () => {
    complete.mockResolvedValue({ kind: 'ok', server: 'two.example', session: SESSION })
    const res = await callback()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/html/)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    const html = await res.text()
    expect(sessionJson(html)).toEqual(SESSION)
    // The token's `</script>` cannot end the block early.
    expect(html).not.toContain('TOK</script>')
    expect(html).toContain("location.replace('/feed')")
    expect(html).toContain("history.replaceState(null, '', '/')")
  })

  it('on success sets the instance cookie and clears the sign-in cookie', async () => {
    complete.mockResolvedValue({ kind: 'ok', server: 'two.example', session: SESSION })
    const cookies = (await callback()).headers.getSetCookie()
    expect(cookies.find((c) => c.startsWith('caribou.instance='))).toMatch(/^caribou\.instance=two\.example;/)
    expect(cookies.find((c) => c.startsWith('caribou.signin='))).toMatch(/^caribou\.signin=; Max-Age=0; Path=\/api\/signin/)
  })

  it('passes the sign-in cookie to the check', async () => {
    complete.mockResolvedValue({ kind: 'error', location: '/?error=state_mismatch' })
    await callback('caribou.signin=MY-NONCE')
    expect(complete).toHaveBeenCalledWith(
      { code: 'C', state: 'S', error: undefined, nonce: 'MY-NONCE' }, expect.anything())
  })

  it('the CSP lets only the page\'s own script and style run', async () => {
    complete.mockResolvedValue({ kind: 'ok', server: 'two.example', session: SESSION })
    const res = await callback()
    const csp = res.headers.get('content-security-policy') ?? ''
    const html = await res.text()
    const inline = (tag: string) => [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]!)
    const hash = (t: string) => `'sha256-${createHash('sha256').update(t).digest('base64')}'`
    expect(csp).toContain("default-src 'none'")
    expect(inline('script')).toHaveLength(1)
    expect(csp).toContain(`script-src ${hash(inline('script')[0]!)}`)
    expect(csp).toContain(`style-src ${hash(inline('style')[0]!)}`)
  })

  it('on an error redirects, sets no instance cookie, and clears the sign-in cookie', async () => {
    complete.mockResolvedValue({ kind: 'error', location: '/?error=no_cookie' })
    const res = await callback('')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/?error=no_cookie')
    const cookies = res.headers.getSetCookie()
    expect(cookies.some((c) => c.startsWith('caribou.instance='))).toBe(false)
    expect(cookies.find((c) => c.startsWith('caribou.signin='))).toMatch(/Max-Age=0/)
  })
})

describe('GET /signin/done', () => {
  it('takes nothing from the URL: it has no script, only the way back', async () => {
    const res = await fetch(`${base}/signin/done`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).not.toContain('<script')
    expect(html).toContain('Something went wrong completing sign-in.')
    expect(html).toMatch(/<p id="fallback">/)
  })
})

describe('POST /api/signin/start', () => {
  const post = (headers: Record<string, string>, body = { server: 'one.example' }) =>
    fetch(`${base}/api/signin/start`, {
      method: 'POST', body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...headers },
    })

  it('refuses a cross-site request with 403, before any work', async () => {
    const res = await post({ 'sec-fetch-site': 'cross-site' })
    expect(res.status).toBe(403)
    expect(res.headers.getSetCookie()).toEqual([])
    expect(start).not.toHaveBeenCalled()
  })

  it('refuses a request from another origin with 403', async () => {
    const res = await post({ origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    expect(start).not.toHaveBeenCalled()
  })

  it('refuses a request with neither Sec-Fetch-Site nor Origin', async () => {
    expect((await post({})).status).toBe(403)
  })

  it('a same-origin request starts the sign-in and sets the cookie', async () => {
    const res = await post({ 'sec-fetch-site': 'same-origin' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ authorizeUrl: 'https://one.example/oauth/authorize?x=1' })
    expect(res.headers.getSetCookie()[0]).toMatch(/^caribou\.signin=NONCE;/)
  })
})

describe('jsonForScript', () => {
  it('escapes <, >, &, U+2028 and U+2029 and still parses back', () => {
    const value = { a: '</script><!-- & \u2028\u2029' }
    const text = jsonForScript(value)
    expect(text).not.toMatch(/[<>&\u2028\u2029]/)
    expect(JSON.parse(text)).toEqual(value)
  })
})
