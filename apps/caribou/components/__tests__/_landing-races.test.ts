// Overlapping account changes: sign-out, 401s and the landing that follows
// them, with every network response held until the test releases it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toUserKey, type UserKey } from '@beatzball/caribou-auth'
import {
  activeUserKey, addUserSession, switchAccount, users, type UserSession,
} from '@beatzball/caribou-state'
import {
  healInstanceCookie, installRestoreHandler, land, resetLanding, switchToAccount,
} from '../_switch-account.js'
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

// `replace()` only asks for a navigation; the old document stays until the
// new one commits, or for good when the reader stops the load. These tests
// keep it (replace is a spy) and change the state after it.
describe('a state change after the landing navigated (round 3)', () => {
  async function mountForm() {
    const wrapper = document.createElement('caribou-signout-form')
    const form = document.createElement('form')
    form.setAttribute('action', '/api/signout')
    wrapper.appendChild(form)
    document.body.appendChild(wrapper)
    await (wrapper as unknown as { updateComplete: Promise<unknown> }).updateComplete
    return () => form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
  }

  function setup() {
    history.replaceState(null, '', '/local')
    const net = heldFetch()
    vi.spyOn(globalThis, 'fetch').mockImplementation(net.fn as unknown as typeof fetch)
    const replace = vi.spyOn(location, 'replace').mockImplementation(() => {})
    const target = new EventTarget()
    installUnauthorizedHandler(target, (req) => { void land(req) })
    return { net, replace, target }
  }

  it('A, B, C: 401 A lands as B, then Sign out does nothing (round 4)', async () => {
    store([A, 'one.example'], [B, 'two.example'], [C, 'three.example'])
    const { net, replace, target } = setup()
    const submit = await mountForm()

    fire(target, A)
    await tick()
    await net.release(0)
    expect(replace).toHaveBeenCalledOnce()
    expect(replace).toHaveBeenLastCalledWith('/local')

    // The old document still shows A; this click means A, which is gone.
    submit()
    await tick()
    expect(net.calls).toHaveLength(1)
    expect(activeUserKey.value).toBe(B)
    expect([...users.value.keys()]).toEqual([B, C])
    expect(replace).toHaveBeenCalledOnce()
  })

  it('A, B, C: 401 A lands as B, then a 401 for B lands as C', async () => {
    store([A, 'one.example'], [B, 'two.example'], [C, 'three.example'])
    const { net, replace, target } = setup()

    fire(target, A)
    await tick()
    await net.release(0)
    expect(replace).toHaveBeenCalledOnce()

    fire(target, B)
    await tick()
    expect(net.cookieServers()).toEqual(['two.example', 'three.example'])
    await net.release(1)
    expect(replace).toHaveBeenCalledTimes(2)
    expect(replace).toHaveBeenLastCalledWith('/local')
  })

  it('a repeat Sign out after the sign-out landing navigated does nothing', async () => {
    store([A, 'one.example'], [B, 'two.example'], [C, 'three.example'])
    const { net, replace } = setup()
    const submit = await mountForm()

    submit()
    await net.release(0)
    await net.release(1)
    expect(replace).toHaveBeenCalledOnce()

    // The old document still shows A; this click means A, which is gone.
    submit()
    await tick()
    expect(net.calls).toHaveLength(2)
    expect(activeUserKey.value).toBe(B)
    expect(replace).toHaveBeenCalledOnce()
  })

  it('a repeat request with no state change after the navigation does nothing', async () => {
    store([A, 'one.example'], [B, 'two.example'])
    const { net, replace, target } = setup()
    fire(target, A)
    await tick()
    await net.release(0)
    // The same 401 again: the token check drops it, and nothing changed.
    fire(target, A)
    await land({})
    await tick()
    expect(net.calls).toHaveLength(1)
    expect(replace).toHaveBeenCalledOnce()
  })
})

