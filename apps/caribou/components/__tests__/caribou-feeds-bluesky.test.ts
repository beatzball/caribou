import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ClientModule from '@beatzball/caribou-mastodon-client'
import type { Relationship } from '@beatzball/caribou-mastodon-client'
import type { UserKey } from '@beatzball/caribou-auth'
import {
  _resetSavedFeedsForTests, activeUserKey, addUserSession, clearKeptAlive, loadSavedFeeds, relationshipCache, relationshipKey, statusCache, users,
} from '@beatzball/caribou-state'
import '../caribou-feed-tabs.js'
import '../caribou-feeds.js'
import '../caribou-nav-rail.js'
import type { CaribouFeedTabs } from '../caribou-feed-tabs.js'
import type { CaribouFeeds } from '../caribou-feeds.js'
import type { CaribouNavRail } from '../caribou-nav-rail.js'
import type { CaribouTimeline } from '../caribou-timeline.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'
import { _testOnlyResetBlueskyVeil, _testOnlyVeilLoaded } from '../_bluesky-moderation.js'
import { feedFromSearch, feedPath } from '../_feed-path.js'
import { blueskyClients } from './_bluesky-clients.js'
import {
  BOB, asPostView, author, blueskyClient, fakeAgent, post, signInBluesky, type FakeAgent,
} from './_bluesky-helpers.js'

// Bluesky feeds (#194; README, "Bluesky feeds"): Home's feed tabs, a feed's
// timeline, the Feeds page and the nav item, with a real Bluesky client over
// a fake agent.

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
  observe() {}
  unobserve() {}
  disconnect() {}
}

const CATS = 'at://did:plc:alice/app.bsky.feed.generator/cats'
const DOGS = 'at://did:plc:alice/app.bsky.feed.generator/dogs'
const GONE = 'at://did:plc:alice/app.bsky.feed.generator/gone'
const OTHER = 'at://did:plc:alice/app.bsky.feed.generator/other'

const uri = (n: string | number) => `at://${BOB}/app.bsky.feed.post/p${n}`
function view(n: string | number) {
  const v = post({ author: author(BOB) })
  v.uri = uri(n)
  ;(v.record as { text: string }).text = `post ${n}`
  delete (v as { embed?: unknown }).embed
  return asPostView(v)
}
const entry = (n: string | number) => ({ post: view(n) })

const generator = (u: string, name: string) => ({
  uri: u, cid: 'bafyg', did: 'did:web:feeds.example.com', displayName: name, description: `${name} only`,
  indexedAt: '2026-01-01T00:00:00.000Z', creator: { did: 'did:plc:alice', handle: 'alice.example.com' },
})
const item = (id: string, type: string, value: string, pinned = true) => ({ id, type, value, pinned })

const PREFS = [
  item('t', 'timeline', 'following'),
  item('d', 'feed', DOGS),
  item('c', 'feed', CATS),
  item('g', 'feed', GONE),
  item('o', 'feed', OTHER, false),
]

let agent: FakeAgent & {
  getPreferences: ReturnType<typeof vi.fn>
  app: FakeAgent['app'] & { bsky: { feed: { getFeed: ReturnType<typeof vi.fn>; getFeedGenerators: ReturnType<typeof vi.fn> } } }
}

function signIn(o: { prefs?: unknown[]; getPreferences?: ReturnType<typeof vi.fn>; getFeed?: ReturnType<typeof vi.fn> } = {}) {
  const base = fakeAgent({
    getTimeline: vi.fn(async () => ({ data: { feed: [entry('home')] } })),
    getPreferences: o.getPreferences ?? vi.fn(async () => ({ savedFeeds: o.prefs ?? PREFS })),
  })
  agent = Object.assign(base, {
    app: {
      bsky: {
        ...base.app.bsky,
        feed: {
          getFeed: o.getFeed ?? vi.fn(async ({ feed }: { feed: string }) => ({ data: { feed: [entry(feed.split('/').pop()!)] } })),
          getFeedGenerators: vi.fn(async ({ feeds }: { feeds: string[] }) => ({
            data: { feeds: feeds.filter((f) => f !== GONE).map((f) => generator(f, f.split('/').pop()!.toUpperCase())) },
          })),
        },
      },
    },
  }) as typeof agent
  signInBluesky(blueskyClient(agent))
}

