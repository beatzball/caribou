import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toUserKey } from '@beatzball/caribou-auth'
import {
  users, activeUserKey, addUserSession, blueskyUserKey, setBlueskyDriver,
  type BlueskySession, type MastodonSession,
} from '@beatzball/caribou-state'
import { blueskyOAuthConfig, BLUESKY_FLAG_KEY } from '../_bluesky.js'
import * as session from '../_bluesky-session.js'
import { resetLanding } from '../_switch-account.js'
import '../caribou-signin-panels.js'
import '../caribou-landing.js'
import '../caribou-session-expired.js'
import '../caribou-signout-form.js'
import { resetCallbackForTests } from '../caribou-bluesky-callback.js'
import type { CaribouSigninPanels } from '../caribou-signin-panels.js'

const DID = 'did:plc:aliceaaaaaaaaaaaaaaaaaaa'
const bskyKey = blueskyUserKey(DID)
const mastoKey = toUserKey('bob', 'example.social')

function bsky(over: Partial<BlueskySession> = {}): BlueskySession {
  return {
    network: 'bluesky', userKey: bskyKey, did: DID, handle: 'alice.example.com',
    pds: 'https://pds.example.test', generation: 'B1', account: null, createdAt: 1, ...over,
  }
}

function masto(): MastodonSession {
  return { userKey: mastoKey, server: 'example.social', token: 'T', vapidKey: 'V', generation: 'M1', account: null, createdAt: 1 }
}

async function mount<T extends HTMLElement & { updateComplete: Promise<unknown> }>(tag: string): Promise<T> {
  const el = document.createElement(tag) as T
  document.body.appendChild(el)
  await el.updateComplete
  await el.updateComplete
  return el
}