describe('the start-up cookie repair and a landing (round 4)', () => {
  async function mountForm() {
    const wrapper = document.createElement('caribou-signout-form')
    const form = document.createElement('form')
    form.setAttribute('action', '/api/signout')
    wrapper.appendChild(form)
    document.body.appendChild(wrapper)
    await (wrapper as unknown as { updateComplete: Promise<unknown> }).updateComplete
    return () => form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
  }

  it('a landing waits for a running repair, so its cookie write is the last one', async () => {
    // A on one.example; B and C on two.example. The cookie names another server.
    store([A, 'one.example'], [B, 'two.example'], [C, 'two.example'])
    history.replaceState(null, '', '/local')
    const net = heldFetch()
    vi.spyOn(globalThis, 'fetch').mockImplementation(net.fn as unknown as typeof fetch)
    const replace = vi.spyOn(location, 'replace').mockImplementation(() => {})
    const target = new EventTarget()
    installUnauthorizedHandler(target, (req) => { void land(req) })
    const submit = await mountForm()

    const heal = healInstanceCookie({ instance: 'zero.example', source: 'cookie' })
    expect(net.cookieServers()).toEqual(['one.example'])

    // A's token expires while the repair is in flight: B is active.
    fire(target, A)
    await tick()
    // The landing waits for the repair; it writes nothing yet.
    expect(net.cookieServers()).toEqual(['one.example'])

    // Sign out of B while the landing waits: C is active.
    submit()
    expect(activeUserKey.value).toBe(C)
    expect(net.calls[1]!.url).toMatch(/\/api\/signout$/)

    // The repair's response arrives after the landing would have written.
    await net.release(0)
    expect(await heal).toBe(true)
    expect(net.cookieServers()).toEqual(['one.example'])
    await net.release(1)
    expect(net.cookieServers()).toEqual(['one.example', 'two.example'])
    expect(replace).not.toHaveBeenCalled()

    await net.release(2)
    // The landing's write for C's server came after the repair's.
    expect(net.calls.map((c) => c.url.replace(/^.*\/api\//, ''))).toEqual(['instance', 'signout', 'instance'])
    expect(replace).toHaveBeenCalledOnce()
    expect(replace).toHaveBeenCalledWith('/local')
    expect([...users.value.keys()]).toEqual([C])
  })
})

describe('a repair that hangs (round 5)', () => {
  it('holds the last sign-out for a bounded time only', async () => {
    vi.useFakeTimers()
    try {
      store([A, 'one.example'])
      const net = heldFetch()
      const replace = vi.fn()
      void healInstanceCookie({ instance: 'zero.example', source: 'cookie' }, { fetch: net.fn as unknown as typeof fetch })
      expect(net.cookieServers()).toEqual(['one.example'])

      // The last account signs out; its POST is done at once. The repair never answers.
      users.value = new Map()
      activeUserKey.value = null
      void land({ after: Promise.resolve() }, { fetch: net.fn as unknown as typeof fetch, replace, path: '/local' })
      await vi.advanceTimersByTimeAsync(1000)
      expect(replace).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(5000)
      expect(replace).toHaveBeenCalledOnce()
      expect(replace).toHaveBeenCalledWith('/')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a restore while a landing is still running (round 3)', () => {
  it('stops the old landing and starts one for the state read again', async () => {
    store([A, 'one.example'], [B, 'two.example'], [C, 'three.example'])
    const net = heldFetch()
    const replace = vi.fn()
    const deps = { fetch: net.fn as unknown as typeof fetch, replace, path: '/local' }
    const target = new EventTarget()
    installUnauthorizedHandler(target, (req) => { void land(req, deps) })
    installRestoreHandler(target, deps)

    fire(target, A)
    await tick()
    expect(net.cookieServers()).toEqual(['two.example'])

    // Restored with B's cookie write still pending.
    target.dispatchEvent(pageshow(true))
    expect(activeUserKey.value).toBe(B)
    await tick()
    expect(net.cookieServers()).toEqual(['two.example', 'two.example'])

    fire(target, B)
    expect(activeUserKey.value).toBe(C)

    await net.release(1)
    expect(net.cookieServers()).toEqual(['two.example', 'two.example', 'three.example'])
    // The old landing's write finishes late: it writes and navigates nothing.
    await net.release(0)
    expect(net.cookieServers()).toHaveLength(3)
    expect(replace).not.toHaveBeenCalled()

    await net.release(2)
    expect(replace).toHaveBeenCalledOnce()
    expect(replace).toHaveBeenCalledWith('/local')
  })

  it('a restore after the landing navigated starts nothing', async () => {
    store([A, 'one.example'], [B, 'two.example'])
    const net = heldFetch()
    const replace = vi.fn()
    const deps = { fetch: net.fn as unknown as typeof fetch, replace, path: '/local' }
    const target = new EventTarget()
    installUnauthorizedHandler(target, (req) => { void land(req, deps) })
    installRestoreHandler(target, deps)
    fire(target, A)
    await tick()
    await net.release(0)
    expect(replace).toHaveBeenCalledOnce()
    target.dispatchEvent(pageshow(true))
    await tick()
    expect(net.calls).toHaveLength(1)
    expect(replace).toHaveBeenCalledOnce()
  })
})

// The account menu's switch is a transition too. While another one runs, the
// active account may already be one the reader did not pick, and the page is
// about to leave: a switch does nothing, and a switch blocks a Sign out.
describe('a switch from the account menu during a landing (phase 2)', () => {
  function mountForm(): HTMLFormElement {
    const wrapper = document.createElement('caribou-signout-form')
    const form = document.createElement('form')
    form.setAttribute('action', '/api/signout')
    wrapper.appendChild(form)
    document.body.appendChild(wrapper)
    return form
  }
  const submit = (form: HTMLFormElement) =>
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))

  function spies() {
    history.replaceState(null, '', '/local')
    const net = heldFetch()
    vi.spyOn(globalThis, 'fetch').mockImplementation(net.fn as unknown as typeof fetch)
    const replace = vi.spyOn(location, 'replace').mockImplementation(() => {})
    return { net, replace }
  }

  it('during a sign-out POST: does nothing; the sign-out lands as the next account', async () => {
    store([A, 'one.example'], [B, 'two.example'], [C, 'three.example'])
    const { net, replace } = spies()

    submit(mountForm())
    expect(activeUserKey.value).toBe(B)
    expect(await switchToAccount(C)).toBe(false)
    expect(activeUserKey.value).toBe(B)

    await net.release(0)
    expect(net.cookieServers()).toEqual(['two.example'])
    await net.release(1)
    expect(replace).toHaveBeenCalledOnce()
    expect(replace).toHaveBeenCalledWith('/local')
    expect(activeUserKey.value).toBe(B)
    expect([...users.value.keys()]).toEqual([B, C])
  })

  it('during a 401 landing: does nothing', async () => {
    store([A, 'one.example'], [B, 'two.example'], [C, 'three.example'])
    const { net, replace } = spies()
    const target = new EventTarget()
    installUnauthorizedHandler(target, (req) => { void land(req) })

    fire(target, A)
    expect(activeUserKey.value).toBe(B)
    expect(await switchToAccount(C)).toBe(false)
    expect(activeUserKey.value).toBe(B)

    await net.release(0)
    expect(net.cookieServers()).toEqual(['two.example'])
    expect(replace).toHaveBeenCalledOnce()
    expect(replace).toHaveBeenCalledWith('/local')
  })

  it('while its own cookie write is pending: a second switch and a Sign out do nothing', async () => {
    store([A, 'one.example'], [B, 'two.example'], [C, 'three.example'])
    const { net, replace } = spies()

    const first = switchToAccount(B)
    expect(activeUserKey.value).toBe(B)
    expect(await switchToAccount(C)).toBe(false)
    submit(mountForm())
    await tick()

    // Only the switch's cookie write: no sign-out POST.
    expect(net.calls.map((c) => c.url)).toEqual(['/api/instance'])
    expect(activeUserKey.value).toBe(B)
    expect([...users.value.keys()]).toEqual([A, B, C])

    await net.release(0)
    expect(await first).toBe(true)
    expect(replace).toHaveBeenCalledOnce()
    expect(replace).toHaveBeenCalledWith('/local')
  })

  it('after a landing navigated: does nothing', async () => {
    store([A, 'one.example'], [B, 'two.example'], [C, 'three.example'])
    const { net, replace } = spies()

    const first = switchToAccount(B)
    await tick()
    await net.release(0)
    await first
    expect(replace).toHaveBeenCalledOnce()

    expect(await switchToAccount(C)).toBe(false)
    expect(activeUserKey.value).toBe(B)
    expect(net.calls).toHaveLength(1)
    expect(replace).toHaveBeenCalledOnce()
  })
})
