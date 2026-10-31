// Overlapping account changes: sign-out, 401s and the landing that follows
// them, with every network response held until the test releases it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toUserKey, type UserKey } from '@beatzball/caribou-auth'
import {
  activeUserKey, addUserSession, switchAccount, users, type UserSession,
} from '@beatzball/caribou-state'
import { installRestoreHandler, land, resetLanding } from '../_switch-account.js'
import { installUnauthorizedHandler } from '../_unauthorized.js'
import '../caribou-signout-form.js'

const A = toUserKey('alice', 'one.example')
const B = toUserKey('bob', 'two.example')
const C = toUserKey('carol', 'three.example')

function session(userKey: UserKey, server: string): UserSession {
  return { userKey, server, token: `T-${userKey}`, vapidKey: 'V', account: null, createdAt: 1 }
}

function store(...list: [UserKey, string][]): void {
  for (const [k, server] of list) addUserSession(session(k, server))
  switchAccount(list[0]![0])
}

function fire(target: EventTarget, userKey: UserKey): void {
  target.dispatchEvent(new CustomEvent('caribou:unauthorized', { detail: { userKey, token: `T-${userKey}` } }))
}

// A fetch whose every call stays pending until `release(i)`.
function heldFetch() {
  const calls: { url: string; body: string | null; resolve: (r: Response) => void }[] = []
  const fn = vi.fn((url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((resolve) => {
      calls.push({ url: String(url), body: (init?.body as string | undefined) ?? null, resolve })
    }))
  const cookieServers = () => calls
    .filter((c) => c.url === '/api/instance')
    .map((c) => (JSON.parse(c.body!) as { server: string }).server)
  const release = async (i: number, status = 204) => {
    calls[i]!.resolve(new Response(null, { status }))
    // Let the landing run up to its next await.
    await new Promise((r) => setTimeout(r, 0))
  }
  return { fn, calls, cookieServers, release }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

// happy-dom's PageTransitionEvent is a plain Event and drops `persisted`.
function pageshow(persisted: boolean): Event {
  const e = new PageTransitionEvent('pageshow', { persisted })
  if (e.persisted !== persisted) Object.defineProperty(e, 'persisted', { value: persisted })
  return e
}

beforeEach(() => {
  resetLanding()
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('401s during a landing (Codex 1)', () => {
  function setup() {
    const net = heldFetch()
    const replace = vi.fn()
    const target = new EventTarget()
    installUnauthorizedHandler(target, (req) => {
      void land(req, { fetch: net.fn as unknown as typeof fetch, replace, path: '/local' })
    })
    return { net, replace, target }
  }

  it('A, B, C: a 401 for A, then for B while B\'s cookie write is pending, lands as C', async () => {
    store([A, 'one.example'], [B, 'two.example'], [C, 'three.example'])
    const { net, replace, target } = setup()

    fire(target, A)
    expect(activeUserKey.value).toBe(B)
    await tick()
    expect(net.cookieServers()).toEqual(['two.example'])

    fire(target, B)
    // The state changes at once, even with a landing in flight.
    expect(activeUserKey.value).toBe(C)
    expect(JSON.parse(localStorage.getItem('caribou.activeUserKey')!)).toBe(C)

    await net.release(0)
    // B's write finished, but C is active now: write C's server before leaving.
    expect(replace).not.toHaveBeenCalled()
    expect(net.cookieServers()).toEqual(['two.example', 'three.example'])

    await net.release(1)
    expect(replace).toHaveBeenCalledOnce()
    expect(replace).toHaveBeenCalledWith('/local')
    expect([...users.value.keys()]).toEqual([C])
    expect(sessionStorage.getItem('caribou.error')).toBeNull()
  })

  it('A, B: a 401 for A, then for B during the landing, goes to / with the banner', async () => {
    store([A, 'one.example'], [B, 'two.example'])
    const { net, replace, target } = setup()

    fire(target, A)
    await tick()
    fire(target, B)
    expect(activeUserKey.value).toBeNull()

    await net.release(0)
    expect(net.cookieServers()).toEqual(['two.example'])
    expect(replace).toHaveBeenCalledOnce()
    expect(replace).toHaveBeenCalledWith('/')
    expect(sessionStorage.getItem('caribou.error')).toBe('unauthorized')
    expect(users.value.size).toBe(0)
  })

  it('a stale 401 during a landing changes nothing', async () => {
    store([A, 'one.example'], [B, 'two.example'])
    const { net, replace, target } = setup()
    fire(target, A)
    target.dispatchEvent(new CustomEvent('caribou:unauthorized', { detail: { userKey: B, token: 'old' } }))
    await tick()
    await net.release(0)
    expect(activeUserKey.value).toBe(B)
    expect(replace).toHaveBeenCalledOnce()
    expect(replace).toHaveBeenCalledWith('/local')
  })
})

describe('sign-out and a 401 together (Codex 2)', () => {
  async function mountForm() {
    const wrapper = document.createElement('caribou-signout-form')
    const form = document.createElement('form')
    form.setAttribute('action', '/api/signout')
    form.setAttribute('method', 'post')
    wrapper.appendChild(form)
    document.body.appendChild(wrapper)
    await (wrapper as unknown as { updateComplete: Promise<unknown> }).updateComplete
    return form
  }

  function submit(form: HTMLFormElement): void {
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
  }

  it('sign out of A, a 401 for B during the sign-out POST: lands as C, cookie names C\'s server, one navigation', async () => {
    history.replaceState(null, '', '/local')
    store([A, 'one.example'], [B, 'two.example'], [C, 'three.example'])
    const net = heldFetch()
    vi.spyOn(globalThis, 'fetch').mockImplementation(net.fn as unknown as typeof fetch)
    const replace = vi.spyOn(location, 'replace').mockImplementation(() => {})
    const target = new EventTarget()
    installUnauthorizedHandler(target, (req) => { void land(req) })

    submit(await mountForm())
    expect(activeUserKey.value).toBe(B)
    expect(net.calls.map((c) => c.url)[0]).toMatch(/\/api\/signout$/)

    // B's first request gets a 401 while the sign-out POST is pending.
    fire(target, B)
    expect(activeUserKey.value).toBe(C)

    await net.release(0)
    expect(net.cookieServers()).toEqual(['three.example'])
    await net.release(1)

    expect(net.cookieServers().at(-1)).toBe('three.example')
    expect(replace).toHaveBeenCalledOnce()
    expect(replace).toHaveBeenCalledWith('/local')
    expect([...users.value.keys()]).toEqual([C])
  })
})

describe('a page restored from the back-forward cache', () => {
  it('can sign out again, and reads the accounts from storage', async () => {
    store([A, 'one.example'], [B, 'two.example'], [C, 'three.example'])
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    const replace = vi.spyOn(location, 'replace').mockImplementation(() => {})
    const target = new EventTarget()
    installRestoreHandler(target)

    const wrapper = document.createElement('caribou-signout-form')
    const form = document.createElement('form')
    form.setAttribute('action', '/api/signout')
    wrapper.appendChild(form)
    document.body.appendChild(wrapper)
    const submit = () => form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))

    submit()
    await vi.waitFor(() => expect(replace).toHaveBeenCalledOnce())
    expect(activeUserKey.value).toBe(B)

    // Another document signed out of B meanwhile; storage now holds only C.
    localStorage.setItem('caribou.users', JSON.stringify([[C, session(C, 'three.example')]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(C))

    // Not a restore: nothing changes, sign-out stays claimed.
    target.dispatchEvent(pageshow(false))
    submit()
    await tick()
    expect(replace).toHaveBeenCalledOnce()
    expect(activeUserKey.value).toBe(B)

    target.dispatchEvent(pageshow(true))
    expect([...users.value.keys()]).toEqual([C])
    expect(activeUserKey.value).toBe(C)

    submit()
    await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(2))
    expect(replace).toHaveBeenLastCalledWith('/')
    expect(users.value.size).toBe(0)
  })
})