beforeEach(() => {
  resetLanding()
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
  setBlueskyDriver(null)
  resetCallbackForTests()
})

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('blueskyOAuthConfig: the client id comes from one place', () => {
  it('a loopback host uses the loopback client, redirecting to the IP form', () => {
    const c = blueskyOAuthConfig('http://localhost:3182')
    const id = new URL(c.clientId)
    expect(id.origin).toBe('http://localhost')
    expect(id.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:3182/signin/bluesky')
    expect(id.searchParams.get('scope')).toBe('atproto transition:generic')
    expect(c.handleResolver).toBe('http://localhost:3182')
  })

  it('[::1] is a loopback host too', () => {
    expect(new URL(blueskyOAuthConfig('http://[::1]:3182').clientId).searchParams.get('redirect_uri'))
      .toBe('http://127.0.0.1:3182/signin/bluesky')
  })

  it('a public host uses the client metadata document on its own origin', () => {
    expect(blueskyOAuthConfig('https://caribou.example.com')).toEqual({
      clientId: 'https://caribou.example.com/oauth/client-metadata.json',
      handleResolver: 'https://caribou.example.com',
    })
  })
})

describe('caribou-signin-panels: the ARIA tabs pattern', () => {
  function parts(el: CaribouSigninPanels) {
    const root = el.shadowRoot!
    const tabs = [...root.querySelectorAll<HTMLElement>('[role="tab"]')]
    const panels = [...root.querySelectorAll<HTMLElement>('[role="tabpanel"]')]
    return { root, tabs, panels }
  }

  it('a tablist with two tabs, each tied to its panel', async () => {
    const el = await mount<CaribouSigninPanels>('caribou-signin-panels')
    const { root, tabs, panels } = parts(el)
    expect(root.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Network')
    expect(tabs.map((t) => t.textContent)).toEqual(['Mastodon', 'Bluesky'])
    for (const [i, t] of tabs.entries()) {
      expect(t.getAttribute('aria-controls')).toBe(panels[i]!.id)
      expect(panels[i]!.getAttribute('aria-labelledby')).toBe(t.id)
    }
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false'])
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1'])
    expect(panels.map((p) => p.hidden)).toEqual([false, true])
    // Each panel holds a form, so the panel itself is not a tab stop.
    expect(panels.map((p) => p.hasAttribute('tabindex'))).toEqual([false, false])
  })

  it('arrow keys move, wrap and select; Home and End go to the ends', async () => {
    const el = await mount<CaribouSigninPanels>('caribou-signin-panels')
    const key = async (k: string) => {
      const { tabs } = parts(el)
      const target = tabs.find((t) => t.getAttribute('aria-selected') === 'true')!
      const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
      target.dispatchEvent(e)
      await el.updateComplete
      await el.updateComplete
      expect(e.defaultPrevented).toBe(true)
      return parts(el)
    }
    let p = await key('ArrowRight')
    expect(p.tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true'])
    expect(p.tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '0'])
    expect(p.panels.map((x) => x.hidden)).toEqual([true, false])
    expect(p.root.activeElement).toBe(p.tabs[1])
    p = await key('ArrowRight')
    expect(p.tabs[0]!.getAttribute('aria-selected')).toBe('true')
    p = await key('ArrowLeft')
    expect(p.tabs[1]!.getAttribute('aria-selected')).toBe('true')
    p = await key('Home')
    expect(p.tabs[0]!.getAttribute('aria-selected')).toBe('true')
    p = await key('End')
    expect(p.tabs[1]!.getAttribute('aria-selected')).toBe('true')
  })

  it('a click selects', async () => {
    const el = await mount<CaribouSigninPanels>('caribou-signin-panels')
    parts(el).tabs[1]!.click()
    await el.updateComplete
    expect(parts(el).panels[1]!.hidden).toBe(false)
    expect(parts(el).panels[1]!.querySelector('caribou-bluesky-signin')).toBeTruthy()
  })
})

describe('caribou-landing and the flag', () => {
  it('flag off: the Mastodon form alone, as before', async () => {
    const el = await mount<HTMLElement & { updateComplete: Promise<unknown> }>('caribou-landing')
    expect(el.shadowRoot!.querySelector('caribou-signin-panels')).toBeNull()
    expect(el.shadowRoot!.querySelector('caribou-instance-picker')).toBeTruthy()
    expect(el.shadowRoot!.textContent).toContain('A Mastodon client.')
  })

  it('flag on: the two panels', async () => {
    localStorage.setItem(BLUESKY_FLAG_KEY, '1')
    const el = await mount<HTMLElement & { updateComplete: Promise<unknown> }>('caribou-landing')
    expect(el.shadowRoot!.querySelector('caribou-signin-panels')).toBeTruthy()
  })
})

describe('caribou-bluesky-signin', () => {
  it('shows the message a failed start answers', async () => {
    const start = vi.spyOn(session, 'startBlueskySignIn').mockResolvedValue('Bluesky sign-in needs site storage.')
    const el = await mount<HTMLElement & { updateComplete: Promise<unknown> }>('caribou-bluesky-signin')
    const input = el.shadowRoot!.querySelector<HTMLInputElement>('input[name="handle"]')!
    input.value = ' alice.example.com '
    el.shadowRoot!.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', { cancelable: true }))
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain('site storage'))
    expect(start).toHaveBeenCalledWith('alice.example.com')
  })
})

describe('caribou-bluesky-callback', () => {
  it('finishes once and goes home', async () => {
    const finish = vi.spyOn(session, 'finishBlueskySignIn').mockResolvedValue(bskyKey)
    const replace = vi.spyOn(location, 'replace').mockImplementation(() => {})
    const el = await mount<HTMLElement & { updateComplete: Promise<unknown>; requestUpdate(): void }>('caribou-bluesky-callback')
    el.requestUpdate()
    await el.updateComplete
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/home'))
    expect(finish).toHaveBeenCalledTimes(1)
  })

  it('a failure says why and links back; nothing navigates', async () => {
    vi.spyOn(session, 'finishBlueskySignIn').mockRejectedValue(new Error('You signed in to another account than the one you entered. Nothing was saved. Try again.'))
    const replace = vi.spyOn(location, 'replace').mockImplementation(() => {})
    const el = await mount<HTMLElement & { updateComplete: Promise<unknown> }>('caribou-bluesky-callback')
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain('another account'))
    expect(el.shadowRoot!.querySelector('a[href="/"]')).toBeTruthy()
    expect(replace).not.toHaveBeenCalled()
  })
})

