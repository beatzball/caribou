import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { html, render } from 'lit'
import type { mastodon } from 'masto'
import { toUserKey } from '@beatzball/caribou-auth'
import {
  _testOnlyResetMutations, activeClient, activeUserKey, addUserSession, cacheStatus,
  statusCache, users,
} from '@beatzball/caribou-state'
import '../caribou-status-card.js'
import '../caribou-app-shell.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'

type Status = mastodon.v1.Status

function post(over: Record<string, unknown> = {}): Status {
  return {
    id: '7',
    content: '<p>hello</p>',
    visibility: 'public',
    account: { id: '42', acct: 'bob', username: 'bob', displayName: 'Bob', avatar: '', avatarStatic: '' },
    createdAt: '2026-04-28T12:00:00Z',
    favourited: false, favouritesCount: 3,
    reblogged: false, reblogsCount: 2,
    bookmarked: false, repliesCount: 1,
    ...over,
  } as unknown as Status
}

function signIn(server = 'example.social', accountId = 'me') {
  addUserSession({
    userKey: toUserKey('alice', server),
    server, token: 't', vapidKey: '', createdAt: 0,
    account: { id: accountId, acct: 'alice', username: 'alice' } as mastodon.v1.Account,
  })
}

async function mount(status: Status, instance?: string): Promise<CaribouStatusCard> {
  const el = document.createElement('caribou-status-card') as CaribouStatusCard
  el.status = status
  if (instance !== undefined) el.instance = instance
  document.body.appendChild(el)
  while (!(await el.updateComplete)) { /* settle the post-mount render */ }
  return el
}

function button(el: CaribouStatusCard, cls: string): HTMLButtonElement {
  return el.shadowRoot!.querySelector<HTMLButtonElement>(`.actions button.${cls}`)!
}

beforeEach(() => {
  document.body.replaceChildren()
  statusCache.value = new Map()
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
  _testOnlyResetMutations()
})
afterEach(() => { vi.restoreAllMocks() })

