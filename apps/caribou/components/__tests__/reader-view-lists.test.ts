import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, Status } from '@beatzball/caribou-mastodon-client'
import { toUserKey } from '@beatzball/caribou-auth'
import {
  activeClient, activeUserKey, addUserSession, clearKeptAlive, postRecords, readerChecks, statusCache, users,
} from '@beatzball/caribou-state'
import '../caribou-app-shell.js'
import '../caribou-timeline.js'
import '../caribou-thread.js'
import '../caribou-profile.js'
import type { CaribouTimeline } from '../caribou-timeline.js'
import type { CaribouThread } from '../caribou-thread.js'
import type { CaribouProfile } from '../caribou-profile.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'

// The server renders these lists from a fetch with no token, so the posts
// carry none of the reader's filters. Signed in to the same server, the
// list asks for the reader's copies, and a hide filter then applies.


const ACCT = { id: 'a1', acct: 'bob', username: 'bob', displayName: 'Bob', avatar: '', avatarStatic: '' }
const HIDE = [{ filter: { id: 'f', title: 'Spoilers', context: ['public', 'thread', 'account'], filterAction: 'hide' } }]

const post = (id: string, over: Record<string, unknown> = {}) => ({
  id, uri: `https://example.social/statuses/${id}`, content: `<p>${id}</p>`, createdAt: '2026-04-28T12:00:00Z',
  visibility: 'public', account: ACCT, ...over,
}) as unknown as Status