async function settle(el: HTMLElement & { updateComplete: Promise<boolean> }) {
  for (let i = 0; i < 4; i++) {
    await _testOnlyVeilLoaded()
    await new Promise((r) => setTimeout(r, 0))
    while (!(await el.updateComplete)) { /* settle */ }
    const tl = el.shadowRoot?.querySelector<CaribouTimeline>('caribou-timeline')
    if (tl) {
      while (!(await tl.updateComplete)) { /* settle */ }
      for (const card of tl.shadowRoot!.querySelectorAll<CaribouStatusCard>('caribou-status-card')) {
        while (!(await card.updateComplete)) { /* settle */ }
      }
    }
  }
}

async function mountTabs(feed = ''): Promise<CaribouFeedTabs> {
  const el = document.createElement('caribou-feed-tabs') as CaribouFeedTabs
  el.feed = feed
  document.body.appendChild(el)
  await settle(el)
  return el
}

const tabs = (el: CaribouFeedTabs) =>
  [...el.querySelectorAll('caribou-tabs a'), ...(el.shadowRoot!.querySelectorAll('caribou-tabs a'))]
    .map((a) => ({ text: a.textContent!.trim(), href: a.getAttribute('href'), current: a.getAttribute('aria-current') }))
const timelineOf = (el: CaribouFeedTabs) => el.shadowRoot!.querySelector<CaribouTimeline>('caribou-timeline')
const ids = (tl: CaribouTimeline) =>
  [...tl.shadowRoot!.querySelectorAll<CaribouStatusCard>('caribou-status-card')].map((c) => c.dataset.statusId)

beforeEach(() => {
  document.body.replaceChildren()
  history.replaceState(null, '', '/')
  clearKeptAlive()
  _resetSavedFeedsForTests()
  statusCache.value = new Map()
  relationshipCache.value = new Map()
  users.value = new Map()
  activeUserKey.value = null
  blueskyClients.clear()
  localStorage.clear()
  _testOnlyResetBlueskyVeil()
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
})
afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('feed addresses', () => {
  it('Following is /home; a feed is /home?feed=<uri>, and reads back', () => {
    expect(feedPath('')).toBe('/home')
    expect(feedPath(CATS)).toBe(`/home?feed=${encodeURIComponent(CATS)}`)
    expect(feedFromSearch(feedPath(CATS).slice('/home'.length))).toBe(CATS)
    expect(feedFromSearch('')).toBe('')
  })
})

