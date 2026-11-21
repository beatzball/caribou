import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ClientModule from '@beatzball/caribou-mastodon-client'
import {
  activeUserKey, clearKeptAlive, statusCache, users, type TimelineStore,
} from '@beatzball/caribou-state'
import '../caribou-timeline.js'
import type { CaribouTimeline, TimelineInitial, TimelineKind } from '../caribou-timeline.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'
import { _testOnlyResetBlueskyVeil, _testOnlyVeilLoaded } from '../_bluesky-moderation.js'
import { blueskyClients } from './_bluesky-clients.js'
import {
  BOB, asPostView, author, blueskyClient, fakeAgent, post, signInBluesky, type FakeAgent,
} from './_bluesky-helpers.js'

// The Following feed and Bluesky bookmarks through `<caribou-timeline>`
// with a real Bluesky client over a fake agent (#184).

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

const uri = (n: string | number) => `at://${BOB}/app.bsky.feed.post/p${n}`

function view(n: string | number, text = `post ${n}`) {
  const v = post({ author: author(BOB) })
  v.uri = uri(n)
  ;(v.record as { text: string }).text = text
  delete (v as { embed?: unknown }).embed
  return asPostView(v)
}
const entry = (n: string | number) => ({ post: view(n) })
// A post the mapper cannot read: no author.
const broken = (n: string | number) => ({ post: { ...view(n), author: undefined } })
const notFound = (n: string | number) => ({
  item: { $type: 'app.bsky.feed.defs#notFoundPost', uri: uri(`gone${n}`), notFound: true },
})
const bookmark = (n: string | number) => ({ item: view(n) })

const storeOf = (tl: CaribouTimeline) => (tl as unknown as { store: TimelineStore }).store

async function settle(tl: CaribouTimeline) {
  for (let i = 0; i < 4; i++) {
    await _testOnlyVeilLoaded()
    await new Promise((r) => setTimeout(r, 0))
    while (!(await tl.updateComplete)) { /* settle */ }
    for (const card of tl.shadowRoot!.querySelectorAll<CaribouStatusCard>('caribou-status-card')) {
      while (!(await card.updateComplete)) { /* settle */ }
    }
  }
}

async function mount(kind: TimelineKind, initial: TimelineInitial | null = null): Promise<CaribouTimeline> {
  const tl = document.createElement('caribou-timeline') as CaribouTimeline
  tl.kind = kind
  tl.initial = initial
  document.body.appendChild(tl)
  await settle(tl)
  return tl
}

const ids = (tl: CaribouTimeline) =>
  [...tl.shadowRoot!.querySelectorAll<CaribouStatusCard>('caribou-status-card')].map((c) => c.dataset.statusId)
const notice = (tl: CaribouTimeline) => tl.shadowRoot!.querySelector('.notice')?.textContent ?? null
const sentinel = (tl: CaribouTimeline) => tl.shadowRoot!.querySelector<HTMLAnchorElement>('a[data-sentinel]')

async function scrollToEnd(tl: CaribouTimeline) {
  FakeIntersectionObserver.instances.at(-1)!.fire()
  await settle(tl)
}

let agent: FakeAgent

