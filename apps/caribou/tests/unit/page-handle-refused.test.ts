import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as H3 from 'h3'
import { activeUserKey, clearKeptAlive, statusCache, users } from '@beatzball/caribou-state'

// A remote profile whose own server refuses Caribou's server (a 401 or a
// 403; app README, "A refused remote profile"). The page is the loading
// shell on the server and in the first client render. After hydration a
// signed-in Mastodon reader gets the profile through their own server;
// anyone else gets a message and a link to the account's own page.

let cookie: string | null = null
vi.mock('../../server/lib/instance-cookie.js', () => ({ getInstance: vi.fn(async () => cookie) }))
vi.mock('../../server/lib/storage.js', () => ({ getStorage: () => ({ getItem: async () => null }) }))
vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof H3>('h3')
  return {
    ...actual,
    getRouterParams: (event: { context?: { params?: Record<string, string> } }) => event.context?.params ?? {},
    getQuery: () => ({}),
    getRequestURL: () => new URL('http://localhost:3000/'),
    setResponseStatus: vi.fn(),
  }
})

const { pageData } = await import('../../pages/@[handle].js')

type Event = Parameters<typeof pageData.fetcher>[0]
const event = (handle: string) => ({ context: { params: { handle } } }) as unknown as Event

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const hrefOf = (input: string | URL | Request) => (input instanceof Request ? input.url : String(input))

const BASE = { avatar: '', avatar_static: '', header: '', header_static: '', note: '', fields: [], emojis: [] }
// The path host's account. Its id means nothing to any other server.
const PATH_ACCOUNT = { ...BASE, id: 'path-7', username: 'carol', acct: 'carol', display_name: 'Carol Path', url: 'https://x/@carol' }
// The same account as the reader's home server knows it, by its own id.
const HOME_CAROL = { ...BASE, id: 'home-99', username: 'carol', acct: 'carol@refuses.example', display_name: 'Carol Home', url: 'https://refuses.example/@carol' }
// Local to the reader's server: its acct has no host.
const HOME_DAVE = { ...BASE, id: 'home-5', username: 'dave', acct: 'dave', display_name: 'Dave Local', url: 'https://example.social/@dave' }
const post = (id: string, account: unknown, extra: object = {}) => ({
  id, uri: `https://x/${id}`, url: `https://x/${id}`,
  created_at: '2024-01-01T00:00:00.000Z', account, content: `<p>post ${id}</p>`,
  visibility: 'public', sensitive: false, spoiler_text: '', media_attachments: [], mentions: [], tags: [], emojis: [],
  reblogs_count: 0, favourites_count: 0, replies_count: 0, language: 'en', filtered: [],
  favourited: false, reblogged: false, bookmarked: false,
  ...extra,
})
// Carol boosts a post by Dave, an account local to the reader's server.
const BOOST = post('6001', HOME_CAROL, { content: '', reblog: post('6000', HOME_DAVE) })
const OWN = post('5001', HOME_CAROL)

let calls: string[] = []
let host = ''
let seq = 0

// A path host that answers the lookup and then `status` for the posts.
function pathHostAnswers(status: number) {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    calls.push(input)
    const url = new URL(input)
    if (url.pathname === '/api/v1/accounts/lookup') return json(200, PATH_ACCOUNT)
    return json(status, { error: 'nope' })
  }))
}

function deepAll(root: Element | ShadowRoot, sel: string, out: Element[] = []): Element[] {
  out.push(...root.querySelectorAll(sel))
  if (root instanceof Element && root.shadowRoot) deepAll(root.shadowRoot, sel, out)
  for (const el of root.querySelectorAll('*')) if (el.shadowRoot) deepAll(el.shadowRoot, sel, out)
  return out
}
// What a reader reads: the text of every shadow root, spaces collapsed.
function shownText(root: Element | ShadowRoot): string {
  let out = root.textContent ?? ''
  if (root instanceof Element && root.shadowRoot) out += ` ${shownText(root.shadowRoot)}`
  for (const el of root.querySelectorAll('*')) if (el.shadowRoot) out += ` ${shownText(el.shadowRoot)}`
  return out.replace(/\s+/g, ' ')
}

