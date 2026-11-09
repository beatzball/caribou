import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MASTODON_CAPABILITIES, type Account, type CaribouClient, type Status, type StatusBluesky,
} from '@beatzball/caribou-mastodon-client'
import { toUserKey } from '@beatzball/caribou-auth'
import {
  _testOnlyResetMutations, activeClient, activeUserKey, addUserSession, cacheStatus, statusCache, users,
} from '@beatzball/caribou-state'
import '../caribou-status-card.js'
import { startShortcuts } from '../_shortcuts.js'
import { _testOnlyResetBlueskyVeil, _testOnlyVeilLoaded, setBlueskyReader } from '../_bluesky-moderation.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'

// #188: Bluesky card actions. Reply and Quote are off, with a reason, when
// the post's own flags say so; Quote opens the composer; a Mastodon card has
// no Quote and is as it was; a Bluesky block says blocks are public.

const ME = toUserKey('alice', 'example.social')
const POST_URI = 'at://did:plc:bob/app.bsky.feed.post/3k1'
// Bluesky's own labeler, the one every reader subscribes to.
const BSKY_LABELER = 'did:plc:ar7c4by46qjdydhdevvrndac'

function mastodonPost(over: Record<string, unknown> = {}): Status {
  return {
    id: '7', content: '<p>hello</p>', visibility: 'public',
    account: { id: '42', acct: 'bob', username: 'bob', displayName: 'Bob', avatar: '', avatarStatic: '', url: 'https://example.social/@bob' },
    createdAt: '2026-04-28T12:00:00Z',
    favourited: false, favouritesCount: 3, reblogged: false, reblogsCount: 2,
    bookmarked: false, repliesCount: 1,
    ...over,
  } as unknown as Status
}

// `viewerOf`: whose decision the copy carries (README, "A decision belongs
// to one reader"). A Mastodon or signed-out reader gets the public copy.
function blueskyPost(over: Partial<StatusBluesky> = {}, viewerOf: StatusBluesky['viewerOf'] = ME, handleInvalid = false): Status {
  const bluesky: StatusBluesky = {
    uri: POST_URI, cid: 'bafy1', likeUri: null, repostUri: null, replyRef: null,
    replyDisabled: false, embeddingDisabled: false, labels: [],
    // A clean result: every context present, nothing covered.
    moderation: { contexts: Object.fromEntries(['contentList', 'contentView', 'contentMedia', 'avatar', 'banner', 'profileList', 'profileView'].map((c) => [c, { filter: false, blur: false, alert: false, inform: false, noOverride: false, reasons: [] }])), labelersCovered: [BSKY_LABELER] } as unknown as StatusBluesky['moderation'],
    viewerOf,
    ...over,
  }
  return mastodonPost({
    id: POST_URI,
    account: {
      id: 'did:plc:bob', acct: handleInvalid ? 'handle.invalid' : 'bob.example.com', username: 'bob',
      displayName: 'Bob', avatar: '', avatarStatic: '', url: 'https://bsky.app/profile/did:plc:bob',
      bluesky: { did: 'did:plc:bob', handleInvalid },
    },
    bluesky,
  })
}

function signIn(network: 'mastodon' | 'bluesky' = 'mastodon') {
  addUserSession({
    userKey: ME, server: 'example.social', token: 't', vapidKey: '', createdAt: 0,
    account: { id: 'me', acct: 'alice', username: 'alice' } as Account,
  })
  // No Bluesky client exists yet; the active client stands in for one by
  // its capabilities, which is all the card reads.
  if (network === 'bluesky') {
    (activeClient.value as { capabilities: CaribouClient['capabilities'] }).capabilities =
      { ...MASTODON_CAPABILITIES, network: 'bluesky', readLagMs: 60_000 }
    // The reader veil's inputs, loaded: the post was fetched as this reader
    // with Bluesky's labeler covered, so the card settles (README, "Bluesky views").
    setBlueskyReader({
      userKey: ME,
      prefs: { adultContentEnabled: false, labels: {}, labelers: [], mutedWords: [], hiddenPosts: [] },
      labelDefs: { [BSKY_LABELER]: [] },
    })
  }
}