describe('<caribou-feed-tabs>', () => {
  it('shows Following first, then the pinned feeds in the reader\'s order, on Following', async () => {
    signIn()
    const el = await mountTabs()
    expect(tabs(el)).toEqual([
      { text: 'Following', href: '/home', current: 'page' },
      { text: 'DOGS', href: feedPath(DOGS), current: null },
      { text: 'CATS', href: feedPath(CATS), current: null },
      { text: 'gone', href: feedPath(GONE), current: null },
    ])
    const tl = timelineOf(el)!
    expect(tl.kind).toBe('home')
    expect(ids(tl)).toEqual([uri('home')])
    // Read only: nothing but reads went out.
    expect(agent.getPreferences).toHaveBeenCalledTimes(1)
  })

  it('keeps Following first even when the reader put it after a feed', async () => {
    signIn({ prefs: [item('c', 'feed', CATS), item('t', 'timeline', 'following')] })
    const el = await mountTabs()
    expect(tabs(el).map((t) => t.text)).toEqual(['Following', 'CATS'])
  })

  it('shows a pinned feed\'s posts in its tab, through getFeed', async () => {
    signIn()
    const el = await mountTabs(CATS)
    expect(tabs(el).find((t) => t.current === 'page')?.text).toBe('CATS')
    const tl = timelineOf(el)!
    expect(tl.kind).toBe('feed')
    expect(agent.app.bsky.feed.getFeed).toHaveBeenCalledWith(expect.objectContaining({ feed: CATS }))
    expect(agent.getTimeline).not.toHaveBeenCalled()
    expect(ids(tl)).toEqual([uri('cats')])
  })

  it('hides a feed\'s cards when their author is muted or blocked after they rendered, as Following does', async () => {
    signIn({ getFeed: vi.fn(async () => ({ data: { feed: [entry(1), entry(2)] } })) })
    const el = await mountTabs(CATS)
    const tl = timelineOf(el)!
    const cards = () => [...tl.shadowRoot!.querySelectorAll<CaribouStatusCard>('caribou-status-card')]
    expect(cards()).toHaveLength(2)
    expect(cards().every((c) => !c.hidden)).toBe(true)
    const authorId = cards()[0]!.status!.account.id
    relationshipCache.value = new Map([[relationshipKey(activeUserKey.value!, authorId), { id: authorId, muting: true } as Relationship]])
    await settle(el)
    expect(cards().every((c) => c.hidden)).toBe(true)
    relationshipCache.value = new Map([[relationshipKey(activeUserKey.value!, authorId), { id: authorId, blocking: true } as Relationship]])
    await settle(el)
    expect(cards().every((c) => c.hidden)).toBe(true)
  })

  it('adds a tab at the end for a feed the address names that is not pinned', async () => {
    signIn()
    const el = await mountTabs(OTHER)
    expect(tabs(el).at(-1)).toEqual({ text: 'OTHER', href: feedPath(OTHER), current: 'page' })
  })

  it('says a gone feed is gone in its tab; once the list is known, asks nothing for its posts', async () => {
    signIn()
    await loadSavedFeeds()
    const el = await mountTabs(GONE)
    expect(timelineOf(el)).toBeNull()
    expect(el.shadowRoot!.querySelector('.notice')!.textContent).toContain('This feed is gone.')
    expect(agent.app.bsky.feed.getFeed).not.toHaveBeenCalled()
  })

  it('shows a failing feed\'s message with Retry, not an empty page', async () => {
    signIn({ getFeed: vi.fn(async () => { throw Object.assign(new Error('upstream'), { status: 502, error: 'UpstreamFailure' }) }) })
    const el = await mountTabs(CATS)
    const tl = timelineOf(el)!
    expect(tl.shadowRoot!.querySelector('[role="alert"]')!.textContent).toBe('This feed did not load. Try again later.')
    expect(tl.shadowRoot!.querySelector('[data-action="retry"]')).not.toBeNull()
  })

  it('says an unknown feed is gone when getFeed says UnknownFeed', async () => {
    signIn({ getFeed: vi.fn(async () => { throw Object.assign(new Error('Unknown feed'), { status: 400, error: 'UnknownFeed' }) }) })
    const el = await mountTabs('at://did:plc:alice/app.bsky.feed.generator/nope')
    const tl = timelineOf(el)!
    expect(tl.shadowRoot!.querySelector('[role="alert"]')!.textContent).toBe('This feed is gone. Its owner may have deleted it.')
  })

  it('has no row with only Following, or when the feeds fail to load', async () => {
    signIn({ prefs: [item('t', 'timeline', 'following')] })
    expect(tabs(await mountTabs())).toEqual([])
    document.body.replaceChildren()
    _resetSavedFeedsForTests()
    signIn({ getPreferences: vi.fn(async () => { throw Object.assign(new Error('down'), { status: 502 }) }) })
    const el = await mountTabs()
    expect(tabs(el)).toEqual([])
    expect(timelineOf(el)!.kind).toBe('home')
  })

  it('swaps a gone feed\'s timeline for the message when the list arrives, after one getFeed', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })
    signIn({
      getPreferences: vi.fn(async () => { await held; return { savedFeeds: PREFS } }),
      getFeed: vi.fn(async () => { throw Object.assign(new Error('Unknown feed'), { status: 400, error: 'UnknownFeed' }) }),
    })
    const el = await mountTabs(GONE)
    // First: the list is not known yet, so the tab asks for the feed.
    expect(timelineOf(el)).not.toBeNull()
    expect(agent.app.bsky.feed.getFeed).toHaveBeenCalledTimes(1)
    release()
    await settle(el)
    expect(timelineOf(el)).toBeNull()
    expect(el.shadowRoot!.querySelector('.notice')!.textContent).toContain('This feed is gone.')
    expect(agent.app.bsky.feed.getFeed).toHaveBeenCalledTimes(1)
  })

  it('keeps each tab\'s posts its own when an answer for the tab left behind lands late', async () => {
    let releaseCats!: () => void
    const catsHeld = new Promise<void>((r) => { releaseCats = r })
    signIn({ getFeed: vi.fn(async ({ feed }: { feed: string }) => {
      if (feed === CATS) await catsHeld
      return { data: { feed: [entry(feed.split('/').pop()!)] } }
    }) })
    const cats = await mountTabs(CATS)
    expect(ids(timelineOf(cats)!)).toEqual([])
    // A tab click is a new page: the old tab goes, the new one mounts.
    cats.remove()
    const dogs = await mountTabs(DOGS)
    expect(ids(timelineOf(dogs)!)).toEqual([uri('dogs')])
    releaseCats()
    await settle(dogs)
    expect(ids(timelineOf(dogs)!)).toEqual([uri('dogs')])
    // Back to Cats: its own post, kept from the late answer.
    dogs.remove()
    const back = await mountTabs(CATS)
    expect(ids(timelineOf(back)!)).toEqual([uri('cats')])
  })

  it('says so for an address that names no feed', async () => {
    signIn()
    const el = await mountTabs('https://example.com/not-a-feed')
    expect(timelineOf(el)).toBeNull()
    const notice = el.shadowRoot!.querySelector('.notice')!
    expect(notice.textContent).toContain('This address does not name a feed.')
    expect(notice.getAttribute('role')).toBe('status')
  })

  it('a feed is not polled every 30 s; Following is', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      signIn()
      const following = await mountTabs()
      const homeBefore = agent.getTimeline.mock.calls.length
      vi.advanceTimersByTime(65_000)
      await settle(following)
      expect(agent.getTimeline.mock.calls.length).toBeGreaterThan(homeBefore)
      following.remove()

      await mountTabs(CATS)
      const before = agent.app.bsky.feed.getFeed.mock.calls.length
      vi.advanceTimersByTime(65_000)
      await new Promise((r) => setTimeout(r, 0))
      expect(agent.app.bsky.feed.getFeed.mock.calls.length).toBe(before)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('<caribou-feeds>', () => {
  async function mountFeeds(): Promise<CaribouFeeds> {
    const el = document.createElement('caribou-feeds') as CaribouFeeds
    document.body.appendChild(el)
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 0))
      while (!(await el.updateComplete)) { /* settle */ }
    }
    return el
  }
  async function flushFeeds(el: CaribouFeeds) {
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 0))
      while (!(await el.updateComplete)) { /* settle */ }
    }
  }
  const rows = (el: CaribouFeeds) => [...el.shadowRoot!.querySelectorAll('li')].map((li) => ({
    name: li.querySelector('.name')!.textContent!.trim(),
    href: li.querySelector('a.name')?.getAttribute('href') ?? null,
    pinned: !!li.querySelector('.pinned'),
    gone: !!li.querySelector('.gone'),
  }))

  it('lists every saved feed in order, each linking to its Home tab; a gone one has no link', async () => {
    signIn()
    const el = await mountFeeds()
    expect(rows(el)).toEqual([
      { name: 'Following', href: '/home', pinned: true, gone: false },
      { name: 'DOGS', href: feedPath(DOGS), pinned: true, gone: false },
      { name: 'CATS', href: feedPath(CATS), pinned: true, gone: false },
      { name: 'gone', href: null, pinned: true, gone: true },
      { name: 'OTHER', href: feedPath(OTHER), pinned: false, gone: false },
    ])
    expect(el.shadowRoot!.textContent).toContain('by @alice.example.com')
    expect(el.shadowRoot!.textContent).toContain('CATS only')
  })

  it('Retry keeps its button, busy, until the answer; a failure keeps focus on it; success moves focus to the list', async () => {
    let gate: { resolve: () => void; fail: boolean } | null = null
    let calls = 0
    signIn({ getPreferences: vi.fn(async () => {
      calls++
      if (calls === 1) throw Object.assign(new Error('down'), { status: 502 })
      const g = { resolve: () => {}, fail: calls === 2 }
      await new Promise<void>((r) => { g.resolve = r; gate = g })
      if (g.fail) throw Object.assign(new Error('still down'), { status: 502 })
      return { savedFeeds: PREFS }
    }) })
    const el = await mountFeeds()
    const button = el.shadowRoot!.querySelector<HTMLElement>('caribou-button')!
    button.focus()
    expect(el.shadowRoot!.activeElement).toBe(button)

    // A Retry that fails again.
    button.click()
    await flushFeeds(el)
    expect(button.isConnected).toBe(true)
    expect((button as HTMLElement & { loading: boolean }).loading).toBe(true)
    expect(el.shadowRoot!.activeElement).toBe(button)
    gate!.resolve()
    await flushFeeds(el)
    expect(el.shadowRoot!.querySelector('caribou-button')).toBe(button)
    expect((button as HTMLElement & { loading: boolean }).loading).toBe(false)
    expect(el.shadowRoot!.activeElement).toBe(button)
    expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toBe('still down')

    // A Retry that works: the button goes, focus goes to the list.
    button.click()
    await flushFeeds(el)
    expect(button.isConnected).toBe(true)
    gate!.resolve()
    await flushFeeds(el)
    expect(button.isConnected).toBe(false)
    expect(rows(el)).toHaveLength(5)
    expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector('ul'))
  })

  it('shows a failed load with Retry, and Retry loads again', async () => {
    let fail = true
    signIn({ getPreferences: vi.fn(async () => {
      if (fail) throw Object.assign(new Error('down'), { status: 502 })
      return { savedFeeds: PREFS }
    }) })
    const el = await mountFeeds()
    expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toBe('down')
    fail = false
    el.shadowRoot!.querySelector<HTMLElement>('caribou-button')!.click()
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 0))
      while (!(await el.updateComplete)) { /* settle */ }
    }
    expect(rows(el)).toHaveLength(5)
  })
})

describe('<caribou-nav-rail> Feeds item', () => {
  async function mountRail(): Promise<CaribouNavRail> {
    const el = document.createElement('caribou-nav-rail') as CaribouNavRail
    document.body.appendChild(el)
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 0))
      while (!(await el.updateComplete)) { /* settle */ }
    }
    return el
  }
  const hrefs = (el: CaribouNavRail) =>
    [...el.shadowRoot!.querySelectorAll('nav a[href]')].map((a) => a.getAttribute('href'))

  it('shows Feeds with a Bluesky account active', async () => {
    signIn()
    expect(hrefs(await mountRail())).toContain('/feeds')
  })

  it('leaves Feeds out signed out', async () => {
    expect(hrefs(await mountRail())).not.toContain('/feeds')
  })

  it('leaves Feeds out with a Mastodon account active', async () => {
    addUserSession({
      userKey: 'alice@example.social' as UserKey, server: 'example.social', token: 't', vapidKey: '', account: null, createdAt: 0,
    })
    const el = await mountRail()
    expect(hrefs(el)).toContain('/local')
    expect(hrefs(el)).not.toContain('/feeds')
  })
})
