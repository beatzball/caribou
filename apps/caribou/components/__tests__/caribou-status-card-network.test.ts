import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MASTODON_CAPABILITIES, type Account, type CaribouClient, type Status, type StatusBluesky,
} from '@beatzball/caribou-mastodon-client'
import { toUserKey } from '@beatzball/caribou-auth'
import {
  _testOnlyResetMutations, activeClient, activeUserKey, addUserSession, cacheStatus, statusCache, users,
} from '@beatzball/caribou-state'
import '../caribou-status-card.js'
import { _testOnlyResetBlueskyVeil, _testOnlyVeilLoaded, setBlueskyReader } from '../_bluesky-moderation.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'

// Spec section 11: a card acts only through a client on the post's own
// network, and builds its links by the post's network. Each test asserts
// where a click goes and the links built, not only disabled buttons.

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

function blueskyPost(handleInvalid = false): Status {
  const bluesky: StatusBluesky = {
    uri: POST_URI, cid: 'bafy1', likeUri: null, repostUri: null, replyRef: null,
    replyDisabled: false, embeddingDisabled: false, labels: [],
    // A clean result: every context present, nothing covered.
    moderation: { contexts: Object.fromEntries(['contentList', 'contentView', 'contentMedia', 'avatar', 'banner', 'profileList', 'profileView'].map((c) => [c, { filter: false, blur: false, alert: false, inform: false, noOverride: false, reasons: [] }])), labelersCovered: [BSKY_LABELER] } as unknown as StatusBluesky['moderation'],
    viewerOf: ME,
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
const authorHref = (el: CaribouStatusCard) => el.shadowRoot!.querySelector('a.author')!.getAttribute('href')
const permalink = (el: CaribouStatusCard) => el.shadowRoot!.querySelector('.permalink')!.getAttribute('href')

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

describe('Mastodon reader, Mastodon post (as today)', () => {
  it('live buttons, counts and links do not change', async () => {
    signIn()
    const favourite = vi.spyOn(activeClient.value!, 'favourite').mockResolvedValue(mastodonPost({ favourited: true, favouritesCount: 4 }))
    const el = await mount(mastodonPost(), 'example.social')
    for (const cls of ['reply', 'boost', 'favourite', 'bookmark']) expect(soft(button(el, cls))).toBe(false)
    expect(button(el, 'favourite').hasAttribute('title')).toBe(false)
    expect(button(el, 'favourite').textContent?.trim()).toBe('3')
    expect(button(el, 'boost').textContent?.trim()).toBe('2')
    expect(button(el, 'reply').textContent?.trim()).toBe('1')
    expect(authorHref(el)).toBe('/@bob@example.social')
    expect(permalink(el)).toBe('/@bob/7')
    button(el, 'favourite').click()
    expect(favourite).toHaveBeenCalledWith({ id: '7' })
  })

  it('a favourite and its undo show in the card: pressed state, name and count', async () => {
    signIn()
    vi.spyOn(activeClient.value!, 'favourite').mockResolvedValue(mastodonPost({ favourited: true, favouritesCount: 4 }))
    const unfavourite = vi.spyOn(activeClient.value!, 'unfavourite')
      .mockResolvedValue(mastodonPost({ favourited: false, favouritesCount: 3 }))
    // A list caches its posts before it shows a card.
    cacheStatus(mastodonPost())
    const el = await mount(statusCache.value.get('7')!, 'example.social')
    const fav = () => button(el, 'favourite')
    expect([fav().getAttribute('aria-pressed'), fav().getAttribute('aria-label'), fav().textContent?.trim()])
      .toEqual(['false', 'Favourite', '3'])

    fav().click()
    await settle(el)
    expect([fav().getAttribute('aria-pressed'), fav().getAttribute('aria-label'), fav().textContent?.trim()])
      .toEqual(['true', 'Unfavourite', '4'])
    expect(statusCache.value.get('7')!.favourited).toBe(true)

    fav().click()
    await settle(el)
    expect(unfavourite).toHaveBeenCalledWith({ id: '7' })
    expect([fav().getAttribute('aria-pressed'), fav().getAttribute('aria-label'), fav().textContent?.trim()])
      .toEqual(['false', 'Favourite', '3'])
  })
})

describe('Mastodon reader, Bluesky post', () => {
  it('no live buttons, a Bluesky sign-in hint, and no request to the Mastodon client', async () => {
    signIn()
    const favourite = vi.spyOn(activeClient.value!, 'favourite')
    const el = await mount(blueskyPost(), 'example.social')
    for (const cls of ['reply', 'boost', 'favourite', 'bookmark']) expect(soft(button(el, cls))).toBe(true)
    expect(button(el, 'favourite').title).toBe('Sign in with a Bluesky account to favourite')
    button(el, 'favourite').click()
    await el.updateComplete
    expect(favourite).not.toHaveBeenCalled()
    expect(button(el, 'favourite').getAttribute('aria-pressed')).toBe('false')
  })

  it('links by handle, never with the page\'s host; the post by its rkey', async () => {
    signIn()
    const el = await mount(blueskyPost(), 'example.social')
    expect(authorHref(el)).toBe('/@bob.example.com')
    expect(permalink(el)).toBe('/@bob.example.com/3k1')
  })

  it('links by DID when the handle is not valid', async () => {
    const el = await mount(blueskyPost(true))
    expect(authorHref(el)).toBe('/@did:plc:bob')
    expect(permalink(el)).toBe('/@did:plc:bob/3k1')
  })
})

describe('Bluesky reader', () => {
  it('Bluesky post: live buttons on any page, and the click goes to the active client with the post\'s ref', async () => {
    signIn('bluesky')
    const favourite = vi.spyOn(activeClient.value!, 'favourite').mockResolvedValue(blueskyPost())
    cacheStatus(blueskyPost())
    // The page's instance is a Mastodon host; a Bluesky post has none.
    const el = await mount(blueskyPost(), 'other.example')
    expect(soft(button(el, 'favourite'))).toBe(false)
    button(el, 'favourite').click()
    expect(favourite).toHaveBeenCalledWith(expect.objectContaining({
      id: POST_URI, bluesky: expect.objectContaining({ uri: POST_URI, cid: 'bafy1' }),
    }))
  })

  it('Mastodon post: no live buttons, a Mastodon sign-in hint, no request', async () => {
    signIn('bluesky')
    const favourite = vi.spyOn(activeClient.value!, 'favourite')
    const el = await mount(mastodonPost(), 'example.social')
    expect(soft(button(el, 'favourite'))).toBe(true)
    expect(button(el, 'favourite').title).toBe('Sign in with a Mastodon account to favourite')
    button(el, 'favourite').click()
    expect(favourite).not.toHaveBeenCalled()
  })
})

describe('signed out', () => {
  it('either network: no live buttons, the plain sign-in hint', async () => {
    for (const s of [mastodonPost(), blueskyPost()]) {
      const el = await mount(s)
      expect(soft(button(el, 'favourite'))).toBe(true)
      expect(button(el, 'favourite').title).toBe('Sign in to favourite')
      el.remove()
    }
  })
})