async function mount(status: Status, instance?: string): Promise<CaribouStatusCard> {
  const el = document.createElement('caribou-status-card') as CaribouStatusCard
  el.status = status
  if (instance !== undefined) el.instance = instance
  document.body.appendChild(el)
  // A Bluesky card loads the veil's check lazily after mount.
  for (let i = 0; i < 3; i++) {
    while (!(await el.updateComplete)) { /* settle */ }
    await _testOnlyVeilLoaded()
    await new Promise((r) => setTimeout(r, 0))
  }
  while (!(await el.updateComplete)) { /* settle */ }
  return el
}

// Lets the client's answer land and the card and its buttons render again.
async function settle(el: CaribouStatusCard): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0))
    while (!(await el.updateComplete)) { /* settle */ }
    for (const b of el.shadowRoot!.querySelectorAll('caribou-icon-button')) await (b as unknown as { updateComplete: Promise<unknown> }).updateComplete
  }
}

function button(el: CaribouStatusCard, cls: string): HTMLButtonElement {
  return el.shadowRoot!.querySelector(`.actions caribou-icon-button.${cls}`)!.shadowRoot!.querySelector('button')!
}
const soft = (b: HTMLButtonElement) => b.getAttribute('aria-disabled') === 'true'
const quote = (el: CaribouStatusCard) => el.shadowRoot!.querySelector('.actions caribou-icon-button.quote')
const title = (b: HTMLButtonElement) => b.getAttribute('title') ?? ''

beforeEach(() => {
  document.body.replaceChildren()
  statusCache.value = new Map()
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
  _testOnlyResetMutations()
  _testOnlyResetBlueskyVeil()
})
afterEach(() => { vi.restoreAllMocks() })

function composeEvents(): CustomEvent[] {
  const seen: CustomEvent[] = []
  window.addEventListener('caribou:compose', (e) => seen.push(e as CustomEvent))
  return seen
}

describe('Bluesky reader, Bluesky post', () => {
  it('Reply opens the composer with inReplyTo; Quote opens it with quote', async () => {
    signIn('bluesky')
    const seen = composeEvents()
    const el = await mount(blueskyPost())
    expect(soft(button(el, 'reply'))).toBe(false)
    expect(soft(button(el, 'quote'))).toBe(false)
    button(el, 'reply').click()
    button(el, 'quote').click()
    expect(seen.map((e) => Object.keys(e.detail))).toEqual([['inReplyTo'], ['quote']])
    expect(seen[1]!.detail.quote.id).toBe(POST_URI)
  })

  it('replyDisabled: Reply is off and says why; a click opens no composer', async () => {
    signIn('bluesky')
    const seen = composeEvents()
    const el = await mount(blueskyPost({ replyDisabled: true }))
    expect(soft(button(el, 'reply'))).toBe(true)
    expect(title(button(el, 'reply'))).toBe('The author limited replies')
    expect(soft(button(el, 'quote'))).toBe(false)
    button(el, 'reply').click()
    expect(seen).toHaveLength(0)
  })

  it('embeddingDisabled: Quote is off and says why; Reply stays on', async () => {
    signIn('bluesky')
    const seen = composeEvents()
    const el = await mount(blueskyPost({ embeddingDisabled: true }))
    expect(soft(button(el, 'quote'))).toBe(true)
    expect(title(button(el, 'quote'))).toBe('The author turned off quotes')
    expect(soft(button(el, 'reply'))).toBe(false)
    button(el, 'quote').click()
    expect(seen).toHaveLength(0)
  })

  it('a newer cached copy that turns replies off turns Reply off', async () => {
    signIn('bluesky')
    cacheStatus(blueskyPost())
    const el = await mount(statusCache.value.get(POST_URI)!)
    expect(soft(button(el, 'reply'))).toBe(false)
    cacheStatus(blueskyPost({ replyDisabled: true }))
    await settle(el)
    expect(soft(button(el, 'reply'))).toBe(true)
  })

  it('a like sends the post ref and shows the like', async () => {
    signIn('bluesky')
    const favourite = vi.spyOn(activeClient.value!, 'favourite')
      .mockResolvedValue({ ack: true, id: POST_URI, on: true, record: 'at://did:plc:me/app.bsky.feed.like/3l1' })
    cacheStatus(blueskyPost())
    const el = await mount(statusCache.value.get(POST_URI)!)
    button(el, 'favourite').click()
    await settle(el)
    expect(favourite).toHaveBeenCalledWith({ id: POST_URI, bluesky: { uri: POST_URI, cid: 'bafy1', likeUri: null, repostUri: null } })
    expect(button(el, 'favourite').getAttribute('aria-pressed')).toBe('true')
    expect(button(el, 'favourite').textContent?.trim()).toBe('4')
    expect(statusCache.value.get(POST_URI)!.bluesky!.likeUri).toBe('at://did:plc:me/app.bsky.feed.like/3l1')
  })
})

