import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import type * as MastodonClient from '@beatzball/caribou-mastodon-client'
import { CaribouError } from '@beatzball/caribou-mastodon-client'
import type { CaribouSearch as El } from '../caribou-search.js'
import {
  activeClient, activeUserKey, addUserSession, relationshipCache, users, type UserSession,
} from '@beatzball/caribou-state'

const searchPublic = vi.hoisted(() => vi.fn())
vi.mock('@beatzball/caribou-mastodon-client', async (orig) => ({
  ...(await orig<typeof MastodonClient>()),
  searchPublic,
}))

await import('../caribou-search.js')

const account = (id: string, acct: string) => ({
  id, acct, username: acct.split('@')[0], displayName: acct.toUpperCase(),
  avatar: '', avatarStatic: '', url: `https://other.social/@${acct}`, uri: `https://other.social/users/${acct}`,
}) as unknown as mastodon.v1.Account

const status = (id: string) => ({
  id, uri: `https://other.social/users/bob/statuses/${id}`, url: `https://other.social/@bob/${id}`,
  content: `<p>post ${id}</p>`, account: account('2', 'bob@other.social'), createdAt: '2024-01-01T00:00:00.000Z',
  mediaAttachments: [], mentions: [], tags: [], emojis: [], spoilerText: '',
  reblogsCount: 0, favouritesCount: 0, repliesCount: 0,
}) as unknown as mastodon.v1.Status

const result = (over: Partial<mastodon.v2.Search> = {}): mastodon.v2.Search =>
  ({ accounts: [], statuses: [], hashtags: [], ...over })