async function settle(el: HTMLElement & { updateComplete: Promise<boolean> }, until: () => boolean) {
  for (let i = 0; i < 200 && !until(); i++) {
    await new Promise((r) => setTimeout(r, 5))
    while (!(await el.updateComplete)) { /* settle */ }
  }
}

function mount(serverData: unknown, path: string) {
  history.replaceState(null, '', path)
  const el = document.createElement('page-handle') as HTMLElement & { serverData: unknown; updateComplete: Promise<boolean> }
  el.serverData = serverData
  let first = ''
  let firstArticle: Element | null = null
  ;(el as unknown as { addController(c: object): void }).addController({
    hostUpdated: () => {
      if (first) return
      first = el.shadowRoot?.querySelector('caribou-app-shell')?.innerHTML ?? ''
      firstArticle = el.shadowRoot?.querySelector('article') ?? null
    },
  })
  document.body.appendChild(el)
  return { el, first: () => first, firstArticle: () => firstArticle }
}

function signIn(server = 'example.social') {
  users.value = new Map([[`bob@${server}`, {
    userKey: `bob@${server}`, server, token: 'T', vapidKey: '', createdAt: 1,
    account: { id: '1', acct: 'bob', username: 'bob' },
  }]]) as never
  activeUserKey.value = `bob@${server}`
}

let rejections: unknown[] = []
const onRejection = (reason: unknown) => { rejections.push(reason) }

beforeEach(() => {
  calls = []
  rejections = []
  cookie = null
  // A new host per test: the upstream cache keeps answers by URL.
  host = `refuses-${++seq}.example`
  document.body.replaceChildren()
  clearKeptAlive()
  statusCache.value = new Map()
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
  process.on('unhandledRejection', onRejection)
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => {
  process.off('unhandledRejection', onRejection)
  vi.unstubAllGlobals()
})

describe('pageData: the path host refuses the server', () => {
  it.each([401, 403])('a %i is the refused kind, with the handle and the host', async (status) => {
    pathHostAnswers(status)
    const data = await pageData.fetcher(event(`carol@${host}`))
    expect(data).toMatchObject({ kind: 'refused', handle: `carol@${host}`, host })
    expect(JSON.stringify(data)).not.toContain('Carol Path')
  })

  it.each([404, 429, 500])('a %i is an error page as before, and the rendered message names the handle', async (status) => {
    pathHostAnswers(status)
    const data = await pageData.fetcher(event(`carol@${host}`))
    expect(data).toMatchObject({ kind: 'error', handle: `carol@${host}` })
    const { el } = mount(data, `/@carol@${host}`)
    await settle(el, () => shownText(el).includes('Couldn'))
    expect(shownText(el)).toContain(`Couldn't load profile @carol@${host}.`)
  })

  it('a 401 on the lookup itself is refused too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: 'nope' })))
    const data = await pageData.fetcher(event(`carol@${host}`))
    expect(data).toMatchObject({ kind: 'refused', handle: `carol@${host}`, host })
  })

  it('a refusal is not asked again on the next visit', async () => {
    pathHostAnswers(401)
    await pageData.fetcher(event(`carol@${host}`))
    const asked = calls.length
    const again = await pageData.fetcher(event(`carol@${host}`))
    expect(again).toMatchObject({ kind: 'refused', host })
    expect(calls.length).toBe(asked)
  })

  it('a bare /@name whose cookie instance refuses: refused, with the cookie host', async () => {
    cookie = host
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: 'nope' })))
    const data = await pageData.fetcher(event('carol'))
    expect(data).toMatchObject({ kind: 'refused', handle: 'carol', host })
  })
})

const SHELL = { instance: 'refuses.example', source: 'path' }
const refused = { kind: 'refused', host: 'refuses.example', shell: SHELL, handle: 'carol@refuses.example' }

