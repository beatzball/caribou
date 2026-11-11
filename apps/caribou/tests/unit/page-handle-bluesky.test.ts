import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as H3 from 'h3'
import type * as ClientModule from '@beatzball/caribou-mastodon-client'
import { activeUserKey, clearKeptAlive, users } from '@beatzball/caribou-state'
import { blueskyClients } from '../../components/__tests__/_bluesky-clients.js'
import {
  ALICE, author, blueskyClient, fakeAgent, post, publicPost, signInBluesky, type FakeAgent,
} from '../../components/__tests__/_bluesky-helpers.js'

// The profile and thread pages swap in a client render for a Bluesky route
// after hydration (#184; app README, "Bluesky views"): only with a Bluesky
// account active, and never in the first render.

vi.mock('../../server/lib/resolve-instance.js', () => ({ resolveInstanceForRoute: vi.fn() }))
vi.mock('../../server/lib/instance-cookie.js', () => ({ getInstance: vi.fn() }))
vi.mock('../../server/lib/mastodon-public.js', () => ({
  fetchAccountByHandle: vi.fn(), fetchAccountStatuses: vi.fn(), fetchStatus: vi.fn(), fetchThreadContext: vi.fn(),
}))
vi.mock('../../server/lib/storage.js', () => ({ getStorage: () => ({ getItem: async () => null }) }))
vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof H3>('h3')
  return { ...actual, getRequestURL: () => new URL('http://localhost:3000/') }
})
vi.mock('@beatzball/caribou-mastodon-client', async (importOriginal) => {
  const real = await importOriginal<typeof ClientModule>()
  const { blueskyClients: made } = await import('../../components/__tests__/_bluesky-clients.js')
  return {
    ...real,
    createCaribouClient: (...args: Parameters<typeof real.createCaribouClient>) =>
      (made.get(args[0]) as ReturnType<typeof real.createCaribouClient> | undefined) ?? real.createCaribouClient(...args),
  }
})

const PROFILE = { ...author(ALICE), description: 'bio', followersCount: 1, followsCount: 2, postsCount: 3 }
const SHELL = { instance: 'example.social', source: 'cookie' }

function signIn(overrides: Partial<FakeAgent> = {}): FakeAgent {
  const agent = fakeAgent({
    getProfile: vi.fn(async () => ({ data: PROFILE })),
    getAuthorFeed: vi.fn(async () => ({ data: { feed: [] } })),
    getPosts: vi.fn(async () => ({ data: { posts: [] } })),
    getPostThread: vi.fn(async () => ({ data: { thread: { $type: 'app.bsky.feed.defs#notFoundPost', notFound: true } } })),
    ...overrides,
  })
  signInBluesky(blueskyClient(agent))
  return agent
}

// Every URI the client sent to getPosts.
const askedPosts = (agent: FakeAgent) => agent.getPosts.mock.calls.flatMap(([q]) => (q as { uris: string[] }).uris)

// The first render (the one that hydrates the server's markup) and the
// render after mount, as tag names with their attributes.
async function renders(tag: string, serverData: unknown) {
  const el = document.createElement(tag) as HTMLElement & { serverData: unknown; updateComplete: Promise<boolean>; addController: (c: object) => void }
  el.serverData = serverData
  let first: string | null = null
  const describe = () => {
    const inner = el.shadowRoot!.querySelector('caribou-app-shell')?.firstElementChild
    return inner ? `${inner.localName} ${[...inner.attributes].map((a) => `${a.name}=${a.value}`).join(' ')}`.trim() : null
  }
  el.addController({ hostUpdated: () => { first ??= describe() } })
  document.body.appendChild(el)
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0))
    while (!(await el.updateComplete)) { /* settle */ }
  }
  return { first, after: describe() }
}

const profileData = (handle: string, kind = 'error') => ({ kind, message: '', shell: SHELL, handle })