function signIn() {
  addUserSession({
    userKey: 'me@home.social', server: 'home.social', token: 'TOKEN', vapidKey: '',
    account: { id: '1', acct: 'me' }, createdAt: 1,
  } as unknown as UserSession)
  return activeClient.value!
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

async function mount(props: { q?: string; type?: 'accounts' | 'hashtags' | 'statuses'; instance?: string } = {}): Promise<El> {
  const el = document.createElement('caribou-search') as El
  el.q = props.q ?? ''
  el.type = props.type ?? 'accounts'
  el.instance = props.instance ?? ''
  document.body.appendChild(el)
  await el.updateComplete
  await flush()
  await el.updateComplete
  return el
}

const text = (el: El) => el.shadowRoot!.querySelector('.results')!.textContent!.replace(/\s+/g, ' ').trim()
const accts = (el: El) => [...el.shadowRoot!.querySelectorAll('.account .acct')].map((n) => n.textContent)

beforeEach(() => {
  history.replaceState(null, '', '/search')
})

afterEach(() => {
  document.body.replaceChildren()
  activeUserKey.value = null
  users.value = new Map()
  relationshipCache.value = new Map()
  localStorage.clear()
  searchPublic.mockReset()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('<caribou-search>', () => {
  // The server does not know who reads; its render and the first client
  // render must be the same.
  it('first renders "Searching…" for a query and a hint without one', async () => {
    const el = document.createElement('caribou-search') as El
    el.q = 'cats'
    document.body.appendChild(el)
    await el.updateComplete
    expect(text(el)).toBe('Searching…')
    const empty = document.createElement('caribou-search') as El
    document.body.appendChild(empty)
    await empty.updateComplete
    expect(text(empty)).toBe('Search for people, hashtags and posts.')
  })

  it('marks the tab from the address and links each tab to its address', async () => {
    searchPublic.mockResolvedValue(result())
    const el = await mount({ q: 'cats', type: 'hashtags', instance: 'pub.social' })
    const tabs = [...el.shadowRoot!.querySelectorAll('.tabs a')]
    expect(tabs.map((a) => a.textContent)).toEqual(['People', 'Hashtags', 'Posts'])
    expect(tabs.map((a) => a.getAttribute('href'))).toEqual([
      '/search?q=cats', '/search?q=cats&type=hashtags', '/search?q=cats&type=statuses',
    ])
    expect(tabs[1]!.getAttribute('aria-current')).toBe('page')
  })

  it('searches as the signed-in reader, with resolve for an address', async () => {
    const client = signIn()
    const search = vi.spyOn(client, 'search').mockResolvedValue(result({ accounts: [account('2', 'bob@other.social')] }))
    vi.spyOn(client, 'fetchRelationships').mockResolvedValue([])
    const el = await mount({ q: 'bob' })
    expect(search).toHaveBeenCalledWith({ q: 'bob', resolve: false, limit: 20 })
    expect(accts(el)).toEqual(['@bob@other.social'])
    expect(searchPublic).not.toHaveBeenCalled()
  })

  it('shows a Follow button once the relationship is known', async () => {
    const client = signIn()
    vi.spyOn(client, 'search').mockResolvedValue(result({ accounts: [account('2', 'bob@other.social')] }))
    vi.spyOn(client, 'fetchRelationships').mockResolvedValue([{ id: '2', following: true } as mastodon.v1.Relationship])
    const el = await mount({ q: 'bob' })
    await flush()
    await el.updateComplete
    const button = el.shadowRoot!.querySelector('caribou-button.follow')!
    expect(button.getAttribute('data-state')).toBe('following')
  })

  it('never lets a slower earlier answer replace a newer one', async () => {
    const client = signIn()
    vi.spyOn(client, 'fetchRelationships').mockResolvedValue([])
    const slow = deferred<mastodon.v2.Search>()
    const search = vi.spyOn(client, 'search')
      .mockImplementationOnce(() => slow.promise)
      .mockResolvedValueOnce(result({ accounts: [account('3', 'carol')] }))
    const el = await mount({ q: 'ca' })
    const input = el.shadowRoot!.querySelector('input')!
    input.value = 'carol'
    el.shadowRoot!.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await flush()
    await el.updateComplete
    expect(accts(el)).toEqual(['@carol@home.social'])
    slow.resolve(result({ accounts: [account('9', 'old')] }))
    await flush()
    await el.updateComplete
    expect(accts(el)).toEqual(['@carol@home.social'])
    expect(search).toHaveBeenCalledTimes(2)
  })

  it('drops an answer that arrives after the account changed', async () => {
    const client = signIn()
    const slow = deferred<mastodon.v2.Search>()
    vi.spyOn(client, 'search').mockImplementationOnce(() => slow.promise)
    const el = await mount({ q: 'bob' })
    activeUserKey.value = null
    searchPublic.mockResolvedValue(result())
    await flush()
    slow.resolve(result({ accounts: [account('2', 'bob@other.social')] }))
    await flush()
    await el.updateComplete
    expect(accts(el)).toEqual([])
  })

  it('opens the post a pasted address names, replacing the search entry', async () => {
    history.replaceState(null, '', '/search?q=https%3A%2F%2Fother.social%2F%40bob%2F5')
    const client = signIn()
    const search = vi.spyOn(client, 'search').mockResolvedValue(result({ statuses: [status('77')] }))
    const pops: string[] = []
    const onPop = () => pops.push(location.pathname)
    window.addEventListener('popstate', onPop)
    const before = history.length
    await mount({ q: 'https://other.social/@bob/5' })
    window.removeEventListener('popstate', onPop)
    expect(search).toHaveBeenCalledWith({ q: 'https://other.social/@bob/5', resolve: true, limit: 20 })
    expect(location.pathname).toBe('/@bob@other.social/77')
    expect(history.length).toBe(before)
    expect(pops).toEqual(['/@bob@other.social/77'])
  })

  it('signed out, searches the public instance with no token', async () => {
    searchPublic.mockResolvedValue(result({
      accounts: [account('2', 'bob')],
      hashtags: [{ name: 'cats', url: '', history: [{ day: '1', uses: '3', accounts: '2' }, { day: '2', uses: '2', accounts: '1' }] } as mastodon.v1.Tag],
    }))
    const el = await mount({ q: 'bob', instance: 'pub.social' })
    expect(searchPublic).toHaveBeenCalledWith('pub.social', { q: 'bob', limit: 20 })
    expect(accts(el)).toEqual(['@bob@pub.social'])
    expect(el.shadowRoot!.querySelector('caribou-button.follow')).toBeNull()
    el.shadowRoot!.querySelectorAll<HTMLAnchorElement>('.tabs a')[1]!.click()
    await el.updateComplete
    expect(location.search).toBe('?q=bob&type=hashtags')
    expect(el.shadowRoot!.querySelector('.tag')!.getAttribute('href')).toBe('/tags/cats')
    expect(text(el)).toContain('5 posts this week')
    el.shadowRoot!.querySelectorAll<HTMLAnchorElement>('.tabs a')[2]!.click()
    await el.updateComplete
    expect(text(el)).toContain('Sign in to search posts')
    expect(searchPublic).toHaveBeenCalledTimes(1)
  })

  it('signed out with no known server, asks the reader to sign in', async () => {
    const el = await mount({ q: 'bob' })
    expect(el.shadowRoot!.querySelector('caribou-auth-required')).not.toBeNull()
    expect(searchPublic).not.toHaveBeenCalled()
  })

  it('signed out, a server that refuses tokenless search asks for sign-in', async () => {
    searchPublic.mockRejectedValue(new CaribouError('unauthorized', 'no'))
    const el = await mount({ q: 'bob', instance: 'pub.social' })
    expect(el.shadowRoot!.querySelector('caribou-auth-required')!.getAttribute('label'))
      .toBe('This server searches only for signed-in readers.')
  })

  it('shows Retry after a failure', async () => {
    searchPublic.mockRejectedValueOnce(new CaribouError('server_error', 'down'))
    const el = await mount({ q: 'bob', instance: 'pub.social' })
    expect(text(el)).toContain('Search failed.')
    searchPublic.mockResolvedValueOnce(result({ accounts: [account('2', 'bob')] }))
    el.shadowRoot!.querySelector<HTMLButtonElement>('.notice button')!.click()
    await flush()
    await el.updateComplete
    expect(accts(el)).toEqual(['@bob@pub.social'])
  })

  it('debounces typing, then puts the query in the address without a new entry', async () => {
    searchPublic.mockResolvedValue(result())
    const el = await mount({ instance: 'pub.social' })
    vi.useFakeTimers()
    const before = history.length
    const input = el.shadowRoot!.querySelector('input')!
    for (const v of ['c', 'ca', 'cat']) {
      input.value = v
      input.dispatchEvent(new InputEvent('input', { inputType: 'insertText' }))
      vi.advanceTimersByTime(100)
    }
    expect(searchPublic).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(searchPublic).toHaveBeenCalledOnce()
    expect(searchPublic).toHaveBeenCalledWith('pub.social', { q: 'cat', limit: 20 })
    expect(location.search).toBe('?q=cat')
    expect(history.length).toBe(before)
  })

  it('follows Back to an earlier search', async () => {
    searchPublic.mockImplementation(async (_: string, p: { q: string }) => result({ accounts: [account(p.q, p.q)] }))
    history.replaceState(null, '', '/search?q=one')
    const el = await mount({ q: 'one', instance: 'pub.social' })
    const input = el.shadowRoot!.querySelector('input')!
    input.value = 'two'
    el.shadowRoot!.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await flush()
    await el.updateComplete
    expect(location.search).toBe('?q=two')
    expect(accts(el)).toEqual(['@two@pub.social'])
    history.replaceState(null, '', '/search?q=one')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await flush()
    await el.updateComplete
    expect(input.value).toBe('one')
    expect(accts(el)).toEqual(['@one@pub.social'])
  })
})
