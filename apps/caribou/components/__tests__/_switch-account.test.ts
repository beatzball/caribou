import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toUserKey } from '@beatzball/caribou-auth'
import { activeUserKey, addUserSession, users, type UserSession } from '@beatzball/caribou-state'
import {
  healInstanceCookie, land, pathAfterSwitch, readShellInfo, resetLanding, switchToAccount,
  type LandDeps,
} from '../_switch-account.js'

const a = toUserKey('alice', 'example.social')
const b = toUserKey('bob', 'other.example')
function s(userKey: typeof a, server: string): UserSession {
  return { userKey, server, token: 'T', vapidKey: 'V', account: null, createdAt: 1 }
}

// Lands as `session` the way a caller does: make it the only active account,
// then ask for a landing.
async function landAs(session: { server: string } | null, deps: LandDeps): Promise<void> {
  users.value = new Map()
  activeUserKey.value = null
  if (session) addUserSession(s(b, session.server))
  await land({ from: 'example.social' }, deps)
}

beforeEach(() => {
  resetLanding()
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
})

describe('pathAfterSwitch', () => {
  it.each([
    ['/home', '/home'],
    ['/notifications', '/notifications'],
    ['/bookmarks', '/bookmarks'],
    ['/local', '/local'],
    ['/public', '/public'],
    ['/about', '/about'],
    ['/blog/some-post', '/blog/some-post'],
    ['/@carol@example.social', '/@carol@example.social'],
    ['/@me', '/@me'],
    ['/@me?tab=media', '/@me?tab=media'],
    ['/notifications?filter=mentions', '/notifications?filter=mentions'],
    ['/@carol@example.social?tab=media', '/@carol@example.social?tab=media'],
    ['/@carol/109999?x=1', '/home'],
    ['/', '/home'],
    ['/@carol', '/home'],
    ['/@carol/109999', '/home'],
    ['/@carol@example.social/109999', '/home'],
  ])('%s -> %s', (from, to) => {
    expect(pathAfterSwitch(from)).toBe(to)
  })
})

describe('land', () => {
  it('sets the cookie to the session server, then loads the kept path', async () => {
    const order: string[] = []
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      order.push(`fetch ${init?.body as string}`)
      return new Response(null, { status: 204 })
    })
    const replace = vi.fn((url: string) => { order.push(`replace ${url}`) })
    await landAs({ server: 'other.example' }, { fetch: fetch as unknown as typeof globalThis.fetch, replace, path: '/local' })
    expect(fetch).toHaveBeenCalledWith('/api/instance', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }))
    expect(order).toEqual(['fetch {"server":"other.example"}', 'replace /local'])
  })

  it('tries the cookie write once more when the first one fails', async () => {
    const replace = vi.fn()
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    await landAs({ server: 'other.example' }, { fetch: fetch as unknown as typeof globalThis.fetch, replace, path: '/local' })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(replace).toHaveBeenCalledWith('/local')
  })

  describe('when the cookie write fails twice', () => {
    const failures: [string, () => Promise<Response>][] = [
      ['400', async () => new Response('unknown server', { status: 400 })],
      ['403', async () => new Response('cross-site request', { status: 403 })],
      ['503', async () => new Response(null, { status: 503 })],
      ['a rejected fetch', async () => { throw new Error('offline') }],
    ]

    it.each(failures)('%s: a page that renders from the cookie server goes to /home', async (_, fail) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      for (const path of ['/local', '/public?max_id=9']) {
        resetLanding()
        const replace = vi.fn()
        const fetch = vi.fn(fail)
        await landAs({ server: 'other.example' }, { fetch: fetch as unknown as typeof globalThis.fetch, replace, path })
        expect(fetch).toHaveBeenCalledTimes(2)
        expect(replace).toHaveBeenCalledWith('/home')
      }
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('other.example'))
      warn.mockRestore()
    })

    it.each(failures)('%s: a page that does not read the cookie is kept', async (_, fail) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      for (const path of ['/notifications', '/@me', '/@carol@example.social']) {
        resetLanding()
        const replace = vi.fn()
        await landAs({ server: 'other.example' }, { fetch: vi.fn(fail) as unknown as typeof globalThis.fetch, replace, path })
        expect(replace).toHaveBeenCalledWith(path)
      }
      warn.mockRestore()
    })
  })

  it('goes to / with no session and does not touch the cookie', async () => {
    const replace = vi.fn()
    const fetch = vi.fn()
    await landAs(null, { fetch: fetch as unknown as typeof globalThis.fetch, replace })
    expect(fetch).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith('/')
  })
})