describe('caribou-session-expired', () => {
  it('shows only for an expired active Bluesky session, and follows the state', async () => {
    addUserSession(masto())
    addUserSession(bsky())
    const el = await mount<HTMLElement & { updateComplete: Promise<unknown> }>('caribou-session-expired')
    expect(el.shadowRoot!.textContent?.trim()).toBe('')
    users.value = new Map(users.value).set(bskyKey, { ...bsky(), expired: true })
    await el.updateComplete
    expect(el.shadowRoot!.textContent).toContain('Your Bluesky session ended. Sign in again.')
    activeUserKey.value = mastoKey
    await el.updateComplete
    expect(el.shadowRoot!.textContent?.trim()).toBe('')
  })

  it('Sign in again starts a sign-in for the same DID', async () => {
    const start = vi.spyOn(session, 'startBlueskySignIn').mockResolvedValue('Could not sign in to Bluesky.')
    addUserSession(bsky())
    users.value = new Map(users.value).set(bskyKey, { ...bsky(), expired: true })
    const el = await mount<HTMLElement & { updateComplete: Promise<unknown> }>('caribou-session-expired')
    await el.updateComplete
    el.shadowRoot!.querySelector<HTMLElement>('caribou-button')!.click()
    await vi.waitFor(() => expect(start).toHaveBeenCalledWith(DID))
  })
})

describe('caribou-signout-form with a Bluesky account', () => {
  it('revokes through the driver, never posts /api/signout, and lands as the Mastodon account', async () => {
    const signOut = vi.fn(async () => {})
    setBlueskyDriver({ ...session.blueskyDriver, signOut })
    addUserSession(masto())
    addUserSession(bsky())
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    const replace = vi.spyOn(location, 'replace').mockImplementation(() => {})
    const wrapper = document.createElement('caribou-signout-form')
    const form = document.createElement('form')
    form.setAttribute('action', '/api/signout')
    wrapper.appendChild(form)
    document.body.appendChild(wrapper)
    await (wrapper as unknown as { updateComplete: Promise<unknown> }).updateComplete
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(replace).toHaveBeenCalled())
    expect(signOut).toHaveBeenCalledWith(DID)
    expect(users.value.has(bskyKey)).toBe(false)
    expect(activeUserKey.value).toBe(mastoKey)
    const urls = fetchSpy.mock.calls.map(([u]) => String(u))
    expect(urls).not.toContain('/api/signout')
    expect(urls.some((u) => u.endsWith('/api/signout'))).toBe(false)
    expect(fetchSpy.mock.calls.find(([u]) => String(u) === '/api/instance')?.[1]).toMatchObject({ body: '{"server":"example.social"}' })
  })
})

describe('loopback hosts other than 127.0.0.1', () => {
  const happyDOM = (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM
  afterEach(() => { happyDOM.setURL('http://localhost:3000/') })

  it.each(['http://localhost:3182/', 'http://[::1]:3182/'])('%s: says to open 127.0.0.1, sends nothing', async (url) => {
    happyDOM.setURL(url)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await session.startBlueskySignIn('alice.example.com')).toBe('Open Caribou at http://127.0.0.1:3182 to sign in to Bluesky.')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('the callback page does not load an account while it leaves', () => {
  it('loadsAccountOn', () => {
    expect(session.loadsAccountOn('/signin/bluesky')).toBe(false)
    expect(session.loadsAccountOn('/home')).toBe(true)
  })
})