function signIn(server = 'example.social') {
  addUserSession({
    userKey: toUserKey('alice', server), server, token: 't', vapidKey: '', createdAt: 0,
    account: { id: 'me', acct: 'alice', username: 'alice' } as Account,
  })
  const client = activeClient.value!
  return vi.spyOn(client, 'fetchStatuses').mockImplementation(async (ids) => ids.map((id) => post(id, { filtered: HIDE })))
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

async function inShell<T extends HTMLElement & { updateComplete: Promise<boolean> }>(el: T, instance: string): Promise<T> {
  const shell = document.createElement('caribou-app-shell')
  shell.setAttribute('instance', instance)
  shell.appendChild(el)
  document.body.appendChild(shell)
  for (let i = 0; i < 4; i++) { await flush(); await el.updateComplete }
  return el
}

function cards(root: HTMLElement): CaribouStatusCard[] {
  return [...root.shadowRoot!.querySelectorAll<CaribouStatusCard>('caribou-status-card')]
}

beforeEach(() => {
  document.body.replaceChildren()
  statusCache.value = new Map()
  postRecords.value = new Map()
  readerChecks.value = new Map()
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
  clearKeptAlive()
  // The outlet the router marks once a full load has settled.
  const outlet = document.createElement('litro-outlet')
  outlet.setAttribute('data-litro-settled', '')
  document.body.appendChild(outlet)
})
afterEach(() => { vi.restoreAllMocks() })

describe('lists ask for the reader\'s view of server-rendered posts', () => {
  it('timeline: same server — asks, and a hide filter removes the post', async () => {
    const fetch = signIn()
    const tl = document.createElement('caribou-timeline') as CaribouTimeline
    tl.kind = 'local'
    tl.initial = { statuses: [post('1'), post('2')], nextCursor: null }
    await inShell(tl, 'example.social')
    expect(fetch).toHaveBeenCalledWith(['1', '2'])
    expect(cards(tl).every((c) => c.hasAttribute('hidden'))).toBe(true)
  })

  it('timeline: another server — does not ask, ids mean nothing there', async () => {
    const fetch = signIn('other.example')
    const tl = document.createElement('caribou-timeline') as CaribouTimeline
    tl.kind = 'public'
    tl.initial = { statuses: [post('1')], nextCursor: null }
    await inShell(tl, 'example.social')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('timeline: signed out — does not ask', async () => {
    const tl = document.createElement('caribou-timeline') as CaribouTimeline
    tl.kind = 'local'
    tl.initial = { statuses: [post('1')], nextCursor: null }
    await inShell(tl, 'example.social')
    expect(cards(tl)[0]!.hasAttribute('hidden')).toBe(false)
  })

  it('thread: asks for ancestors, the main post and replies; the main post warns', async () => {
    const fetch = signIn()
    const th = document.createElement('caribou-thread') as CaribouThread
    th.statusId = '2'
    th.initial = { ancestors: [post('1')], focused: post('2'), descendants: [post('3', { inReplyToId: '2' })] }
    await inShell(th, 'example.social')
    expect(fetch).toHaveBeenCalledWith(['1', '2', '3'])
    const [a, f, d] = cards(th)
    expect(a!.hasAttribute('hidden')).toBe(true)
    expect(d!.hasAttribute('hidden')).toBe(true)
    expect(f!.hasAttribute('hidden')).toBe(false)
    expect(f!.shadowRoot!.querySelector('.notice p')!.textContent).toBe('Hidden by filter: Spoilers')
  })

  it('profile: asks when the profile is from the reader\'s server', async () => {
    const fetch = signIn()
    const pr = document.createElement('caribou-profile') as CaribouProfile
    pr.handle = 'bob@example.social'
    pr.instance = 'example.social'
    pr.initial = {
      account: { ...ACCT, note: '', followersCount: 0, followingCount: 0, statusesCount: 1 } as unknown as Account,
      statuses: [post('1')], nextCursor: null, tab: 'posts',
    }
    await inShell(pr, 'example.social')
    expect(fetch).toHaveBeenCalledWith(['1'])
  })

  // The server's copy has no reader filters. Until the reader's copy is in,
  // the card keeps the post hidden (the head script hid it before the app
  // ran); a post whose copy never comes stays covered by a note.
  const veil = (c: CaribouStatusCard) => c.style.getPropertyValue('--caribou-reader-veil')
  // The post's own text, when it is on screen: not hidden by the veil and
  // not in a closed region.
  const content = (c: CaribouStatusCard) =>
    veil(c) === 'hidden' ? null : c.shadowRoot!.querySelector('.status-content')

  function held() {
    let resolve!: (v: Status[]) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<Status[]>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  async function timelineWith(statuses: Status[]) {
    const tl = document.createElement('caribou-timeline') as CaribouTimeline
    tl.kind = 'local'
    tl.initial = { statuses, nextCursor: null }
    return inShell(tl, 'example.social')
  }

  it('while the reader\'s copy is out the post stays hidden; a hide filter then removes it, a clean copy shows it', async () => {
    signIn()
    const d = held()
    vi.mocked(activeClient.value!.fetchStatuses).mockReturnValue(d.promise)
    const tl = await timelineWith([post('1'), post('2')])
    const [one, two] = cards(tl)
    // In the window: no post content anywhere, only the note.
    for (const c of [one!, two!]) {
      expect(content(c)).toBeNull()
      expect(c.shadowRoot!.querySelector('.notice p')!.textContent).toBe('Checking this post against your filters…')
    }
    d.resolve([post('1', { filtered: HIDE }), post('2', { filtered: [] })])
    for (let i = 0; i < 3; i++) { await flush(); await tl.updateComplete }
    expect(one!.hasAttribute('hidden')).toBe(true)
    expect(veil(two!)).toBe('visible')
    expect(two!.shadowRoot!.querySelector('.status-content')!.textContent).toBe('2')
  })

  it('a failed request covers each post with a note, Show and Retry; Retry that works shows it', async () => {
    signIn()
    vi.mocked(activeClient.value!.fetchStatuses).mockRejectedValueOnce(new Error('boom'))
    const tl = await timelineWith([post('1')])
    const [c] = cards(tl)
    await c!.updateComplete
    expect(veil(c!)).toBe('visible')
    expect(c!.shadowRoot!.querySelector('.notice p')!.textContent).toBe('Could not check this post against your filters.')
    expect(c!.shadowRoot!.querySelector('.status-content')).toBeNull()
    expect(c!.shadowRoot!.querySelector('button.filter-toggle')!.getAttribute('aria-label'))
      .toBe('Show post not checked against your filters')
    vi.mocked(activeClient.value!.fetchStatuses).mockResolvedValueOnce([post('1', { filtered: [] })])
    c!.shadowRoot!.querySelector<HTMLElement>('caribou-button.retry')!.click()
    for (let i = 0; i < 3; i++) { await flush(); await c!.updateComplete }
    expect(c!.shadowRoot!.querySelector('.status-content')!.textContent).toBe('1')
    expect(c!.shadowRoot!.activeElement).toBe(c!.shadowRoot!.querySelector('article'))
  })

  it('a post the server leaves out of its answer stays covered', async () => {
    signIn()
    vi.mocked(activeClient.value!.fetchStatuses).mockResolvedValueOnce([post('1', { filtered: [] })])
    const tl = await timelineWith([post('1'), post('2')])
    const [one, two] = cards(tl)
    await two!.updateComplete
    expect(one!.shadowRoot!.querySelector('.status-content')).not.toBeNull()
    expect(two!.shadowRoot!.querySelector('.status-content')).toBeNull()
    expect(two!.shadowRoot!.querySelector('.notice p')!.textContent).toBe('Could not check this post against your filters.')
  })

  it('signed out, the card shows its post at once', async () => {
    const tl = await timelineWith([post('1')])
    expect(veil(cards(tl)[0]!)).toBe('visible')
  })

  it('Retry keeps the note and its busy button, focused, with no post content, until the answer is in', async () => {
    signIn()
    vi.mocked(activeClient.value!.fetchStatuses).mockRejectedValueOnce(new Error('boom'))
    const tl = await timelineWith([post('1')])
    const [c] = cards(tl)
    await c!.updateComplete
    const retry = c!.shadowRoot!.querySelector<HTMLElement>('caribou-button.retry')!
    const d = held()
    vi.mocked(activeClient.value!.fetchStatuses).mockReturnValueOnce(d.promise)
    retry.focus()
    retry.click()
    for (let i = 0; i < 3; i++) { await flush(); await c!.updateComplete }
    expect(content(c!)).toBeNull()
    expect(c!.shadowRoot!.querySelector('caribou-button.retry')).toBe(retry)
    expect(retry.hasAttribute('loading')).toBe(true)
    expect(c!.shadowRoot!.activeElement).toBe(retry)
    d.resolve([post('1', { filtered: HIDE })])
    for (let i = 0; i < 3; i++) { await flush(); await c!.updateComplete }
    expect(c!.hasAttribute('hidden')).toBe(true)
  })

  it('Show reveals a post still being checked; a hide that arrives then still removes it', async () => {
    signIn()
    const d = held()
    vi.mocked(activeClient.value!.fetchStatuses).mockReturnValue(d.promise)
    const tl = await timelineWith([post('1')])
    const [c] = cards(tl)
    c!.shadowRoot!.querySelector<HTMLElement>('button.filter-toggle')!.click()
    await c!.updateComplete
    expect(content(c!)!.textContent).toBe('1')
    d.resolve([post('1', { filtered: HIDE })])
    for (let i = 0; i < 3; i++) { await flush(); await c!.updateComplete }
    expect(c!.hasAttribute('hidden')).toBe(true)
  })

  it('A → B → A: the first A answer, coming back late, does not uncover a post the new check still holds', async () => {
    signIn()
    const first = held()
    vi.mocked(activeClient.value!.fetchStatuses).mockReturnValueOnce(first.promise)
    const tl = await timelineWith([post('1')])
    const [c] = cards(tl)
    const aClient = activeClient.value!
    signIn('other.example')
    activeUserKey.value = toUserKey('alice', 'example.social')
    expect(activeClient.value!).not.toBe(aClient)
    const second = held()
    vi.spyOn(activeClient.value!, 'fetchStatuses').mockReturnValueOnce(second.promise)
    const { loadReaderView } = await import('@beatzball/caribou-state')
    const again = loadReaderView([post('1')], activeClient.value!)
    first.resolve([post('1', { filtered: [] })])
    for (let i = 0; i < 3; i++) { await flush(); await c!.updateComplete }
    expect(content(c!)).toBeNull()
    second.resolve([post('1', { filtered: HIDE })])
    await again
    for (let i = 0; i < 3; i++) { await flush(); await c!.updateComplete }
    expect(c!.hasAttribute('hidden')).toBe(true)
  })
})