beforeAll(async () => {
  await import('../../pages/@[handle].js')
  await import('../../pages/@[handle]/[statusId].js')
})
beforeEach(() => {
  document.body.replaceChildren()
  history.replaceState(null, '', '/')
  clearKeptAlive()
  users.value = new Map()
  activeUserKey.value = null
  blueskyClients.clear()
  localStorage.clear()
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('<page-handle> for a Bluesky route', () => {
  it('a handle route: the first render is the server\'s, then the client profile', async () => {
    signIn()
    const { first, after } = await renders('page-handle', profileData('alice.example.com'))
    expect(first).toBe('article role=alert')
    expect(after).toBe('caribou-profile handle=alice.example.com link-handle= tab=posts')
  })

  it('keeps the tab from the address', async () => {
    signIn()
    history.replaceState(null, '', '/@alice.example.com?tab=media')
    const { after } = await renders('page-handle', profileData('alice.example.com'))
    expect(after).toBe('caribou-profile handle=alice.example.com link-handle= tab=media')
  })

  it('a DID route', async () => {
    signIn()
    const { after } = await renders('page-handle', profileData(ALICE))
    expect(after).toBe(`caribou-profile handle=${ALICE} link-handle= tab=posts`)
  })

  it('/@me looks the account up by its DID and keeps /@me in its links', async () => {
    signIn()
    const { first, after } = await renders('page-handle', profileData('me', 'auth-required'))
    expect(first).toContain('caribou-auth-required')
    expect(after).toBe('caribou-profile handle=did:plc:reader link-handle=me tab=posts')
  })

  it('no swap for a Mastodon route, nor with no Bluesky account', async () => {
    signIn()
    expect((await renders('page-handle', profileData('alice@example.social'))).after).toBe('article role=alert')
    users.value = new Map()
    activeUserKey.value = null
    expect((await renders('page-handle', profileData('alice.example.com'))).after).toBe('article role=alert')
  })
})

describe('<page-handle-statusid> for a Bluesky route', () => {
  const threadData = (handle: string) => ({ kind: 'error', message: '', shell: SHELL, handle, statusId: '3k1' })

  const DID_URI = `at://${ALICE}/app.bsky.feed.post/3k1`

  // README, "Bluesky views": the thread's id is always the DID form (#271).
  it('rule 3: a handle route looks the DID up, then swaps in the thread by its DID URI', async () => {
    const agent = signIn()
    const { first, after } = await renders('page-handle-statusid', threadData('alice.example.com'))
    expect(first).toBe('article role=alert')
    expect(after).toBe(`caribou-thread statusid=${DID_URI}`)
    expect(agent.getProfile).toHaveBeenCalledWith({ actor: 'alice.example.com' })
  })

  it('rule 3: a handle route sends no handle URI to getPosts (the AppView answers 500)', async () => {
    const agent = signIn()
    await renders('page-handle-statusid', threadData('alice.example.com'))
    expect(askedPosts(agent).length).toBeGreaterThan(0)
    expect(askedPosts(agent).every((u) => u.startsWith(`at://${ALICE}/`))).toBe(true)
  })

  it('rule 2: a DID route needs no lookup', async () => {
    const agent = signIn()
    const { after } = await renders('page-handle-statusid', threadData(ALICE))
    expect(after).toBe(`caribou-thread statusid=${DID_URI}`)
    expect(agent.getProfile).not.toHaveBeenCalled()
  })

  it('rule 1: a handle route whose server thread loaded uses that thread\'s DID URI, with no lookup', async () => {
    const agent = signIn()
    const focused = publicPost({ ...post(), uri: DID_URI })
    const ok = { kind: 'ok', focused, ancestors: [], descendants: [], shell: SHELL, handle: 'alice.example.com', statusId: '3k1' }
    const { after } = await renders('page-handle-statusid', ok)
    expect(after).toBe(`caribou-thread statusid=${DID_URI}`)
    expect(agent.getProfile).not.toHaveBeenCalled()
  })

  it('rule 3: while the lookup runs, the loading shell, not the server\'s alert', async () => {
    let answer: (v: unknown) => void = () => {}
    signIn({ getProfile: vi.fn(() => new Promise((r) => { answer = r })) })
    const { first, after } = await renders('page-handle-statusid', threadData('alice.example.com'))
    expect(first).toBe('article role=alert')
    expect(after).toBe('article role=status aria-busy=true')
    answer({ data: PROFILE })
  })

  it('rule 3: a failed lookup says the post could not load, and fetches no post', async () => {
    // A deferred page starts as the loading shell: the alert comes only
    // from the failed lookup.
    const agent = signIn({ getProfile: vi.fn(async () => { throw new Error('profile not found') }) })
    history.replaceState(null, '', '/@alice.example.com/3k1')
    const deferred = { kind: 'deferred', appview: 'http://appview.test', shell: SHELL, handle: '', statusId: '' }
    const { first, after } = await renders('page-handle-statusid', deferred)
    expect(first).toBe('article role=status aria-busy=true')
    expect(after).toBe('article role=alert')
    expect(agent.getPosts).not.toHaveBeenCalled()
  })
})

describe('Bluesky SSR data in the client (#185, #186)', () => {
  const hidden = { kind: 'hidden', shell: SHELL, handle: '' }
  const okProfile = (handle: string) => ({
    kind: 'ok', shell: SHELL, handle, tab: 'posts', nextCursor: null, statuses: [],
    account: {
      id: ALICE, acct: 'alice.example.com', username: 'alice.example.com', url: '', displayName: 'Alice', note: '',
      avatar: '', avatarStatic: '', header: '', headerStatic: '', locked: false, fields: [], emojis: [],
      bot: false, group: false, createdAt: '', statusesCount: 0, followersCount: 0, followingCount: 0, roles: [],
      bluesky: { did: ALICE, handleInvalid: false, labels: [] },
    },
  })

  it('a hidden profile, signed out: the notice, in the first render and after', async () => {
    history.replaceState(null, '', '/@hana.example.com')
    const { first, after } = await renders('page-handle', hidden)
    expect(first).toBe('article role=status')
    expect(after).toBe('article role=status')
  })

  it('a hidden profile, with a Bluesky account: the client profile, by the handle in the address', async () => {
    signIn()
    history.replaceState(null, '', '/@hana.example.com')
    const { first, after } = await renders('page-handle', hidden)
    expect(first).toBe('article role=status')
    expect(after).toBe('caribou-profile handle=hana.example.com link-handle= tab=posts')
  })

  it('a hidden profile, with a Mastodon account: still the notice', async () => {
    users.value = new Map([['bob@example.social', { userKey: 'bob@example.social', server: 'example.social', token: 'T', vapidKey: '', account: {}, createdAt: 1 } as never]])
    activeUserKey.value = 'bob@example.social'
    history.replaceState(null, '', '/@hana.example.com')
    expect((await renders('page-handle', hidden)).after).toBe('article role=status')
  })

  it('a profile opened by DID shows the handle form in the address bar after the first render', async () => {
    history.replaceState(null, '', `/@${ALICE}?tab=posts#x`)
    const { first } = await renders('page-handle', okProfile(ALICE))
    expect(first).toContain('caribou-profile')
    expect(location.pathname + location.search + location.hash).toBe('/@alice.example.com?tab=posts#x')
  })

  it('a profile opened by handle, or with an invalid handle, keeps its address', async () => {
    history.replaceState(null, '', '/@alice.example.com')
    await renders('page-handle', okProfile('alice.example.com'))
    expect(location.pathname).toBe('/@alice.example.com')
    history.replaceState(null, '', `/@${ALICE}`)
    const data = okProfile(ALICE)
    data.account.bluesky.handleInvalid = true
    await renders('page-handle', data)
    expect(location.pathname).toBe(`/@${ALICE}`)
  })
})

describe('a deferred page with a Bluesky account (#187)', () => {
  // The signed-in render reads through the reader's own client: the public
  // AppView the server named is never asked.
  let appviewCalls: string[] = []
  beforeEach(() => {
    appviewCalls = []
    const real = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('http://appview.test')) appviewCalls.push(url)
      return real(input, init)
    }))
  })
  afterEach(() => {
    expect(appviewCalls).toEqual([])
  })

  it('the profile swaps in the client render, by the address', async () => {
    signIn()
    history.replaceState(null, '', '/@alice.example.com?tab=replies')
    const { first, after } = await renders('page-handle', { kind: 'deferred', appview: 'http://appview.test', shell: SHELL, handle: '' })
    expect(first).toBe('article role=status aria-busy=true')
    expect(after).toBe('caribou-profile handle=alice.example.com link-handle= tab=replies')
  })

  it('the thread swaps in the client render, with the post id from the address', async () => {
    signIn()
    history.replaceState(null, '', '/@alice.example.com/3k1')
    const { first, after } = await renders('page-handle-statusid', { kind: 'deferred', appview: 'http://appview.test', shell: SHELL, handle: '', statusId: '' })
    expect(first).toBe('article role=status aria-busy=true')
    expect(after).toBe(`caribou-thread statusid=at://${ALICE}/app.bsky.feed.post/3k1`)
  })
})