describe('switchToAccount', () => {
  it('makes the account active, sets its server, and reloads', async () => {
    addUserSession(s(a, 'example.social'))
    addUserSession(s(b, 'other.example'))
    const fetch = vi.fn(async () => new Response(null, { status: 204 }))
    const replace = vi.fn()
    expect(await switchToAccount(a, { fetch: fetch as unknown as typeof globalThis.fetch, replace, path: '/home' })).toBe(true)
    expect(activeUserKey.value).toBe(a)
    expect(fetch).toHaveBeenCalledWith('/api/instance', expect.objectContaining({ body: '{"server":"example.social"}' }))
    expect(replace).toHaveBeenCalledWith('/home')
  })

  it('does nothing for an account that is not stored', async () => {
    addUserSession(s(b, 'other.example'))
    const replace = vi.fn()
    expect(await switchToAccount(a, { replace })).toBe(false)
    expect(activeUserKey.value).toBe(b)
    expect(replace).not.toHaveBeenCalled()
  })
})

describe('pathAfterSwitch across servers', () => {
  it.each([
    ['/local?max_id=9', '/local'],
    ['/public?local=true&min_id=3&since_id=2', '/public?local=true'],
    ['/@carol@example.social?tab=media&max_id=9', '/@carol@example.social?tab=media'],
    ['/@carol@example.social?tab=media', '/@carol@example.social?tab=media'],
    ['/@carol/109999?max_id=9', '/home'],
  ])('%s -> %s', (from, to) => {
    expect(pathAfterSwitch(from, true)).toBe(to)
  })

  it('keeps the cursor when the server stays the same', () => {
    expect(pathAfterSwitch('/local?max_id=9', false)).toBe('/local?max_id=9')
  })

  it('land drops the cursor only when the server changed', async () => {
    const ok = async () => new Response(null, { status: 204 })
    let replace = vi.fn()
    await landAs({ server: 'other.example' }, { fetch: vi.fn(ok) as unknown as typeof globalThis.fetch, replace, path: '/local?max_id=9' })
    expect(replace).toHaveBeenCalledWith('/local')

    resetLanding()
    replace = vi.fn()
    await landAs({ server: 'example.social' }, { fetch: vi.fn(ok) as unknown as typeof globalThis.fetch, replace, path: '/local?max_id=9' })
    expect(replace).toHaveBeenCalledWith('/local?max_id=9')
  })
})

describe('one landing per document', () => {
  it('a second request joins the first and navigates once', async () => {
    addUserSession(s(b, 'other.example'))
    const fetch = vi.fn(async () => new Response(null, { status: 204 }))
    const replace = vi.fn()
    const deps = { fetch: fetch as unknown as typeof globalThis.fetch, replace, path: '/home' }
    const first = land({ from: 'example.social' }, deps)
    const second = land({}, deps)
    await Promise.all([first, second])
    expect(fetch).toHaveBeenCalledOnce()
    expect(replace).toHaveBeenCalledOnce()
    // A request after the navigation does nothing more.
    await land({}, deps)
    expect(replace).toHaveBeenCalledOnce()
  })

  it('waits for `after` before it writes the cookie', async () => {
    addUserSession(s(b, 'other.example'))
    let done!: () => void
    const after = new Promise<void>((r) => { done = r })
    const fetch = vi.fn(async () => new Response(null, { status: 204 }))
    const replace = vi.fn()
    const run = land({ from: 'example.social', after }, { fetch: fetch as unknown as typeof globalThis.fetch, replace, path: '/home' })
    await new Promise((r) => setTimeout(r, 0))
    expect(fetch).not.toHaveBeenCalled()
    done()
    await run
    expect(fetch).toHaveBeenCalledOnce()
    expect(replace).toHaveBeenCalledWith('/home')
  })
})