function signIn(over: Record<string, unknown>) {
  agent = fakeAgent(over)
  signInBluesky(blueskyClient(agent))
}

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
})
afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Following feed', () => {
  it('Home is the Following feed, in feed order, a repost of an old post in place', async () => {
    const repost = {
      post: view('old'),
      reason: {
        $type: 'app.bsky.feed.defs#reasonRepost', by: author(BOB), uri: `at://${BOB}/app.bsky.feed.repost/r1`,
        cid: 'bafyrepost', indexedAt: '2026-11-06T00:00:00.000Z',
      },
    }
    signIn({ getTimeline: vi.fn(async () => ({ data: { feed: [entry(3), repost, entry(1)], cursor: 'c1' } })) })
    const tl = await mount('home')
    expect(agent.getTimeline).toHaveBeenCalled()
    expect(ids(tl)).toEqual([uri(3), `at://${BOB}/app.bsky.feed.repost/r1`, uri(1)])
    expect(tl.shadowRoot!.textContent).not.toContain('Checking this post')
  })

  it('a catch-up that does not meet the top post says "Many new posts" and replaces the list', async () => {
    let polling = false
    signIn({
      getTimeline: vi.fn(async ({ cursor }: { cursor?: string }) => {
        if (!polling) return { data: { feed: [entry(1), entry(0)], cursor: 'old' } }
        // Three full pages of new posts, none of them the known top post.
        const i = cursor ? Number(cursor) : 0
        return { data: { feed: Array.from({ length: 50 }, (_, k) => entry(`n${i * 50 + k}`)), cursor: String(i + 1) } }
      }),
    })
    const tl = await mount('home')
    expect(ids(tl)).toEqual([uri(1), uri(0)])
    const region = tl.shadowRoot!.querySelector('caribou-new-posts-banner')!.shadowRoot!.querySelector('[role="status"]')!
    expect(region).not.toBeNull()
    expect(region.textContent).toBe('')
    const reader = document.createElement('button')
    document.body.append(reader)
    reader.focus()
    polling = true
    await storeOf(tl).poll()
    await settle(tl)
    expect(storeOf(tl).gap.value).toBe(true)
    const banner = tl.shadowRoot!.querySelector('caribou-new-posts-banner')!
    await (banner as unknown as { updateComplete: Promise<boolean> }).updateComplete
    const button = banner.shadowRoot!.querySelector<HTMLElement>('[data-action="apply-new-posts"]')!
    expect(button.textContent!.trim()).toBe('Many new posts')
    expect(banner.shadowRoot!.querySelector('[role="status"]')).toBe(region)
    expect(region.textContent).toBe('Many new posts available.')
    expect(document.activeElement).toBe(reader)
    button.click()
    await settle(tl)
    expect(ids(tl)[0]).toBe(uri('n0'))
    expect(ids(tl)).not.toContain(uri(1))
  })

  it('a first page where no post could be mapped keeps a way to load more', async () => {
    signIn({
      getTimeline: vi.fn(async ({ cursor }: { cursor?: string }) => cursor === 'c1'
        ? { data: { feed: [entry(9)] } }
        : { data: { feed: [broken(1), broken(2)], cursor: 'c1' } }),
    })
    const tl = await mount('home')
    expect(ids(tl)).toEqual([])
    expect(notice(tl)).toBeNull()
    expect(sentinel(tl)).not.toBeNull()
    await scrollToEnd(tl)
    expect(ids(tl)).toEqual([uri(9)])
    // That page had no cursor: the real end.
    expect(sentinel(tl)).toBeNull()
  })

  it('an empty feed at its real end shows the empty notice', async () => {
    signIn({ getTimeline: vi.fn(async () => ({ data: { feed: [] } })) })
    const tl = await mount('home')
    expect(notice(tl)).toBe('No posts yet.')
    expect(sentinel(tl)).toBeNull()
  })
})

describe('Bluesky bookmarks', () => {
  it('five pages of unavailable bookmarks then a live one: no empty notice on the way', async () => {
    signIn({})
    // Pages 0–4 hold only deleted posts; page 5 has a live one; then the end.
    agent.app.bsky.bookmark.getBookmarks.mockImplementation(async ({ cursor }: { cursor?: string }) => {
      const i = cursor ? Number(cursor) : 0
      if (i < 5) return { data: { bookmarks: [notFound(i)], cursor: String(i + 1) } }
      return { data: { bookmarks: [bookmark('live')] } }
    })
    const tl = await mount('bookmarks')
    // The client read five pages and answered empty, with the last cursor.
    expect(agent.app.bsky.bookmark.getBookmarks).toHaveBeenCalledTimes(5)
    expect(ids(tl)).toEqual([])
    expect(notice(tl)).toBeNull()
    expect(sentinel(tl)).not.toBeNull()
    await scrollToEnd(tl)
    expect(ids(tl)).toEqual([uri('live')])
    expect(notice(tl)).toBeNull()
    expect(sentinel(tl)).toBeNull()
  })

  it('no bookmarks at all: the empty notice', async () => {
    signIn({})
    agent.app.bsky.bookmark.getBookmarks.mockResolvedValue({ data: { bookmarks: [] } })
    const tl = await mount('bookmarks')
    expect(notice(tl)).toBe('No bookmarks yet.')
  })
})

describe('an empty page with a cursor, from the server', () => {
  // The server and the first client render read the same `initial`: both
  // write the anchor, neither the empty notice.
  it('renders the anchor signed out, as a plain link to the next page', async () => {
    const tl = await mount('bookmarks', { statuses: [], nextCursor: 'c5' })
    expect(notice(tl)).toBeNull()
    expect(sentinel(tl)!.getAttribute('href')).toBe('?max_id=c5')
  })

  it('a Mastodon-style empty page with no cursor is still the end', async () => {
    const tl = await mount('local', { statuses: [], nextCursor: null })
    expect(notice(tl)).toBe('No posts yet.')
    expect(sentinel(tl)).toBeNull()
  })
})
