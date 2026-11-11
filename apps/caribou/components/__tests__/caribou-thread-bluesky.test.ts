import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ClientModule from '@beatzball/caribou-mastodon-client'
import { activeUserKey, clearKeptAlive, statusCache, users } from '@beatzball/caribou-state'
import '../caribou-thread.js'
import { threadStoreKey, type CaribouThread } from '../caribou-thread.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'
import { _testOnlyResetBlueskyVeil, _testOnlyVeilLoaded } from '../_bluesky-moderation.js'
import { blueskyPostUri } from '../_bluesky-route.js'
import { blueskyClients } from './_bluesky-clients.js'
import {
  ALICE, LABELER, READER_KEY, asPostView, blueskyClient, fakeAgent, label, post, publicPost, signInBluesky,
  type FakeAgent,
} from './_bluesky-helpers.js'

// A Bluesky thread, rendered on the client (#184), through a real client.
// A label that filters a list hides a reply but never the post opened.

vi.mock('@beatzball/caribou-mastodon-client', async (importOriginal) => {
  const real = await importOriginal<typeof ClientModule>()
  const { blueskyClients: made } = await import('./_bluesky-clients.js')
  return {
    ...real,
    createCaribouClient: (...args: Parameters<typeof real.createCaribouClient>) =>
      (made.get(args[0]) as ReturnType<typeof real.createCaribouClient> | undefined) ?? real.createCaribouClient(...args),
  }
})

const uri = (n: string) => `at://${ALICE}/app.bsky.feed.post/${n}`
function view(n: string, labels: ReturnType<typeof label>[] = []) {
  const v = post({ labels: labels.map((l) => ({ ...l, uri: uri(n) })) })
  v.uri = uri(n)
  delete (v as { embed?: unknown }).embed
  return asPostView(v)
}
const node = (v: object, extra: object = {}) => ({ $type: 'app.bsky.feed.defs#threadViewPost', post: v, ...extra })

async function settle(el: CaribouThread) {
  for (let i = 0; i < 5; i++) {
    await _testOnlyVeilLoaded()
    await new Promise((r) => setTimeout(r, 0))
    while (!(await el.updateComplete)) { /* settle */ }
    for (const card of el.shadowRoot!.querySelectorAll<CaribouStatusCard>('caribou-status-card')) {
      while (!(await card.updateComplete)) { /* settle */ }
    }
  }
}

let agent: FakeAgent

beforeEach(() => {
  document.body.replaceChildren()
  clearKeptAlive()
  statusCache.value = new Map()
  users.value = new Map()
  activeUserKey.value = null
  blueskyClients.clear()
  localStorage.clear()
  _testOnlyResetBlueskyVeil()
})
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

describe('<caribou-thread> for a Bluesky post', () => {
  it('reads the thread by AT URI; a filtering label hides a reply, not the opened post', async () => {
    // The store reads the post (getPosts) and its thread (getPostThread),
    // by the DID URI the page gives it (README, "Bluesky views", #271).
    agent = fakeAgent({
      getPosts: vi.fn(async () => ({ data: { posts: [view('focus', [label('scam-strict', LABELER)])] } })),
      getPostThread: vi.fn(async () => ({
        data: {
          thread: node(view('focus', [label('scam-strict', LABELER)]), {
            parent: node(view('root')),
            replies: [node(view('ok')), node(view('scam', [label('scam-strict', LABELER)]))],
          }),
        },
      })),
    })
    signInBluesky(blueskyClient(agent))
    const statusId = blueskyPostUri(ALICE, 'focus')
    const el = document.createElement('caribou-thread') as CaribouThread
    el.statusId = statusId
    document.body.appendChild(el)
    await settle(el)
    expect(agent.getPostThread).toHaveBeenCalledWith({ uri: statusId })
    expect(agent.getPosts).toHaveBeenCalledWith({ uris: [statusId] })
    const cards = [...el.shadowRoot!.querySelectorAll<CaribouStatusCard>('caribou-status-card')]
    expect(cards.map((c) => [c.dataset.id, c.variant])).toEqual([
      [uri('root'), 'ancestor'], [uri('focus'), 'focused'], [uri('ok'), 'descendant'], [uri('scam'), 'descendant'],
    ])
    const [, focused, ok, scam] = cards
    expect(focused!.hasAttribute('hidden')).toBe(false)
    expect(ok!.hasAttribute('hidden')).toBe(false)
    expect(scam!.hasAttribute('hidden')).toBe(true)
  })
})

// A kept thread belongs to one reader (README, "Bluesky views", #273).
describe('<caribou-thread> keeps a Bluesky thread per reader', () => {
  it('a signed-in reader never gets the store seeded with the server\'s signed-out copy', async () => {
    agent = fakeAgent({
      getPosts: vi.fn(async () => ({ data: { posts: [view('focus')] } })),
      getPostThread: vi.fn(async () => ({
        data: { thread: node(view('focus'), { parent: node(view('root')), replies: [node(view('reply'))] }) },
      })),
    })
    signInBluesky(blueskyClient(agent))
    const statusId = blueskyPostUri(ALICE, 'focus')
    // The page hydrates the server's thread first: every decision is for no
    // reader (`viewerOf` null).
    const server = document.createElement('caribou-thread') as CaribouThread
    server.statusId = statusId
    server.initial = { focused: publicPost(view('focus')), ancestors: [publicPost(view('root'))], descendants: [publicPost(view('reply'))] }
    document.body.appendChild(server)
    await settle(server)
    server.remove()
    // Then it swaps in the reader's thread, by the same id.
    const el = document.createElement('caribou-thread') as CaribouThread
    el.statusId = statusId
    document.body.appendChild(el)
    await settle(el)
    expect(agent.getPostThread).toHaveBeenCalledWith({ uri: statusId })
    const cards = [...el.shadowRoot!.querySelectorAll<CaribouStatusCard>('caribou-status-card')]
    expect(cards.map((c) => c.dataset.id)).toEqual([uri('root'), uri('focus'), uri('reply')])
    for (const card of cards) {
      expect(card.status!.bluesky!.viewerOf).toBe(READER_KEY)
      expect(card.shadowRoot!.textContent).not.toContain('Checking this post against your moderation settings')
    }
  })

  it('the key: a Bluesky reader\'s store is apart; no reader keys by the id alone', () => {
    expect(threadStoreKey('at://x/app.bsky.feed.post/1', null)).toBe('at://x/app.bsky.feed.post/1')
    expect(threadStoreKey('at://x/app.bsky.feed.post/1', READER_KEY)).not.toBe(threadStoreKey('at://x/app.bsky.feed.post/1', null))
    // A Mastodon thread (no Bluesky reader) is kept as before.
    expect(threadStoreKey('109', null)).toBe('109')
  })
})
