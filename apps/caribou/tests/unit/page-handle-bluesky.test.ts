import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as H3 from 'h3'
import type * as ClientModule from '@beatzball/caribou-mastodon-client'
import { activeUserKey, clearKeptAlive, users } from '@beatzball/caribou-state'
import { BLUESKY_FLAG_KEY } from '../../components/_bluesky.js'
import { blueskyClients } from '../../components/__tests__/_bluesky-clients.js'
import {
  ALICE, author, blueskyClient, fakeAgent, signInBluesky,
} from '../../components/__tests__/_bluesky-helpers.js'

// The profile and thread pages swap in a client render for a Bluesky route
// after hydration (#184; app README, "Bluesky views"): only with the flag on
// and a Bluesky account active, and never in the first render.

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

function signIn() {
  signInBluesky(blueskyClient(fakeAgent({
    getProfile: vi.fn(async () => ({ data: PROFILE })),
    getAuthorFeed: vi.fn(async () => ({ data: { feed: [] } })),
    getPosts: vi.fn(async () => ({ data: { posts: [] } })),
    getPostThread: vi.fn(async () => ({ data: { thread: { $type: 'app.bsky.feed.defs#notFoundPost', notFound: true } } })),
  })))
}

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
  localStorage.setItem(BLUESKY_FLAG_KEY, '1')
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

  it('no swap with the flag off', async () => {
    signIn()
    localStorage.removeItem(BLUESKY_FLAG_KEY)
    const { after } = await renders('page-handle', profileData('alice.example.com'))
    expect(after).toBe('article role=alert')
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

  it('swaps in the client thread by AT URI after the first render', async () => {
    signIn()
    const { first, after } = await renders('page-handle-statusid', threadData('alice.example.com'))
    expect(first).toBe('article role=alert')
    expect(after).toBe('caribou-thread statusid=at://alice.example.com/app.bsky.feed.post/3k1')
  })

  it('no swap with the flag off', async () => {
    signIn()
    localStorage.removeItem(BLUESKY_FLAG_KEY)
    expect((await renders('page-handle-statusid', threadData('alice.example.com'))).after).toBe('article role=alert')
  })
})
