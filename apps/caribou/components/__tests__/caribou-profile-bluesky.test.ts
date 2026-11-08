import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ClientModule from '@beatzball/caribou-mastodon-client'
import type { Account } from '@beatzball/caribou-mastodon-client'
import { activeUserKey, clearKeptAlive, statusCache, users } from '@beatzball/caribou-state'
import '../caribou-profile.js'
import type { CaribouProfile, ProfileInitial } from '../caribou-profile.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'
import { _testOnlyResetBlueskyVeil, _testOnlyVeilLoaded } from '../_bluesky-moderation.js'
import { blueskyClients } from './_bluesky-clients.js'
import {
  ALICE, asPostView, author, blueskyClient, fakeAgent, post, signInBluesky, type FakeAgent,
} from './_bluesky-helpers.js'

// A Bluesky profile, rendered on the client (#184): the account and its
// posts, replies and media tabs through a real Bluesky client.

vi.mock('@beatzball/caribou-mastodon-client', async (importOriginal) => {
  const real = await importOriginal<typeof ClientModule>()
  const { blueskyClients: made } = await import('./_bluesky-clients.js')
  return {
    ...real,
    createCaribouClient: (...args: Parameters<typeof real.createCaribouClient>) =>
      (made.get(args[0]) as ReturnType<typeof real.createCaribouClient> | undefined) ?? real.createCaribouClient(...args),
  }
})

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  targets = new Set<Element>()
  constructor(private callback: (entries: IntersectionObserverEntry[]) => void) {
    FakeIntersectionObserver.instances.push(this)
  }
  observe(el: Element) { this.targets.add(el) }
  unobserve(el: Element) { this.targets.delete(el) }
  disconnect() { this.targets.clear() }
  fire() {
    this.callback([...this.targets].map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry))
  }
}

const uri = (n: string | number) => `at://${ALICE}/app.bsky.feed.post/p${n}`
function entry(n: string | number) {
  const v = post()
  v.uri = uri(n)
  delete (v as { embed?: unknown }).embed
  return { post: asPostView(v) }
}
const broken = (n: string | number) => ({ post: { ...entry(n).post, author: undefined } })

const PROFILE = { ...author(ALICE), description: 'bio', followersCount: 1, followsCount: 2, postsCount: 3 }

async function settle(el: CaribouProfile) {
  for (let i = 0; i < 5; i++) {
    await _testOnlyVeilLoaded()
    await new Promise((r) => setTimeout(r, 0))
    while (!(await el.updateComplete)) { /* settle */ }
    for (const card of el.shadowRoot!.querySelectorAll<CaribouStatusCard>('caribou-status-card')) {
      while (!(await card.updateComplete)) { /* settle */ }
    }
  }
}

async function mount(tab: ProfileInitial['tab'] = 'posts', initial: ProfileInitial | null = null): Promise<CaribouProfile> {
  const el = document.createElement('caribou-profile') as CaribouProfile
  el.handle = 'alice.example.com'
  el.tab = tab
  el.initial = initial
  document.body.appendChild(el)
  await settle(el)
  return el
}

const ids = (el: CaribouProfile) =>
  [...el.shadowRoot!.querySelectorAll<CaribouStatusCard>('caribou-status-card')].map((c) => c.dataset.statusId)
const next = (el: CaribouProfile) => el.shadowRoot!.querySelector<HTMLAnchorElement>('a[rel="next"]')

let agent: FakeAgent

beforeEach(() => {
  document.body.replaceChildren()
  history.replaceState(null, '', '/')
  clearKeptAlive()
  statusCache.value = new Map()
  users.value = new Map()
  activeUserKey.value = null
  blueskyClients.clear()
  localStorage.clear()
  _testOnlyResetBlueskyVeil()
  FakeIntersectionObserver.instances = []
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  agent = fakeAgent({ getProfile: vi.fn(async () => ({ data: PROFILE })) })
  signInBluesky(blueskyClient(agent))
})
afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('<caribou-profile> for a Bluesky account', () => {
  it.each([
    ['posts', 'posts_no_replies'],
    ['replies', 'posts_with_replies'],
    ['media', 'posts_with_media'],
  ] as const)('the %s tab reads the author feed with %s', async (tab, filter) => {
    agent.getAuthorFeed.mockResolvedValue({ data: { feed: [entry(2), entry(1)] } })
    const el = await mount(tab)
    expect(agent.getProfile).toHaveBeenCalledWith({ actor: 'alice.example.com' })
    expect(agent.getAuthorFeed).toHaveBeenCalledWith(expect.objectContaining({ actor: ALICE, filter, includePins: false }))
    expect(ids(el)).toEqual([uri(2), uri(1)])
    const header = el.shadowRoot!.querySelector('caribou-profile-header') as HTMLElement & { account: Account }
    expect(header.account.acct).toBe('alice.example.com')
    const tabs = el.shadowRoot!.querySelector('caribou-profile-tabs')!
    expect(tabs.getAttribute('handle')).toBe('alice.example.com')
  })

  it('an empty first page with a cursor keeps the anchor and loads on', async () => {
    agent.getAuthorFeed.mockImplementation(async ({ cursor }: { cursor?: string }) => cursor === 'c1'
      ? { data: { feed: [entry(7)] } }
      : { data: { feed: [broken(1)], cursor: 'c1' } })
    const el = await mount()
    expect(ids(el)).toEqual([])
    expect(next(el)!.getAttribute('href')).toBe('/@alice.example.com?tab=posts&max_id=c1')
    FakeIntersectionObserver.instances.at(-1)!.fire()
    await settle(el)
    expect(ids(el)).toEqual([uri(7)])
    expect(next(el)).toBeNull()
  })

  it('page data with no posts and a cursor renders the anchor in the first render', async () => {
    const account = await blueskyClient(agent).lookupAccount('alice.example.com')
    const el = document.createElement('caribou-profile') as CaribouProfile
    el.handle = 'alice.example.com'
    el.initial = { account, statuses: [], nextCursor: 'c9', tab: 'posts' }
    let first: string | null | undefined
    el.addController({ hostUpdated: () => { first ??= next(el)?.getAttribute('href') ?? null } })
    document.body.appendChild(el)
    await settle(el)
    expect(first).toBe('/@alice.example.com?tab=posts&max_id=c9')
  })
})
