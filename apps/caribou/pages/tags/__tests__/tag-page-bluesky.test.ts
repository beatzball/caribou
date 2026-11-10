import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ClientModule from '@beatzball/caribou-mastodon-client'
import type { Capabilities, CaribouClient } from '@beatzball/caribou-mastodon-client'
import {
  activeUserKey, addUserSession, blueskyUserKey, setBlueskyDriver, users, type BlueskyDriver, type UserSession,
} from '@beatzball/caribou-state'

// `/tags/<tag>` for a Bluesky reader (app README, "Bluesky search and
// hashtag page"): the page shows the Bluesky body and rewrites the address
// to `?net=bsky`. Once rewritten, the body stays the Bluesky one whatever
// account is active, so the address and the body agree (#251 round 2).

vi.mock('../../../server/lib/resolve-instance.js', () => ({ resolveInstanceForRoute: vi.fn() }))
vi.mock('../../../server/lib/mastodon-public.js', () => ({ fetchTagTimeline: vi.fn() }))
vi.mock('../../../server/lib/storage.js', () => ({ getStorage: () => ({ getItem: async () => null }) }))
// A Mastodon client that never reaches the network.
vi.mock('@beatzball/caribou-mastodon-client', async (importOriginal) => {
  const real = await importOriginal<typeof ClientModule>()
  return {
    ...real,
    createCaribouClient: (userKey: string) => new Proxy({ userKey, capabilities: real.MASTODON_CAPABILITIES, timelineOrder: () => null }, {
      get: (target, prop) => prop in target ? target[prop as keyof typeof target]
        : () => Promise.reject(new real.CaribouError('unreachable', 'test: no network')),
    }),
  }
})

const CAPS = { network: 'bluesky', readLagMs: 60_000, followTags: false } as unknown as Capabilities
const alice = blueskyUserKey('did:plc:alice')
const driver: BlueskyDriver = {
  capabilities: CAPS,
  timelineOrder: () => null,
  restore: async (s) => ({
    userKey: s.userKey, capabilities: CAPS, timelineOrder: () => null,
    fetchTimeline: async () => Object.assign([], { nextCursor: null }),
  }) as unknown as CaribouClient,
  signOut: async () => {},
}

function signInBluesky() {
  const s: UserSession = {
    network: 'bluesky', userKey: alice, did: 'did:plc:alice', handle: 'alice.example.com',
    pds: 'https://pds.example.test', generation: 'G1', account: null, createdAt: 1,
  }
  users.value = new Map([...users.value, [alice, s]])
  activeUserKey.value = alice
}

function signInMastodon() {
  addUserSession({
    userKey: 'me@example.social', server: 'example.social', token: 'TOKEN', vapidKey: '',
    account: { id: '1', acct: 'me' }, createdAt: 1,
  } as unknown as UserSession)
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))
type Page = HTMLElement & { serverData: unknown; updateComplete: Promise<boolean> }

async function settle(el: Page) {
  for (let i = 0; i < 3; i++) {
    await flush()
    await el.updateComplete
  }
}

const shell = { instance: 'example.social' }
const okData = (tag: string) => ({ kind: 'ok', statuses: [], nextCursor: null, shell, tag })

async function mount(data: unknown): Promise<Page> {
  await import('../[tag].js')
  const el = document.createElement('page-tags-tag') as Page
  el.serverData = data
  document.body.appendChild(el)
  await settle(el)
  return el
}

const blueskyBody = (el: Page) => el.shadowRoot!.querySelector('caribou-bluesky-tag')
const mastodonTimeline = (el: Page) => el.shadowRoot!.querySelector('caribou-app-shell > div > caribou-timeline')

beforeEach(() => {
  setBlueskyDriver(driver)
  localStorage.clear()
  users.value = new Map()
  activeUserKey.value = null
})

afterEach(() => {
  document.body.replaceChildren()
  setBlueskyDriver(null)
  users.value = new Map()
  activeUserKey.value = null
})

describe('page-tags-tag with a Bluesky reader', () => {
  it.each(['ok', 'auth-required'])('keeps the Bluesky body after the rewrite, through a switch to Mastodon (%s)', async (kind) => {
    history.replaceState(null, '', '/tags/cats')
    signInBluesky()
    const el = await mount(kind === 'ok' ? okData('cats') : { kind: 'auth-required', shell: { instance: null }, tag: 'cats' })
    expect(location.pathname + location.search).toBe('/tags/cats?net=bsky')
    expect(blueskyBody(el)).not.toBeNull()
    signInMastodon()
    await settle(el)
    expect(location.pathname + location.search).toBe('/tags/cats?net=bsky')
    expect(blueskyBody(el)).not.toBeNull()
    expect(mastodonTimeline(el)).toBeNull()
  })

  it('shows the Mastodon timeline to a Mastodon reader and leaves the address alone', async () => {
    history.replaceState(null, '', '/tags/cats')
    signInMastodon()
    const el = await mount(okData('cats'))
    expect(location.pathname + location.search).toBe('/tags/cats')
    expect(blueskyBody(el)).toBeNull()
    expect(mastodonTimeline(el)).not.toBeNull()
  })

  // Fable round 2, note 3: new page data on the same element checks again.
  it('rewrites the address again when the page gets new data for another tag', async () => {
    history.replaceState(null, '', '/tags/cats')
    signInBluesky()
    const el = await mount(okData('cats'))
    expect(location.search).toBe('?net=bsky')
    history.replaceState(null, '', '/tags/dogs')
    el.serverData = okData('dogs')
    await settle(el)
    expect(location.pathname + location.search).toBe('/tags/dogs?net=bsky')
    expect(blueskyBody(el)!.getAttribute('tag')).toBe('dogs')
  })
})
