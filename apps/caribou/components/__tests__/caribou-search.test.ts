import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as MastodonClient from '@beatzball/caribou-mastodon-client'
import type * as CaribouState from '@beatzball/caribou-state'
import {
  CaribouError, type Account, type Relationship, type Search, type Status,
  type Tag,
} from '@beatzball/caribou-mastodon-client'
import type { CaribouSearch as El } from '../caribou-search.js'
import {
  activeClient, activeUserKey, addUserSession, relationshipCache, users, type UserSession,
} from '@beatzball/caribou-state'

const searchPublic = vi.hoisted(() => vi.fn())
vi.mock('@beatzball/caribou-mastodon-client', async (orig) => ({
  ...(await orig<typeof MastodonClient>()),
  searchPublic,
}))

// A test can move the account generation on its own, with no account
// change and so no new search (review round 1, Codex 5 / Fable F4).
const generation = vi.hoisted(() => ({ offset: 0 }))
vi.mock('@beatzball/caribou-state', async (orig) => {
  const real = await orig<typeof CaribouState>()
  return { ...real, ownerGeneration: () => real.ownerGeneration() + generation.offset }
})

await import('../caribou-search.js')

const account = (id: string, acct: string) => ({
  id, acct, username: acct.split('@')[0], displayName: acct.toUpperCase(),
  avatar: '', avatarStatic: '', url: `https://other.social/@${acct}`, uri: `https://other.social/users/${acct}`,
}) as unknown as Account

const status = (id: string) => ({
  id, uri: `https://other.social/users/bob/statuses/${id}`, url: `https://other.social/@bob/${id}`,
  content: `<p>post ${id}</p>`, account: account('2', 'bob@other.social'), createdAt: '2024-01-01T00:00:00.000Z',
  mediaAttachments: [], mentions: [], tags: [], emojis: [], spoilerText: '',
  reblogsCount: 0, favouritesCount: 0, repliesCount: 0,
}) as unknown as Status

