import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as H3 from 'h3'
import { activeUserKey, clearKeptAlive, statusCache, users } from '@beatzball/caribou-state'

// A remote profile whose own server refuses Caribou's server (a 401 or a
// 403; app README, "A refused remote profile"). The page is the loading
// shell on the server and in the first client render. After hydration a
// signed-in Mastodon reader gets the profile through their own server;
// a signed-out reader gets a message and a link to the account's own page.

vi.mock('../../server/lib/instance-cookie.js', () => ({ getInstance: vi.fn(async () => null) }))
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

// The path host's account. Its id means nothing to any other server.
const PATH_ACCOUNT = {
  id: 'path-7', username: 'carol', acct: 'carol', display_name: 'Carol Path', url: 'https://x/@carol',
  avatar: '', avatar_static: '', header: '', header_static: '', note: '', fields: [], emojis: [],
}
// The same account as the reader's home server knows it, by its own id.
const HOME_ACCOUNT = { ...PATH_ACCOUNT, id: 'home-99', acct: 'carol@refuses.example', display_name: 'Carol Home' }
const HOME_POST = {
  id: '5001', uri: 'https://refuses.example/@carol/1', url: 'https://refuses.example/@carol/1',
  created_at: '2024-01-01T00:00:00.000Z', account: HOME_ACCOUNT, content: '<p>carol home post</p>',
  visibility: 'public', sensitive: false, spoiler_text: '', media_attachments: [], mentions: [], tags: [], emojis: [],
  reblogs_count: 0, favourites_count: 0, replies_count: 0, language: 'en',
}

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

beforeEach(() => {
  calls = []
  // A new host per test: the upstream cache keeps answers by URL.
  host = `refuses-${++seq}.example`
})
afterEach(() => vi.unstubAllGlobals())

describe('pageData: the path host refuses the server', () => {
  it.each([401, 403])('a %i is the refused kind, with the handle and the host', async (status) => {
    pathHostAnswers(status)
    const data = await pageData.fetcher(event(`carol@${host}`))
    expect(data).toMatchObject({ kind: 'refused', handle: `carol@${host}`, host })
    expect(JSON.stringify(data)).not.toContain('Carol Path')
  })

  it('a 500 is an error page as before, and the message has the handle', async () => {
    pathHostAnswers(500)
    const data = await pageData.fetcher(event(`carol@${host}`))
    expect(data).toMatchObject({ kind: 'error', handle: `carol@${host}` })
  })

  it('a 401 on the lookup itself is refused too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: 'nope' })))
    const data = await pageData.fetcher(event(`carol@${host}`))
    expect(data).toMatchObject({ kind: 'refused', handle: `carol@${host}`, host })
  })
})

// Everything a page shows: every shadow root's markup.
function deepHtml(root: Element | ShadowRoot): string {
  let out = root instanceof Element ? root.outerHTML : root.innerHTML
  if (root instanceof Element && root.shadowRoot) out += deepHtml(root.shadowRoot)
  for (const el of root.querySelectorAll('*')) if (el.shadowRoot) out += deepHtml(el.shadowRoot)
  return out
}
const text = (el: Element) => deepHtml(el).replace(/<!--[^>]*-->/g, '')

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
  ;(el as unknown as { addController(c: object): void }).addController({
    hostUpdated: () => { first ||= el.shadowRoot?.querySelector('caribou-app-shell')?.innerHTML ?? '' },
  })
  document.body.appendChild(el)
  return { el, first: () => first }
}

const SHELL = { instance: 'refuses.example', source: 'path' }
const refused = { kind: 'refused', host: 'refuses.example', shell: SHELL, handle: 'carol@refuses.example' }

describe('the page for a refused profile', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    clearKeptAlive()
    statusCache.value = new Map()
    users.value = new Map()
    activeUserKey.value = null
    localStorage.clear()
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const href = input instanceof Request ? input.url : String(input)
      calls.push(href)
      const url = new URL(href)
      if (url.host !== 'example.social') throw new Error(`unexpected fetch ${input}`)
      if (url.pathname === '/api/v1/accounts/lookup') return json(200, HOME_ACCOUNT)
      if (url.pathname === `/api/v1/accounts/${HOME_ACCOUNT.id}/statuses`) return json(200, [HOME_POST])
      return json(200, [])
    }))
  })

  it('signed out: first the loading shell, then the message and a link to the account\'s own page', async () => {
    const { el, first } = mount(refused, '/@carol@refuses.example')
    await settle(el, () => text(el).includes('does not allow'))
    expect(first()).toContain('Loading…')
    const link = el.shadowRoot!.querySelector('a[href="https://refuses.example/@carol"]')
    expect(link).not.toBeNull()
    expect(text(el)).toContain('refuses.example does not allow')
    expect(text(el)).not.toContain("Couldn't load")
    expect(calls).toEqual([])
  })

  it('signed in: first the loading shell, then the profile through the home server, by its own id', async () => {
    users.value = new Map([['bob@example.social', {
      userKey: 'bob@example.social', server: 'example.social', token: 'T', vapidKey: '', createdAt: 1,
      account: { id: '1', acct: 'bob', username: 'bob' },
    } as never]])
    activeUserKey.value = 'bob@example.social'
    const { el, first } = mount(refused, '/@carol@refuses.example')
    await settle(el, () => text(el).includes('carol home post'))
    expect(first()).toContain('Loading…')
    expect(text(el)).toContain('Carol Home')
    expect(text(el)).toContain('carol home post')
    const lookup = calls.find((u) => u.includes('/accounts/lookup'))
    expect(new URL(lookup!).searchParams.get('acct')).toBe('carol@refuses.example')
    expect(calls.some((u) => u.includes(`/accounts/${HOME_ACCOUNT.id}/statuses`))).toBe(true)
    expect(calls.every((u) => u.startsWith('https://example.social/'))).toBe(true)
    // The links stay on the remote route; no path host id reaches them.
    expect(el.shadowRoot!.querySelector('caribou-profile')!.getAttribute('handle')).toBe('carol@refuses.example')
    expect(deepHtml(el)).not.toContain('path-7')
  })

  it('an error page with no handle in its data still names the address', async () => {
    const { el } = mount({ kind: 'error', message: 'x', shell: SHELL, handle: '' }, '/@carol@refuses.example')
    await settle(el, () => text(el).includes('Couldn'))
    expect(text(el)).toContain("Couldn't load profile @carol@refuses.example.")
  })
})
