import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ClientModule from '@beatzball/caribou-mastodon-client'
import type { Account } from '@beatzball/caribou-mastodon-client'
import {
  activeClient, activeUserKey, addUserSession, cacheStatus, clearKeptAlive, statusCache, users, type TimelineStore,
} from '@beatzball/caribou-state'
import '../caribou-timeline.js'
import type { CaribouTimeline, TimelineInitial, TimelineKind } from '../caribou-timeline.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'
import { _testOnlyResetBlueskyVeil, _testOnlyVeilLoaded } from '../_bluesky-moderation.js'
import { blueskyClients } from './_bluesky-clients.js'
import {
  ALICE, BOB, BSKY_LABELER, CAROL, READER_DID, asPostView, author, blueskyClient, fakeAgent, label, post, signInBluesky, type FakeAgent,
} from './_bluesky-helpers.js'

// Bluesky Home slices (#275; README, "Bluesky views", "Home shows threads
// as slices"): a real Bluesky client over a fake agent. Tests name the rule.

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

const FOLLOWED = { following: `at://${READER_DID}/app.bsky.graph.follow/f1` }
const who = (did: string, followed: boolean) => ({ ...author(did), viewer: { ...author(did).viewer, ...(followed ? FOLLOWED : {}) } })
const alice = () => who(ALICE, true)
const carol = () => who(CAROL, true)
const bob = () => who(BOB, false)

const uri = (did: string, rkey: string) => `at://${did}/app.bsky.feed.post/${rkey}`

function view(a: ReturnType<typeof author>, rkey: string, reply?: { root: string; parent: string }, labels: ReturnType<typeof label>[] = []) {
  const v = post({ author: a, labels: labels.map((l) => ({ ...l, uri: uri(a.did, rkey) })) })
  v.uri = uri(a.did, rkey)
  v.cid = `bafy${rkey}`
  const ref = (u: string) => ({ uri: u, cid: `bafy${u.split('/').pop()}` })
  v.record = { ...(v.record as object), text: `post ${rkey}`, ...(reply ? { reply: { root: ref(reply.root), parent: ref(reply.parent) } } : {}) }
  delete (v as { embed?: unknown }).embed
  return asPostView(v)
}

const plain = (a: ReturnType<typeof author>, rkey: string) => ({ post: view(a, rkey) })
function reply(a: ReturnType<typeof author>, rkey: string, parent: ReturnType<typeof view>, root = parent) {
  return { post: view(a, rkey, { root: root.uri, parent: parent.uri }), reply: { root, parent } }
}

// A thread by followed authors: alice's root, carol's reply, alice's answer.
const root = view(alice(), 'a0')
const c1 = view(carol(), 'c1', { root: root.uri, parent: root.uri })
const c2 = view(carol(), 'c2', { root: root.uri, parent: c1.uri })

const li = (tl: CaribouTimeline) => [...tl.shadowRoot!.querySelectorAll('ul > li')]
// A row's own post: its card, or a slice's last card.
const cardIn = (el: Element | undefined) => [...el?.children ?? []].find((c) => c.localName === 'caribou-status-card') as CaribouStatusCard | undefined
const leafOf = (row: Element) => (cardIn(row) ?? cardIn([...row.children].find((c) => c.hasAttribute('data-slice'))))!
// What the row-hiding CSS means (happy-dom cannot match `:has(>)`; the e2e
// checks the real CSS).
const rowHidden = (row: Element) => leafOf(row).hasAttribute('hidden')

