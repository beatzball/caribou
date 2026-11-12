import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toUserKey } from '@beatzball/caribou-auth'
import {
  activeUserKey, addUserSession, blueskyUserKey, users,
  type BlueskySession, type MastodonSession,
} from '@beatzball/caribou-state'
import { fullHandle } from '../caribou-nav-rail.js'
import { land, pathAfterSwitch, resetLanding, switchToAccount } from '../_switch-account.js'
import '../caribou-nav-rail.js'
import '../caribou-settings-account.js'

// Issue #183: account names and landings with a Bluesky account (spec 5.6).

const DID = 'did:plc:aliceaaaaaaaaaaaaaaaaaaa'
const bskyKey = blueskyUserKey(DID)
const mastoKey = toUserKey('bob', 'example.social')

function bsky(): BlueskySession {
  return {
    network: 'bluesky', userKey: bskyKey, did: DID, handle: 'alice.example.com',
    pds: 'https://pds.example.test', generation: 'B1', account: null, createdAt: 1,
  }
}
function masto(): MastodonSession {
  return { userKey: mastoKey, server: 'example.social', token: 'T', vapidKey: 'V', generation: 'M1', account: null, createdAt: 1 }
}

const text = (n: Element | null | undefined) => n?.textContent?.replace(/\s+/g, ' ').trim()
// What a screen reader reads: aria-hidden parts left out.
const name = (n: Element | null | undefined) => {
  if (!n) return undefined
  const copy = n.cloneNode(true) as Element
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove()
  return text(copy)
}

async function mount<T extends HTMLElement>(tag: string): Promise<T> {
  const el = document.createElement(tag) as T & { updateComplete: Promise<boolean> }
  document.body.appendChild(el)
  while (!(await el.updateComplete)) { /* settle */ }
  return el
}

beforeEach(() => {
  resetLanding()
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
})
afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('account names', () => {
  it('fullHandle: @handle for Bluesky, @name@server for Mastodon', () => {
    expect(fullHandle(bsky())).toBe('@alice.example.com')
    expect(fullHandle(masto())).toBe('@bob@example.social')
  })

  it('the rail: each Bluesky row and its sign-out say Bluesky; Mastodon rows as before', async () => {
    addUserSession(masto())
    addUserSession(bsky())
    const el = await mount('caribou-nav-rail')
    const menu = el.shadowRoot!.querySelector('caribou-menu.account')!
    const rows = [...menu.querySelectorAll<HTMLElement>('.account-item')]
    expect(rows.map(name)).toEqual([
      'Signed in as alice.example.com @alice.example.com, Bluesky',
      'Switch to bob @bob@example.social',
    ])
    expect(name(menu.querySelector('caribou-signout-form button'))).toBe('Sign out of @alice.example.com, Bluesky')
    expect(el.shadowRoot!.innerHTML).not.toContain('undefined')
  })

  it('settings: the same names', async () => {
    addUserSession(bsky())
    addUserSession(masto())
    const el = await mount('caribou-settings-account')
    const root = el.shadowRoot!
    expect(name(root.querySelector('.who-acct'))).toBe('@bob@example.social')
    const sw = [...root.querySelectorAll('caribou-button.switch')]
    expect(sw.map(name)).toEqual(['Switch to @alice.example.com, Bluesky'])
    expect(root.innerHTML).not.toContain('undefined')
  })

  it('settings with Bluesky active: its sign-out names the network', async () => {
    addUserSession(bsky())
    const el = await mount('caribou-settings-account')
    expect(name(el.shadowRoot!.querySelector('.who-acct'))).toBe('@alice.example.com, Bluesky')
    expect(name(el.shadowRoot!.querySelector('caribou-signout-form button'))).toBe('Sign out of @alice.example.com, Bluesky')
  })
})

describe('pathAfterSwitch with Bluesky', () => {
  it.each([
    ['/local', true, '/home'],
    ['/public?local=true', true, '/home'],
    ['/local', false, '/local'],
    ['/home', true, '/home'],
    // Bluesky profile and post paths are global (spec 8.4), but only a
    // Bluesky client can read them: kept only when the new account is Bluesky.
    ['/@alice.example.com', true, '/@alice.example.com'],
    ['/@alice.example.com?tab=media', true, '/@alice.example.com?tab=media'],
    ['/@alice.example.com/3mzhabc', true, '/@alice.example.com/3mzhabc'],
    [`/@${DID}/3mzhabc`, true, `/@${DID}/3mzhabc`],
    ['/@alice.example.com?tab=media', false, '/home'],
    [`/@${DID}/3mzhabc`, false, '/home'],
    // A local Mastodon name and a Mastodon post stay per server.
    ['/@carol', true, '/home'],
    ['/@carol@example.social/1099', true, '/home'],
  ] as const)('%s to Bluesky=%s -> %s', (from, toBluesky, to) => {
    expect(pathAfterSwitch(from, true, toBluesky)).toBe(to)
  })
})

describe('landing on a Bluesky account', () => {
  it('a switch from /local goes to /home, and writes no instance cookie', async () => {
    addUserSession(bsky())
    addUserSession(masto())
    const fetch = vi.fn(async () => new Response(null, { status: 204 }))
    const replace = vi.fn()
    expect(await switchToAccount(bskyKey, { fetch: fetch as unknown as typeof globalThis.fetch, replace, path: '/local' })).toBe(true)
    expect(replace).toHaveBeenCalledWith('/home')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a sign-out that leaves a Bluesky account, from /public, goes to /home', async () => {
    addUserSession(bsky())
    addUserSession(masto())
    // The state part of the sign-out: Bluesky is left.
    users.value = new Map([[bskyKey, bsky()]])
    activeUserKey.value = bskyKey
    const replace = vi.fn()
    await land({ from: 'example.social' }, { replace, path: '/public', fetch: vi.fn() as never })
    expect(replace).toHaveBeenCalledWith('/home')
  })
})

describe('session diagnostics rule 1: Settings accounts', () => {
  it('shows a copyable latest safe reason with a Mastodon account active', async () => {
    const { recordSessionEnd, readSessionEnds } = await import('@beatzball/caribou-bluesky-client/session-diagnostics')
    addUserSession(masto())
    recordSessionEnd('sign-out')
    expect(readSessionEnds()).toHaveLength(1)
    const el = await mount('caribou-settings-account')
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector('[data-session-end]')).not.toBeNull())
    const reason = el.shadowRoot!.querySelector('[data-session-end]')
    expect(text(reason)).toContain('Last Bluesky session end')
    expect(text(reason)).toContain('Signed out')
    expect(text(reason)).toContain('online=')
    expect(text(reason)).toContain('visibility=')
  })

  it('shows the last reason without a current account, and updates on a local end', async () => {
    const { recordSessionEnd } = await import('@beatzball/caribou-bluesky-client/session-diagnostics')
    const el = await mount('caribou-settings-account')
    expect(el.shadowRoot!.querySelector('[data-session-end]')).toBeNull()
    recordSessionEnd('sign-out')
    await (el as unknown as { updateComplete: Promise<boolean> }).updateComplete
    expect(text(el.shadowRoot!.querySelector('[data-session-end]'))).toContain('Signed out')
  })
})
