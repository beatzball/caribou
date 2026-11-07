import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ClientModule from '@beatzball/caribou-mastodon-client'
import { activeUserKey, clearKeptAlive, statusCache, users } from '@beatzball/caribou-state'
import '../caribou-thread.js'
import type { CaribouThread } from '../caribou-thread.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'
import { _testOnlyResetBlueskyVeil, _testOnlyVeilLoaded } from '../_bluesky-moderation.js'
import { blueskyPostUri } from '../_bluesky-route.js'
import { blueskyClients } from './_bluesky-clients.js'
import {
  ALICE, LABELER, asPostView, blueskyClient, fakeAgent, label, post, signInBluesky, type FakeAgent,
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
    // The store reads the post (getPosts) and its thread (getPostThread);
    // the AppView resolves the handle in the URI for both.
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
    const statusId = blueskyPostUri('alice.example.com', 'focus')
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