describe('Home slices', () => {
  it('rule 1: a reply is one slice: root, parent, then the reply, oldest first', async () => {
    signIn({ getTimeline: vi.fn(async () => ({ data: { feed: [reply(alice(), 'a2', c1, root)], cursor: 'c' } })) })
    const tl = await mount('home')
    expect(li(tl)).toHaveLength(1)
    expect(ids(tl)).toEqual([root.uri, c1.uri, uri(ALICE, 'a2')])
    const cards = [...li(tl)[0]!.querySelectorAll<CaribouStatusCard>('caribou-status-card')]
    // rule 2: the posts above the reply are joined; the reply is not.
    expect(cards.map((c) => c.hasAttribute('joined'))).toEqual([true, true, false])
    // Each is a full card with its own article.
    for (const card of cards) expect(card.shadowRoot!.querySelectorAll('article')).toHaveLength(1)
    expect(tl.shadowRoot!.querySelector('.gap')).toBeNull()
  })

  it('rule 1: a "…" marker when posts are skipped between root and parent', async () => {
    signIn({ getTimeline: vi.fn(async () => ({ data: { feed: [reply(alice(), 'a3', c2, root)], cursor: 'c' } })) })
    const tl = await mount('home')
    expect(ids(tl)).toEqual([root.uri, c2.uri, uri(ALICE, 'a3')])
    const gap = tl.shadowRoot!.querySelector('.context .gap')!
    expect(gap.textContent).toContain('…')
    expect(gap.textContent).toContain('Earlier replies not shown')
    // In reading order: root, the marker, the parent.
    const order = [...tl.shadowRoot!.querySelector('.context')!.children].map((e) => e.localName === 'caribou-status-card' ? (e as HTMLElement).dataset.statusId : 'gap')
    expect(order).toEqual([root.uri, 'gap', c2.uri])
  })

  it('the default prefs hide a reply to an unfollowed author', async () => {
    const b0 = view(bob(), 'b0')
    signIn({ getTimeline: vi.fn(async () => ({ data: { feed: [reply(alice(), 'a1', b0), plain(alice(), 'a9')], cursor: 'c' } })) })
    const tl = await mount('home')
    expect(ids(tl)).toEqual([uri(ALICE, 'a9')])
  })

  it('rule 4: one slice per thread, the newest, also across pages', async () => {
    const page1 = [reply(alice(), 'a3', c2, root), plain(carol(), 'c9'), reply(carol(), 'c1x', root)]
    const page2 = [plain(alice(), 'a0'), reply(alice(), 'a2', c1, root), plain(carol(), 'c8')]
    // The root itself (a0) is the same thread too.
    page2[0] = { post: root }
    signIn({
      getTimeline: vi.fn(async ({ cursor }: { cursor?: string }) => cursor === 'c1'
        ? { data: { feed: page2 } }
        : { data: { feed: page1, cursor: 'c1' } }),
    })
    const tl = await mount('home')
    expect(li(tl).map((l) => leafOf(l).dataset.statusId)).toEqual([uri(ALICE, 'a3'), uri(CAROL, 'c9')])
    await scrollToEnd(tl)
    expect(li(tl).map((l) => leafOf(l).dataset.statusId)).toEqual([uri(ALICE, 'a3'), uri(CAROL, 'c9'), uri(CAROL, 'c8')])
  })

  it('rule 4: a repost is its own slice, with no context', async () => {
    const r = reply(alice(), 'a2', c1, root)
    // The AppView sends `reply` on a reposted reply too.
    const repost = {
      post: r.post,
      reply: r.reply,
      reason: { $type: 'app.bsky.feed.defs#reasonRepost', by: carol(), uri: `at://${CAROL}/app.bsky.feed.repost/r1`, cid: 'bafyr', indexedAt: '2026-11-06T00:00:00.000Z' },
    }
    signIn({ getTimeline: vi.fn(async () => ({ data: { feed: [repost, r], cursor: 'c' } })) })
    const tl = await mount('home')
    expect(li(tl)).toHaveLength(2)
    expect(li(tl)[0]!.querySelector('.context')).toBeNull()
    expect(ids(tl)).toEqual([`at://${CAROL}/app.bsky.feed.repost/r1`, root.uri, c1.uri, uri(ALICE, 'a2')])
  })

  it('rule 5: a poll keeps the slice and its cards; a newer entry of the thread takes the top', async () => {
    let feed: unknown[] = [reply(alice(), 'a2', c1, root), plain(carol(), 'c9')]
    signIn({ getTimeline: vi.fn(async () => ({ data: { feed, cursor: 'c' } })) })
    const tl = await mount('home')
    const before = li(tl)[0]!
    const leaf = leafOf(before)
    await storeOf(tl).poll()
    await settle(tl)
    expect(li(tl)[0]).toBe(before)
    expect(leafOf(li(tl)[0]!)).toBe(leaf)
    feed = [reply(alice(), 'a3', c2, root), ...feed]
    await storeOf(tl).poll()
    storeOf(tl).applyNewPosts()
    await settle(tl)
    expect(li(tl).map((l) => leafOf(l).dataset.statusId)).toEqual([uri(ALICE, 'a3'), uri(CAROL, 'c9')])
  })

  it('fix 1: a new reply to the shown reply keeps the shown slice whole until Apply; the banner counts it', async () => {
    const a2 = reply(alice(), 'a2', c1, root)
    // A is not the top post, so the catch-up does not read A again.
    let feed: unknown[] = [plain(carol(), 'c9'), a2]
    signIn({ getTimeline: vi.fn(async () => ({ data: { feed, cursor: 'c' } })) })
    const tl = await mount('home')
    // B answers A (the shown reply): B's context caches a plain copy of A.
    const b = reply(carol(), 'c4', a2.post, root)
    feed = [b, ...feed]
    await storeOf(tl).poll()
    await settle(tl)
    expect(storeOf(tl).newPostsCount.value).toBe(1)
    expect(ids(tl)).toEqual([uri(CAROL, 'c9'), root.uri, c1.uri, uri(ALICE, 'a2')])
    storeOf(tl).applyNewPosts()
    await settle(tl)
    // Applied: one slice for the thread, at B, with A as its parent.
    expect(ids(tl)).toEqual([root.uri, uri(ALICE, 'a2'), uri(CAROL, 'c4'), uri(CAROL, 'c9')])
  })

  it('fix 1: Home -> thread -> Back: the thread\'s copy of the reply does not drop its context', async () => {
    signIn({
      getTimeline: vi.fn(async () => ({ data: { feed: [reply(alice(), 'a2', c1, root)], cursor: 'c' } })),
      getPosts: vi.fn(async () => ({ data: { posts: [view(alice(), 'a2', { root: root.uri, parent: c1.uri })] } })),
    })
    const tl = await mount('home')
    // The thread page caches the plain copy it reads.
    cacheStatus((await activeClient.value!.fetchStatus(uri(ALICE, 'a2')))!)
    tl.remove()
    document.body.appendChild(tl)
    await settle(tl)
    expect(ids(tl)).toEqual([root.uri, c1.uri, uri(ALICE, 'a2')])
  })

  it('fix 10: a context card hidden by a label takes only its place; the reply still shows', async () => {
    const hidden = view(carol(), 'c1', { root: root.uri, parent: root.uri }, [label('!hide', BSKY_LABELER)])
    signIn({ getTimeline: vi.fn(async () => ({ data: { feed: [reply(alice(), 'a2', hidden, root)], cursor: 'c' } })) })
    const tl = await mount('home')
    const cards = [...li(tl)[0]!.querySelectorAll<CaribouStatusCard>('caribou-status-card')]
    expect(cards.map((c) => c.hidden)).toEqual([false, true, false])
    expect(rowHidden(li(tl)[0]!)).toBe(false)
  })

  it('fix 10: a hidden reply hides its whole slice', async () => {
    const e = reply(alice(), 'a2', c1, root)
    e.post = view(alice(), 'a2', { root: root.uri, parent: c1.uri }, [label('!hide', BSKY_LABELER)])
    signIn({ getTimeline: vi.fn(async () => ({ data: { feed: [e], cursor: 'c' } })) })
    const tl = await mount('home')
    const row = li(tl)[0]!
    expect(leafOf(row).hidden).toBe(true)
    expect(rowHidden(row)).toBe(true)
  })

  it('fix 10: a like on a context card goes to that post and shows on its card', async () => {
    const createRecord = vi.fn(async () => ({ data: { uri: `at://${READER_DID}/app.bsky.feed.like/l1`, cid: 'bafylike' } }))
    signIn({
      getTimeline: vi.fn(async () => ({ data: { feed: [reply(alice(), 'a2', c1, root)], cursor: 'c' } })),
      com: { atproto: { repo: { createRecord, deleteRecord: vi.fn(), getRecord: vi.fn() } } },
    })
    const tl = await mount('home')
    const parent = li(tl)[0]!.querySelectorAll<CaribouStatusCard>('caribou-status-card')[1]!
    parent.shadowRoot!.querySelector<HTMLElement>('caribou-icon-button.favourite')!.click()
    await settle(tl)
    expect(createRecord).toHaveBeenCalledWith(expect.objectContaining({
      collection: 'app.bsky.feed.like', record: expect.objectContaining({ subject: { uri: c1.uri, cid: c1.cid } }),
    }))
    expect(parent.shadowRoot!.querySelector('caribou-icon-button.favourite')!.getAttribute('label')).toBe('Unfavourite')
  })

  it('fix 4: after a delete, focus goes to the next shown card in reading order, within and across slices', async () => {
    signIn({
      getTimeline: vi.fn(async () => ({ data: { feed: [reply(alice(), 'a2', c1, root), reply(carol(), 'c3', view(carol(), 'c0'), view(alice(), 'r9'))], cursor: 'c' } })),
    })
    const tl = await mount('home')
    const neighbour = (c: CaribouStatusCard) => (c as unknown as { neighbour(): CaribouStatusCard | null }).neighbour()
    const [first, second] = li(tl).map((l) => [...l.querySelectorAll<CaribouStatusCard>('caribou-status-card')])
    // Within a slice: the parent's neighbour is the reply under it.
    expect(neighbour(first![1]!)?.dataset.statusId).toBe(uri(ALICE, 'a2'))
    // Across slices, past a hidden root: the next slice's first shown card.
    second![0]!.hidden = true
    expect(neighbour(first![2]!)?.dataset.statusId).toBe(uri(CAROL, 'c0'))
    // A slice's reply takes its whole slice with it: its neighbour is in
    // another slice, never its own parent.
    expect(neighbour(second![2]!)?.dataset.statusId).toBe(uri(ALICE, 'a2'))
  })

  it('round 3: deleting the reader\'s reply in the last slice puts focus on a card that stays', async () => {
    const me = who(READER_DID, false)
    const deleteRecord = vi.fn(async () => ({ data: {} }))
    signIn({
      getTimeline: vi.fn(async () => ({ data: { feed: [plain(carol(), 'c9'), reply(me, 'm1', c1, root)], cursor: 'c' } })),
      com: { atproto: { repo: {
        createRecord: vi.fn(), deleteRecord,
        getRecord: vi.fn(async () => { throw Object.assign(new Error('not found'), { status: 400, error: 'RecordNotFound' }) }),
      } } },
    })
    // The reader's own account, so the card offers Delete.
    addUserSession({
      userKey: `${READER_DID}@bsky`, server: 'bsky.social', token: '', vapidKey: '', createdAt: 0,
      account: { id: READER_DID, acct: 'reader.example.com', username: 'reader' } as Account,
    })
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
    const tl = await mount('home')
    const mine = leafOf(li(tl)[1]!)
    expect(mine.dataset.statusId).toBe(uri(READER_DID, 'm1'))
    const del = mine.shadowRoot!.querySelector<HTMLElement>('caribou-menu.more button[data-action="delete"]')!
    del.click()
    await settle(tl)
    document.querySelector('caribou-confirm-dialog')!.shadowRoot!.querySelector<HTMLElement>('caribou-button.confirm')!.click()
    await settle(tl)
    expect(deleteRecord).toHaveBeenCalled()
    // The slice is gone; focus is on the post above it, which stays.
    expect(li(tl)).toHaveLength(1)
    const above = leafOf(li(tl)[0]!)
    expect(above.isConnected && !above.hidden).toBe(true)
    expect(tl.shadowRoot!.activeElement).toBe(above)
    expect(above.shadowRoot!.activeElement?.localName).toBe('article')
  })

  it('fix 11, round 3: a slice with context has a group named "Thread" inside its list item; a plain post has none', async () => {
    signIn({ getTimeline: vi.fn(async () => ({ data: { feed: [reply(alice(), 'a2', c1, root), plain(carol(), 'c9')], cursor: 'c' } })) })
    const tl = await mount('home')
    // The `<li>` stays a list item; the group is inside it.
    expect(li(tl).map((l) => l.getAttribute('role'))).toEqual([null, null])
    const group = [...li(tl)[0]!.children].find((c) => c.getAttribute('role') === 'group')!
    expect(group.getAttribute('aria-label')).toBe('Thread')
    expect([...group.querySelectorAll('caribou-status-card')].map((c) => (c as HTMLElement).dataset.statusId)).toEqual([root.uri, c1.uri, uri(ALICE, 'a2')])
    expect(li(tl)[1]!.querySelector('[role="group"]')).toBeNull()
  })
})