const result = (over: Partial<Search> = {}): Search =>
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
  generation.offset = 0
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

  it('draws the tabs with the shared <caribou-tabs>, as a named navigation', async () => {
    searchPublic.mockResolvedValue(result())
    const el = await mount({ q: 'cats', instance: 'pub.social' })
    const row = el.shadowRoot!.querySelector('caribou-tabs.tabs')!
    expect(row.getAttribute('label')).toBe('Result type')
    expect(row.hasAttribute('fill')).toBe(true)
    expect([...row.children].filter((c) => c.localName === 'a').length).toBe(3)
  })

  // The form submits with JavaScript off (action="/search", method="get"),
  // so its button stays native: <caribou-button> cannot submit without it.
  it('keeps a native submit button for the no-JS search form', async () => {
    searchPublic.mockResolvedValue(result())
    const el = await mount({ q: 'cats', instance: 'pub.social' })
    const btn = el.shadowRoot!.querySelector('form[action="/search"][method="get"] > button[type="submit"]')!
    expect(btn.getAttribute('aria-label')).toBe('Search')
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
    vi.spyOn(client, 'fetchRelationships').mockResolvedValue([{ id: '2', following: true } as Relationship])
    const el = await mount({ q: 'bob' })
    await flush()
    await el.updateComplete
    const button = el.shadowRoot!.querySelector('caribou-button.follow')!
    expect(button.getAttribute('data-state')).toBe('following')
  })

  it('never lets a slower earlier answer replace a newer one', async () => {
    const client = signIn()
    vi.spyOn(client, 'fetchRelationships').mockResolvedValue([])
    const slow = deferred<Search>()
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
    const slow = deferred<Search>()
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
    history.replaceState(null, '', '/search?q=https%3A%2F%2Fother.social%2F%40bob%2F77')
    const client = signIn()
    const search = vi.spyOn(client, 'search').mockResolvedValue(result({ statuses: [status('77')] }))
    const pops: string[] = []
    const onPop = () => pops.push(location.pathname)
    window.addEventListener('popstate', onPop)
    const before = history.length
    await mount({ q: 'https://other.social/@bob/77' })
    window.removeEventListener('popstate', onPop)
    expect(search).toHaveBeenCalledWith({ q: 'https://other.social/@bob/77', resolve: true, limit: 20 })
    expect(location.pathname).toBe('/@bob@other.social/77')
    expect(history.length).toBe(before)
    expect(pops).toEqual(['/@bob@other.social/77'])
  })

  it('signed out, searches the public instance with no token', async () => {
    searchPublic.mockResolvedValue(result({
      accounts: [account('2', 'bob')],
      hashtags: [{ name: 'cats', url: '', history: [{ day: '1', uses: '3', accounts: '2' }, { day: '2', uses: '2', accounts: '1' }] } as Tag],
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
    const retry = el.shadowRoot!.querySelector<HTMLElement>('.notice caribou-button')!
    expect(retry.textContent).toBe('Retry')
    retry.click()
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

  // Review round 1 (Codex 5 / Fable F4): the generation alone drops an answer.
  it('drops an answer when the account generation moved, with no newer search', async () => {
    const slow = deferred<Search>()
    searchPublic.mockImplementationOnce(() => slow.promise)
    const el = await mount({ q: 'bob', instance: 'pub.social' })
    generation.offset = 1
    slow.resolve(result({ accounts: [account('2', 'bob')] }))
    await flush()
    await el.updateComplete
    expect(accts(el)).toEqual([])
  })

  // Review round 1 (Codex 1): leaving /search cancels the typed query.
  it('a navigation away from /search cancels the waiting typed query', async () => {
    searchPublic.mockResolvedValue(result())
    const el = await mount({ instance: 'pub.social' })
    vi.useFakeTimers()
    const input = el.shadowRoot!.querySelector('input')!
    input.value = 'new'
    input.dispatchEvent(new InputEvent('input', { inputType: 'insertText' }))
    history.pushState(null, '', '/about')
    window.dispatchEvent(new PopStateEvent('popstate'))
    vi.advanceTimersByTime(400)
    expect(location.pathname + location.search).toBe('/about')
    expect(searchPublic).not.toHaveBeenCalled()
  })

  it('a typed query that fires after the address left /search changes nothing', async () => {
    searchPublic.mockResolvedValue(result())
    const el = await mount({ instance: 'pub.social' })
    vi.useFakeTimers()
    const input = el.shadowRoot!.querySelector('input')!
    input.value = 'new'
    input.dispatchEvent(new InputEvent('input', { inputType: 'insertText' }))
    // A link click: the router pushes, and its popstate may come later.
    history.pushState(null, '', '/about')
    vi.advanceTimersByTime(400)
    expect(location.pathname + location.search).toBe('/about')
    expect(searchPublic).not.toHaveBeenCalled()
  })

  // Review round 1 (Codex 3 / Fable F2): signed out, nothing is resolved.
  it('signed out, an address that finds one account stays on search', async () => {
    const q = 'https://other.social/@bob'
    history.replaceState(null, '', `/search?q=${encodeURIComponent(q)}`)
    searchPublic.mockResolvedValue(result({ accounts: [account('2', 'bob@other.social')] }))
    const el = await mount({ q, instance: 'pub.social' })
    expect(location.pathname).toBe('/search')
    expect(accts(el)).toEqual(['@bob@other.social'])
    expect(text(el)).toContain('Sign in to open a post or profile from another server.')
  })

  // Review round 1 (Codex 2): a malformed answer leaves the search usable.
  it('a malformed resolved answer shows the results and does not navigate', async () => {
    const q = 'https://other.social/@bob/5'
    history.replaceState(null, '', `/search?q=${encodeURIComponent(q)}`)
    const client = signIn()
    vi.spyOn(client, 'fetchRelationships').mockResolvedValue([])
    const broken = { ...status('5'), account: undefined } as unknown as Status
    vi.spyOn(client, 'search').mockResolvedValue(result({ statuses: [broken] }))
    const el = await mount({ q })
    expect(location.pathname).toBe('/search')
    expect(text(el)).not.toContain('Searching…')
  })

  // Review round 1 (Codex 4 / Fable F1): a tab takes the typed query.
  it('a tab click during the debounce searches once and keeps its own entry', async () => {
    searchPublic.mockResolvedValue(result())
    const el = await mount({ instance: 'pub.social' })
    vi.useFakeTimers()
    const input = el.shadowRoot!.querySelector('input')!
    input.value = 'bob'
    input.dispatchEvent(new InputEvent('input', { inputType: 'insertText' }))
    el.shadowRoot!.querySelectorAll<HTMLAnchorElement>('.tabs a')[1]!.click()
    vi.advanceTimersByTime(400)
    expect(searchPublic).toHaveBeenCalledOnce()
    expect(location.search).toBe('?q=bob&type=hashtags')
    // The tab's entry is settled: the next typed query gets its own entry.
    const before = history.length
    input.value = 'bobcat'
    input.dispatchEvent(new InputEvent('input', { inputType: 'insertText' }))
    vi.advanceTimersByTime(400)
    expect(history.length).toBe(before + 1)
  })

  // Review round 2 (Codex R2-1): a resolved id that would leave the route.
  for (const id of ['..', '.', '\ud800']) {
    it(`a resolved post with id ${JSON.stringify(id)} stays on search and settles`, async () => {
      const q = 'https://other.social/@bob/5'
      history.replaceState(null, '', `/search?q=${encodeURIComponent(q)}`)
      const client = signIn()
      vi.spyOn(client, 'fetchRelationships').mockResolvedValue([])
      vi.spyOn(client, 'search').mockResolvedValue(result({ statuses: [{ ...status('5'), id }] }))
      const el = await mount({ q, type: 'statuses' })
      expect(location.pathname).toBe('/search')
      expect(text(el)).not.toContain('Searching…')
    })
  }

  // Review round 2 (Codex R2-2): malformed posts on the Posts tab.
  it('a null post and a post with no account leave the Posts tab usable', async () => {
    const client = signIn()
    vi.spyOn(client, 'fetchRelationships').mockResolvedValue([])
    const noAccount = { ...status('6'), account: undefined } as unknown as Status
    vi.spyOn(client, 'search').mockResolvedValue(result({
      statuses: [null as unknown as Status, noAccount, status('7')],
    }))
    const errors: unknown[] = []
    const onError = (e: ErrorEvent) => errors.push(e.error)
    window.addEventListener('error', onError)
    const el = await mount({ q: 'bob', type: 'statuses' })
    window.removeEventListener('error', onError)
    const cards = [...el.shadowRoot!.querySelectorAll('caribou-status-card')]
    expect(cards.map((c) => (c as unknown as { status: Status }).status.id)).toEqual(['7'])
    expect(text(el)).not.toContain('Searching…')
    expect(errors).toEqual([])
  })

  // Review round 2 (Fable N1): the popstate clear alone. The reader leaves
  // and comes straight back to an earlier search before the wait ends; the
  // old typed query must not overwrite it.
  it('a quick Back to /search after leaving does not commit the old typed query', async () => {
    searchPublic.mockResolvedValue(result())
    const el = await mount({ instance: 'pub.social' })
    vi.useFakeTimers()
    const input = el.shadowRoot!.querySelector('input')!
    input.value = 'new'
    input.dispatchEvent(new InputEvent('input', { inputType: 'insertText' }))
    history.pushState(null, '', '/about')
    window.dispatchEvent(new PopStateEvent('popstate'))
    // Back lands on an earlier search entry; the router builds a new page
    // for it, so this element hears no further popstate.
    history.replaceState(null, '', '/search?q=old')
    vi.advanceTimersByTime(400)
    expect(location.pathname + location.search).toBe('/search?q=old')
    expect(searchPublic).not.toHaveBeenCalled()
  })
})