describe('the page for a refused profile', () => {
  // The reader's home server, example.social. `lookup` and `search` say
  // what it knows about carol@refuses.example.
  let lookup: number | 'network' = 200
  let search: unknown[] | number = []
  beforeEach(() => {
    lookup = 200
    search = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const href = hrefOf(input)
      calls.push(href)
      const url = new URL(href)
      if (url.host !== 'example.social') throw new Error(`unexpected fetch ${href}`)
      if (url.pathname === '/api/v1/accounts/lookup') {
        if (lookup === 'network') throw new TypeError('Failed to fetch')
        return lookup === 200 ? json(200, HOME_CAROL) : json(lookup, { error: 'Record not found' })
      }
      if (url.pathname === '/api/v2/search') {
        return typeof search === 'number'
          ? json(search, { error: 'boom' })
          : json(200, { accounts: search, statuses: [], hashtags: [] })
      }
      if (url.pathname === `/api/v1/accounts/${HOME_CAROL.id}/statuses`) return json(200, [BOOST, OWN])
      return json(200, [])
    }))
  })

  it('signed out: one live region, first "Loading…", then the message and a link to the account\'s own page', async () => {
    const { el, first, firstArticle } = mount(refused, '/@carol@refuses.example')
    await settle(el, () => shownText(el).includes('does not allow'))
    expect(first()).toContain('Loading…')
    const article = el.shadowRoot!.querySelector('article')!
    // The same node: only its text changed, so a screen reader hears it.
    expect(article).toBe(firstArticle())
    expect(article.getAttribute('role')).toBe('status')
    expect(article.getAttribute('aria-busy')).toBe('false')
    expect(article.querySelector('a')!.getAttribute('href')).toBe('https://refuses.example/@carol')
    expect(shownText(article)).toContain('refuses.example does not allow Caribou to show this profile.')
    expect(shownText(article)).toContain('a Mastodon account')
    expect(calls).toEqual([])
  })

  it('a Bluesky reader is told it takes a Mastodon account', async () => {
    users.value = new Map([['did:plc:alice@bsky', {
      userKey: 'did:plc:alice@bsky', network: 'bluesky', did: 'did:plc:alice', handle: 'alice.test', createdAt: 1,
    } as never]])
    activeUserKey.value = 'did:plc:alice@bsky'
    const { el } = mount(refused, '/@carol@refuses.example')
    await settle(el, () => shownText(el).includes('does not allow'))
    expect(shownText(el)).toContain('Sign in with a Mastodon account')
  })

  it('signed in: first the loading shell, then the profile through the home server, by its own id', async () => {
    signIn()
    const { el, first } = mount(refused, '/@carol@refuses.example')
    await settle(el, () => shownText(el).includes('post 5001'))
    expect(first()).toContain('Loading…')
    expect(shownText(el)).toContain('Carol Home')
    const lookups = calls.filter((u) => u.includes('/accounts/lookup'))
    expect(lookups.map((u) => new URL(u).searchParams.get('acct'))).toEqual(['carol@refuses.example'])
    expect(calls.some((u) => u.includes(`/accounts/${HOME_CAROL.id}/statuses`))).toBe(true)
    expect(el.shadowRoot!.querySelector('caribou-profile')!.getAttribute('handle')).toBe('carol@refuses.example')
    // The next page starts at the home server's id, on the remote route.
    expect(deepAll(el, 'a[rel="next"]').map((a) => a.getAttribute('href')))
      .toEqual(['/@carol@refuses.example?tab=posts&max_id=5001'])
  })

  it('signed in: the cards are the home server\'s copies — its links and its actions', async () => {
    signIn()
    const { el } = mount(refused, '/@carol@refuses.example')
    await settle(el, () => shownText(el).includes('post 6000') && shownText(el).includes('post 5001'))
    const cards = deepAll(el, 'caribou-status-card')
    expect(cards.length).toBe(2)
    for (const card of cards) expect(card.getAttribute('instance')).toBe('example.social')
    await settle(el, () => deepAll(el, 'caribou-icon-button[soft-disabled]').length === 0)
    const boost = cards.find((c) => c.getAttribute('data-status-id') === '6001')!
    const links = [...deepAll(boost, 'a[href]'), ...deepAll(boost, 'litro-link[href]')].map((a) => a.getAttribute('href'))
    // Dave is local to the reader's server: his link names that server.
    expect(links).toContain('/@dave@example.social')
    expect(links).not.toContain('/@dave@refuses.example')
    const buttons = deepAll(el, 'caribou-icon-button')
    expect(buttons.length).toBeGreaterThan(0)
    expect(buttons.filter((b) => b.hasAttribute('soft-disabled'))).toEqual([])
  })

  it('signed in, the home server does not know the account: it resolves it by search', async () => {
    signIn()
    lookup = 404
    search = [HOME_CAROL]
    const { el } = mount(refused, '/@carol@refuses.example')
    await settle(el, () => shownText(el).includes('post 5001'))
    const asked = calls.find((u) => u.includes('/api/v2/search'))!
    const q = new URL(asked).searchParams
    expect(q.get('q')).toBe('carol@refuses.example')
    expect(q.get('resolve')).toBe('true')
    expect(q.get('type')).toBe('accounts')
    expect(shownText(el)).toContain('Carol Home')
    expect(rejections).toEqual([])
  })

  it('signed in, the home server cannot find it either: a message with the handle and a link', async () => {
    signIn()
    lookup = 404
    search = []
    const { el } = mount(refused, '/@carol@refuses.example')
    await settle(el, () => shownText(el).includes("Couldn't find"))
    expect(shownText(el)).toContain("Couldn't find @carol@refuses.example")
    expect(deepAll(el, 'a[href="https://refuses.example/@carol"]').length).toBe(1)
    expect(shownText(el)).not.toContain('Loading…')
    expect(rejections).toEqual([])
  })

  // Only a 404 means "not found". A fault says it could not load, names the
  // handle, and offers a Retry.
  for (const [what, fault] of [['a 500', 500], ['a network failure', 'network']] as const) {
    it(`signed in, the home lookup fails with ${what}: "Couldn't load", the handle, and a Retry`, async () => {
      signIn()
      lookup = fault
      const { el } = mount(refused, '/@carol@refuses.example')
      await settle(el, () => shownText(el).includes("Couldn't load"))
      expect(shownText(el)).toContain("Couldn't load @carol@refuses.example from your server.")
      expect(shownText(el)).not.toContain("Couldn't find")
      expect(deepAll(el, 'a[href="https://refuses.example/@carol"]').length).toBe(1)
      expect(calls.some((u) => u.includes('/api/v2/search'))).toBe(false)
      expect(rejections).toEqual([])
      lookup = 200
      const retry = deepAll(el, 'caribou-button[data-action="retry"]')
      expect(retry.length).toBe(1)
      ;(retry[0] as HTMLElement).click()
      await settle(el, () => shownText(el).includes('post 5001'))
      expect(shownText(el)).toContain('Carol Home')
      expect(shownText(el)).not.toContain("Couldn't load")
    })
  }

  it('signed in, the lookup is a 404 and the search fails: "Couldn\'t load", not "Couldn\'t find"', async () => {
    signIn()
    lookup = 404
    search = 500
    const { el } = mount(refused, '/@carol@refuses.example')
    await settle(el, () => shownText(el).includes("Couldn't load"))
    expect(shownText(el)).toContain("Couldn't load @carol@refuses.example from your server.")
    expect(shownText(el)).not.toContain("Couldn't find")
    expect(deepAll(el, 'caribou-button[data-action="retry"]').length).toBe(1)
    expect(rejections).toEqual([])
  })

  it('a bare /@name: the home server looks up name@<the refusing host>, never the bare name', async () => {
    signIn()
    const bare = { kind: 'refused', host: 'refuses.example', shell: { instance: 'refuses.example', source: 'cookie' }, handle: 'carol' }
    const { el } = mount(bare, '/@carol')
    await settle(el, () => shownText(el).includes('post 5001'))
    const lookups = calls.filter((u) => u.includes('/accounts/lookup'))
    expect(lookups.map((u) => new URL(u).searchParams.get('acct'))).toEqual(['carol@refuses.example'])
    // The links keep the address the reader opened.
    expect(deepAll(el, 'a[rel="next"]').map((a) => a.getAttribute('href')))
      .toEqual(['/@carol?tab=posts&max_id=5001'])
  })
})