describe('<caribou-status-card> action bar', () => {
  it('renders four buttons with counts and pressed state from the status', async () => {
    const el = await mount(post({ favourited: true, bookmarked: true }))
    const fav = button(el, 'favourite')
    expect(fav.getAttribute('aria-pressed')).toBe('true')
    expect(fav.getAttribute('aria-label')).toBe('Unfavourite')
    expect(fav.textContent?.trim()).toBe('3')
    expect(button(el, 'boost').getAttribute('aria-label')).toBe('Boost')
    expect(button(el, 'boost').textContent?.trim()).toBe('2')
    expect(button(el, 'reply').textContent?.trim()).toBe('1')
    expect(button(el, 'bookmark').getAttribute('aria-label')).toBe('Remove bookmark')
    expect(button(el, 'bookmark').getAttribute('aria-pressed')).toBe('true')
    expect(button(el, 'reply').hasAttribute('aria-pressed')).toBe(false)
  })

  it('hides a zero count', async () => {
    const el = await mount(post({ favouritesCount: 0 }))
    expect(button(el, 'favourite').querySelector('.count')).toBeNull()
  })

  it('without a client every button is aria-disabled with a sign-in hint, and a click does nothing', async () => {
    const el = await mount(post())
    for (const cls of ['reply', 'boost', 'favourite', 'bookmark']) {
      expect(button(el, cls).getAttribute('aria-disabled')).toBe('true')
    }
    expect(button(el, 'favourite').title).toBe('Sign in to favourite')
    const compose = vi.fn()
    window.addEventListener('caribou:compose', compose)
    button(el, 'favourite').click()
    button(el, 'reply').click()
    window.removeEventListener('caribou:compose', compose)
    await el.updateComplete
    expect(compose).not.toHaveBeenCalled()
    expect(button(el, 'favourite').getAttribute('aria-pressed')).toBe('false')
  })

  it('stays disabled when the client is on another instance', async () => {
    signIn('other.example')
    const el = await mount(post(), 'example.social')
    expect(button(el, 'favourite').getAttribute('aria-disabled')).toBe('true')
  })

  it('reads the instance off the enclosing app shell', async () => {
    signIn('other.example')
    const host = document.createElement('div')
    document.body.appendChild(host)
    render(html`<caribou-app-shell instance="example.social"><caribou-status-card .status=${post()}></caribou-status-card></caribou-app-shell>`, host)
    const el = host.querySelector('caribou-status-card') as CaribouStatusCard
    while (!(await el.updateComplete)) { /* settle */ }
    expect(button(el, 'favourite').getAttribute('aria-disabled')).toBe('true')
  })

  it('matches the instance case-insensitively and enables the bar', async () => {
    signIn('Example.Social')
    const el = await mount(post(), 'example.social')
    expect(button(el, 'favourite').getAttribute('aria-disabled')).toBe('false')
    expect(button(el, 'favourite').hasAttribute('title')).toBe(false)
  })

  it('favourite click flips the button at once and calls the client', async () => {
    signIn()
    const s = post()
    cacheStatus(s)
    const favourite = vi.spyOn(activeClient.value!, 'favourite')
      .mockResolvedValue(post({ favourited: true, favouritesCount: 4 }))
    const el = await mount(s)
    button(el, 'favourite').click()
    await el.updateComplete
    expect(favourite).toHaveBeenCalledWith('7')
    expect(button(el, 'favourite').getAttribute('aria-pressed')).toBe('true')
    expect(button(el, 'favourite').getAttribute('aria-label')).toBe('Unfavourite')
    expect(button(el, 'favourite').textContent?.trim()).toBe('4')
  })

  it('shows cache updates even when the parent keeps the old .status object', async () => {
    signIn()
    const s = post()
    cacheStatus(s)
    const el = await mount(s)
    cacheStatus(post({ bookmarked: true }))
    await el.updateComplete
    expect(button(el, 'bookmark').getAttribute('aria-pressed')).toBe('true')
  })

  it('bookmark and boost clicks call the client with the inner post of a wrapper', async () => {
    signIn()
    const wrapper = post({ id: 'w', reblog: post(), account: { id: '9', acct: 'carol', username: 'carol', avatar: '', avatarStatic: '' } })
    cacheStatus(wrapper)
    const bookmark = vi.spyOn(activeClient.value!, 'bookmark').mockResolvedValue(post({ bookmarked: true }))
    const reblog = vi.spyOn(activeClient.value!, 'reblog').mockResolvedValue(post({ reblogged: true, reblogsCount: 3 }))
    const el = await mount(wrapper)
    button(el, 'bookmark').click()
    button(el, 'boost').click()
    await el.updateComplete
    expect(bookmark).toHaveBeenCalledWith('7')
    expect(reblog).toHaveBeenCalledWith('7')
    expect(button(el, 'boost').getAttribute('aria-label')).toBe('Undo boost')
  })

  it('reply dispatches caribou:compose with the inner post', async () => {
    signIn()
    const inner = post()
    const el = await mount(post({ id: 'w', reblog: inner }))
    const compose = vi.fn()
    window.addEventListener('caribou:compose', compose)
    button(el, 'reply').click()
    window.removeEventListener('caribou:compose', compose)
    expect(compose).toHaveBeenCalledOnce()
    expect((compose.mock.calls[0]![0] as CustomEvent).detail).toEqual({ inReplyTo: inner })
  })

  it('disables boost on a direct post, even your own', async () => {
    signIn('example.social', '42')
    const el = await mount(post({ visibility: 'direct' }))
    const boost = button(el, 'boost')
    expect(boost.getAttribute('aria-disabled')).toBe('true')
    expect(boost.title).toBe('This post cannot be boosted')
    const reblog = vi.spyOn(activeClient.value!, 'reblog')
    boost.click()
    expect(reblog).not.toHaveBeenCalled()
  })

  it('disables boost on a followers-only post by someone else', async () => {
    signIn()
    const el = await mount(post({ visibility: 'private' }))
    expect(button(el, 'boost').getAttribute('aria-disabled')).toBe('true')
    expect(button(el, 'favourite').getAttribute('aria-disabled')).toBe('false')
  })

  it('allows boosting your own followers-only post', async () => {
    signIn('example.social', '42')
    const el = await mount(post({ visibility: 'private' }))
    expect(button(el, 'boost').getAttribute('aria-disabled')).toBe('false')
  })

  it('re-enables after sign-in without a remount', async () => {
    const el = await mount(post())
    expect(button(el, 'favourite').getAttribute('aria-disabled')).toBe('true')
    signIn()
    await el.updateComplete
    expect(button(el, 'favourite').getAttribute('aria-disabled')).toBe('false')
  })

  it('a new .status replaces the cached fields of the old one', async () => {
    signIn()
    cacheStatus(post({ favourited: true }))
    const el = await mount(post())
    expect(button(el, 'favourite').getAttribute('aria-pressed')).toBe('true')
    el.status = post({ id: '8', favouritesCount: 0 })
    await el.updateComplete
    expect(button(el, 'favourite').getAttribute('aria-pressed')).toBe('false')
  })

  it('stops listening after it leaves the DOM and resumes when it comes back', async () => {
    signIn()
    cacheStatus(post())
    const el = await mount(post())
    el.remove()
    cacheStatus(post({ bookmarked: true }))
    await el.updateComplete
    expect(button(el, 'bookmark').getAttribute('aria-pressed')).toBe('false')
    document.body.appendChild(el)
    await el.updateComplete
    expect(button(el, 'bookmark').getAttribute('aria-pressed')).toBe('true')
  })
})