describe('a rejected `after` gate (Fable 3)', () => {
  it('with an account left: still writes the cookie and keeps the path', async () => {
    addUserSession(s(b, 'other.example'))
    const fetch = vi.fn(async () => new Response(null, { status: 204 }))
    const replace = vi.fn()
    await land(
      { from: 'example.social', after: Promise.reject(new Error('offline')) },
      { fetch: fetch as unknown as typeof globalThis.fetch, replace, path: '/local' },
    )
    expect(fetch).toHaveBeenCalledOnce()
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ server: 'other.example' })
    expect(replace).toHaveBeenCalledOnce()
    expect(replace).toHaveBeenCalledWith('/local')
  })
})

describe('healInstanceCookie', () => {
  const ok = () => vi.fn(async () => new Response(null, { status: 204 }))

  it('writes the active server once when the cookie names another server', async () => {
    addUserSession(s(b, 'other.example'))
    const fetch = ok()
    expect(await healInstanceCookie({ instance: 'example.social', source: 'cookie' }, { fetch: fetch as unknown as typeof globalThis.fetch })).toBe(true)
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/instance')
    expect(JSON.parse(init.body as string)).toEqual({ server: 'other.example' })
  })

  it.each([
    ['the cookie matches', { instance: 'other.example', source: 'cookie' as const }],
    ['the cookie matches in another case', { instance: 'Other.Example', source: 'cookie' as const }],
    ['the instance comes from the path', { instance: 'example.social', source: 'path' as const }],
    ['there is no instance', { instance: null }],
    ['there is no shell info', null],
  ])('does nothing when %s', async (_name, shell) => {
    addUserSession(s(b, 'other.example'))
    const fetch = ok()
    expect(await healInstanceCookie(shell, { fetch: fetch as unknown as typeof globalThis.fetch })).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does nothing with no active account', async () => {
    const fetch = ok()
    expect(await healInstanceCookie({ instance: 'example.social', source: 'cookie' }, { fetch: fetch as unknown as typeof globalThis.fetch })).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does nothing while a landing runs', async () => {
    addUserSession(s(b, 'other.example'))
    const fetch = ok()
    const run = land({ from: 'example.social' }, { fetch: fetch as unknown as typeof globalThis.fetch, replace: vi.fn(), path: '/home' })
    expect(await healInstanceCookie({ instance: 'example.social', source: 'cookie' }, { fetch: fetch as unknown as typeof globalThis.fetch })).toBe(false)
    await run
    expect(fetch).toHaveBeenCalledOnce()
  })
})

describe('readShellInfo', () => {
  function doc(text: string | null): Document {
    const d = document.implementation.createHTMLDocument('')
    if (text !== null) {
      const el = d.createElement('script')
      el.type = 'application/json'
      el.id = '__litro_data__'
      el.textContent = text
      d.body.append(el)
    }
    return d
  }

  it('reads the shell of the page data', () => {
    expect(readShellInfo(doc('{"kind":"ok","shell":{"instance":"example.social","source":"cookie"}}')))
      .toEqual({ instance: 'example.social', source: 'cookie' })
  })

  it.each([['no data', null], ['bad JSON', '{'], ['no shell', '{"kind":"ok"}'], ['null', 'null']])('null for %s', (_n, text) => {
    expect(readShellInfo(doc(text))).toBeNull()
  })
})