describe('other readers', () => {
  it('a Mastodon reader sees Quote off, with the network to sign in with', async () => {
    signIn('mastodon')
    const el = await mount(blueskyPost({}, null))
    expect(soft(button(el, 'quote'))).toBe(true)
    expect(title(button(el, 'quote'))).toBe('Sign in with a Bluesky account to quote')
  })

  it('signed out: Quote is off', async () => {
    const el = await mount(blueskyPost({}, null))
    expect(soft(button(el, 'quote'))).toBe(true)
  })

  it('a Mastodon post has no Quote button', async () => {
    signIn('mastodon')
    const el = await mount(mastodonPost(), 'example.social')
    expect(quote(el)).toBeNull()
  })
})

// The click guard of the icon button is one check; the card's handler is
// the second. These reach the handler, and the real `r` key path.
describe('the handler checks the limits itself', () => {
  function host(el: CaribouStatusCard, cls: string) {
    return el.shadowRoot!.querySelector(`.actions caribou-icon-button.${cls}`) as HTMLElement & { softDisabled: boolean }
  }

  it('Reply with soft-disabled forced off still opens no composer for a limited post', async () => {
    signIn('bluesky')
    const seen = composeEvents()
    const el = await mount(blueskyPost({ replyDisabled: true }))
    const reply = host(el, 'reply')
    reply.softDisabled = false
    reply.click()
    expect(seen).toHaveLength(0)
  })

  it('Quote with soft-disabled forced off still opens no composer for a limited post', async () => {
    signIn('bluesky')
    const seen = composeEvents()
    const el = await mount(blueskyPost({ embeddingDisabled: true }))
    const quoteButton = host(el, 'quote')
    quoteButton.softDisabled = false
    quoteButton.click()
    expect(seen).toHaveLength(0)
  })

  it('the r key replies to an open post and does nothing on a limited one', async () => {
    signIn('bluesky')
    const seen = composeEvents()
    const outlet = document.createElement('litro-outlet')
    const list = document.createElement('ul')
    outlet.append(list)
    document.body.append(outlet)
    const cards: CaribouStatusCard[] = []
    for (const p of [blueskyPost({ replyDisabled: true }), { ...blueskyPost(), id: `${POST_URI}x` } as Status]) {
      const li = document.createElement('li')
      const el = document.createElement('caribou-status-card') as CaribouStatusCard
      el.status = p
      li.append(el)
      list.append(li)
      cards.push(el)
    }
    for (const el of cards) {
      for (let i = 0; i < 3; i++) {
        while (!(await el.updateComplete)) { /* settle */ }
        await _testOnlyVeilLoaded()
        await new Promise((r) => setTimeout(r, 0))
      }
    }
    const stop = startShortcuts(window, document, { navigate: () => {}, toggleHelp: () => {}, helpOpen: () => false, enabled: () => true, now: () => 0 })
    const key = (k: string) => {
      let target: Element = document.activeElement ?? document.body
      while (target.shadowRoot?.activeElement) target = target.shadowRoot.activeElement
      target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true }))
    }
    try {
      key('j')
      key('r')
      expect(seen).toHaveLength(0)
      key('j')
      key('r')
      expect(seen).toHaveLength(1)
      expect(seen[0]!.detail.inReplyTo.id).toBe(`${POST_URI}x`)
    } finally {
      stop()
    }
  })
})
