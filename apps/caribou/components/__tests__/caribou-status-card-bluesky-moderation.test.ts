import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, Status, StatusBluesky } from '@beatzball/caribou-mastodon-client'
import type * as ClientModule from '@beatzball/caribou-mastodon-client'
import { toUserKey } from '@beatzball/caribou-auth'
import {
  LABELER_UNAVAILABLE, MODERATION_FAILED, UNKNOWN_LABEL, isNoUnauthenticated,
} from '@beatzball/caribou-bluesky-client/moderation'
import {
  activeUserKey, addUserSession, statusCache, users,
} from '@beatzball/caribou-state'
import {
  externalView, feedGeneratorView,
} from '../../../../packages/bluesky-client/src/__fixtures__/embeds.js'
import '../caribou-status-card.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'
import type { CaribouStatusMedia } from '../caribou-status-media.js'
import type { CaribouStatusLinkCard } from '../caribou-status-link-card.js'
import {
  _testOnlyResetBlueskyVeil, _testOnlyVeilLoaded, asksNoUnauthenticated, isFailClosed, setBlueskyReader,
} from '../_bluesky-moderation.js'
import { blueskyClients } from './_bluesky-clients.js'
import {
  ALICE, BSKY_LABELER, LABELER, READER_DID, asPostView, author, blueskyClient, fakeAgent, label,
  mappedPost, post, prefs, publicPost, quoting, readerOf, signInBluesky, type FakeAgent,
} from './_bluesky-helpers.js'

// Moderation wired into the card (#184; spec 7.4; rules in the app README,
// "Bluesky views"). Each post is a labeled AppView fixture mapped by the
// real client with the real `moderate()`, sent through JSON, and rendered.

vi.mock('@beatzball/caribou-mastodon-client', async (importOriginal) => {
  const real = await importOriginal<typeof ClientModule>()
  const { blueskyClients: made } = await import('./_bluesky-clients.js')
  return {
    ...real,
    createCaribouClient: (...args: Parameters<typeof real.createCaribouClient>) =>
      (made.get(args[0]) as ReturnType<typeof real.createCaribouClient> | undefined) ?? real.createCaribouClient(...args),
  }
})

const $ = (el: Element, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel)

async function settle(el: CaribouStatusCard) {
  for (let i = 0; i < 4; i++) {
    await _testOnlyVeilLoaded()
    await new Promise((r) => setTimeout(r, 0))
    while (!(await el.updateComplete)) { /* settle */ }
  }
}

async function mount(status: Status, variant: CaribouStatusCard['variant'] = 'timeline'): Promise<CaribouStatusCard> {
  const el = document.createElement('caribou-status-card') as CaribouStatusCard
  el.variant = variant
  el.setAttribute('filter-context', variant === 'focused' ? 'thread' : 'home')
  el.status = status
  document.body.appendChild(el)
  await settle(el)
  return el
}

let agent: FakeAgent

// A Bluesky reader, signed in, with the veil's reader loaded: the cards
// settle and show their moderation.
function signIn(opts: Parameters<typeof blueskyClient>[1] = {}) {
  agent = fakeAgent()
  signInBluesky(blueskyClient(agent, opts))
}

// Adult content on, adult labels set to warn: the SDK then blurs with a
// Show button instead of hiding. The defaults (adult content off) hide an
// adult-labeled post from lists and lock its media.
const WARN = { prefs: prefs({ adultContentEnabled: true, labels: { porn: 'warn', 'graphic-media': 'warn' } }) }

const media = (el: Element) => $(el, 'caribou-status-media') as CaribouStatusMedia | null
const linkCards = (el: Element) => [...el.shadowRoot!.querySelectorAll<CaribouStatusLinkCard>('caribou-status-link-card')]

beforeEach(() => {
  document.body.replaceChildren()
  statusCache.value = new Map()
  users.value = new Map()
  activeUserKey.value = null
  blueskyClients.clear()
  localStorage.clear()
  _testOnlyResetBlueskyVeil()
})
afterEach(() => { vi.restoreAllMocks() })

describe('fail-closed reason names', () => {
  it('match the moderation module', () => {
    for (const name of [LABELER_UNAVAILABLE, UNKNOWN_LABEL, MODERATION_FAILED]) {
      expect(isFailClosed({ label: 'x', source: 'y', name })).toBe(true)
    }
    expect(isFailClosed({ label: 'spoiler', source: LABELER, name: 'Spoiler' })).toBe(false)
  })

  it('the !no-unauthenticated check matches the moderation module', () => {
    const cases = [
      [], [label('!no-unauthenticated', ALICE)], [label('!no-unauthenticated', ALICE, undefined, { neg: true })],
      [label('porn', ALICE)],
    ]
    for (const labels of cases) {
      expect(asksNoUnauthenticated({ bluesky: { labels } })).toBe(isNoUnauthenticated({ labels }))
    }
    expect(asksNoUnauthenticated({})).toBe(false)
  })
})

describe('contentMedia → caribou-status-media', () => {
  it('an adult label with adult content off: sensitive, no-override, no Show button', async () => {
    signIn()
    // Hidden from lists (contentList.filter); the post the reader opened shows, media locked.
    const el = await mount(await mappedPost(post({ labels: [label('porn', BSKY_LABELER)] })), 'focused')
    const m = media(el)!
    expect(m.sensitive).toBe(true)
    expect(m.hasAttribute('no-override')).toBe(true)
    await m.updateComplete
    expect(m.shadowRoot!.querySelector('.reveal')).toBeNull()
    expect(m.shadowRoot!.textContent).toContain('Media hidden by a content label')
  })

  it('a graphic-media warn label: sensitive with a Show button', async () => {
    signIn(WARN)
    const el = await mount(await mappedPost(post({ labels: [label('graphic-media', BSKY_LABELER)] }), WARN))
    const m = media(el)!
    expect(m.sensitive).toBe(true)
    expect(m.hasAttribute('no-override')).toBe(false)
    await m.updateComplete
    expect(m.shadowRoot!.querySelector('.reveal')).not.toBeNull()
  })

  it('a clean post: not sensitive', async () => {
    signIn()
    const el = await mount(await mappedPost(post()))
    expect(media(el)!.sensitive).toBe(false)
    expect(media(el)!.hasAttribute('no-override')).toBe(false)
  })
})

describe('contentMedia covers the cards and their images', () => {
  const withEmbed = (embed: object, labels = [label('graphic-media', BSKY_LABELER)]) => {
    const view = post({ labels })
    ;(view as { embed: unknown }).embed = embed
    return view
  }

  it('the link card loses its image, with Show; Show brings it back', async () => {
    signIn(WARN)
    const el = await mount(await mappedPost(withEmbed(externalView), WARN))
    const [card] = linkCards(el)
    expect(card!.card!.title).toBeTruthy()
    expect(card!.card!.image).toBeNull()
    expect($(el, '.media-label')!.textContent).toContain('Media hidden by a content label')
    const show = $(el, 'button.media-toggle')!
    show.click()
    await settle(el)
    expect(linkCards(el)[0]!.card!.image).toBe(externalView.external.thumb)
  })

  it('with no-override the link card has no image and no Show', async () => {
    signIn()
    const el = await mount(await mappedPost(withEmbed(externalView, [label('porn', BSKY_LABELER)])), 'focused')
    expect(linkCards(el)[0]!.card!.image).toBeNull()
    expect($(el, '.media-label')).not.toBeNull()
    expect($(el, 'button.media-toggle')).toBeNull()
  })

  it('bluesky.recordCard (a feed) loses its avatar too', async () => {
    signIn(WARN)
    const el = await mount(await mappedPost(withEmbed(feedGeneratorView), WARN))
    const cards = linkCards(el)
    expect(cards).toHaveLength(1)
    expect(cards[0]!.card!.title).toBe('Caribou pictures')
    expect(cards[0]!.card!.image).toBeNull()
  })

  it('a clean post keeps every image', async () => {
    signIn()
    const el = await mount(await mappedPost(withEmbed(feedGeneratorView, [])))
    expect(linkCards(el)[0]!.card!.image).toBe(feedGeneratorView.record.avatar)
    expect($(el, '.media-label')).toBeNull()
  })
})

describe('the post cover (contentList, contentView)', () => {
  it('a custom warn label covers with its name and a Show button', async () => {
    signIn()
    const el = await mount(await mappedPost(post({ labels: [label('spoiler', LABELER)] })))
    const article = $(el, 'article')!
    expect(article.classList.contains('labeled')).toBe(true)
    expect(article.textContent).toContain('Spoiler')
    expect($(el, '.status-content')).toBeNull()
    $(el, 'button.filter-toggle')!.click()
    await settle(el)
    expect($(el, '.status-content')!.textContent).toContain('Hello from the fixture')
  })

  it('a no-override label (!hide) covers with no Show button', async () => {
    signIn()
    const el = await mount(await mappedPost(post({ labels: [label('!hide', BSKY_LABELER)] })), 'focused')
    expect($(el, 'article.labeled')).not.toBeNull()
    expect($(el, 'button.filter-toggle')).toBeNull()
    expect($(el, '.status-content')).toBeNull()
  })

  it('contentList.filter hides the card in a list; the focused post is never dropped', async () => {
    signIn()
    const s = await mappedPost(post({ labels: [label('scam-strict', LABELER)] }))
    expect(s.bluesky!.moderation.contexts.contentList.filter).toBe(true)
    const row = await mount(s)
    expect(row.hasAttribute('hidden')).toBe(true)
    // The SDK leaves this label's contentView alone: the opened post shows.
    const focused = await mount(s, 'focused')
    expect(focused.hasAttribute('hidden')).toBe(false)
    expect($(focused, '.status-content')).not.toBeNull()
  })

  it("the reader's own labeled post is covered, with Show", async () => {
    signIn()
    const own = post({ author: author(READER_DID), labels: [label('!hide', BSKY_LABELER)] })
    own.uri = `at://${READER_DID}/app.bsky.feed.post/3kown`
    const el = await mount(await mappedPost(own))
    expect(el.hasAttribute('hidden')).toBe(false)
    expect($(el, 'article.labeled')).not.toBeNull()
    expect($(el, 'button.filter-toggle')).not.toBeNull()
  })

  it('a labeler whose definitions failed: covered, no Show, with Retry that asks again', async () => {
    signIn({ defs: null })
    const s = await mappedPost(post({ labels: [label('spoiler', LABELER)] }), { defs: null })
    setBlueskyReader(readerOf())
    const el = await mount(s)
    expect($(el, 'article.labeled')!.textContent).toContain('labeler unavailable')
    expect($(el, 'button.filter-toggle')).toBeNull()
    const retried = vi.fn()
    window.addEventListener('caribou:bluesky-moderation-retry', retried)
    agent.getPosts.mockResolvedValue({ data: { posts: [asPostView(post())] } })
    ;($(el, 'caribou-button.retry') as HTMLElement).click()
    await settle(el)
    window.removeEventListener('caribou:bluesky-moderation-retry', retried)
    expect(retried).toHaveBeenCalledTimes(1)
    expect(agent.getPosts).toHaveBeenCalledWith({ uris: [s.id] })
    // The fresh copy is clean: the card reads it from the cache.
    expect($(el, 'article.labeled')).toBeNull()
    expect($(el, '.status-content')).not.toBeNull()
  })
})

describe('a result Caribou cannot read', () => {
  it('a missing context fails closed: covered, no Show, with Retry', async () => {
    signIn()
    const s = await mappedPost(post())
    delete (s.bluesky!.moderation.contexts as Partial<StatusBluesky["moderation"]["contexts"]>).contentList
    const el = await mount(s)
    expect(el.hasAttribute('hidden')).toBe(false)
    expect($(el, 'article.labeled')!.textContent).toContain('moderation failed')
    expect($(el, 'button.filter-toggle')).toBeNull()
    expect($(el, 'caribou-button.retry')).not.toBeNull()
  })
})

describe('avatar', () => {
  it("a labeled author's avatar is blurred, from the post's own result", async () => {
    signIn(WARN)
    const s = await mappedPost(post({ author: author(ALICE, [label('porn', BSKY_LABELER, ALICE)]) }), WARN)
    expect(s.account.bluesky!.moderation).toBeUndefined()
    const el = await mount(s)
    expect($(el, '.author img')!.classList.contains('blurred')).toBe(true)
  })

  it('a clean author is not', async () => {
    signIn()
    const el = await mount(await mappedPost(post()))
    expect($(el, '.author img')!.classList.contains('blurred')).toBe(false)
  })
})

describe('a quoted post', () => {
  const quoteOf = async (el: CaribouStatusCard) => {
    const q = $(el, 'caribou-status-quote') as HTMLElement & { updateComplete: Promise<boolean> }
    await q.updateComplete
    return q
  }

  it('a warn label covers the quote, with Show', async () => {
    signIn()
    const el = await mount(await mappedPost(quoting({ labels: [label('spoiler', LABELER)] })))
    const q = await quoteOf(el)
    expect(q.shadowRoot!.querySelector('.quote-note')!.textContent).toContain('Spoiler')
    expect(q.shadowRoot!.querySelector('.quote-content')).toBeNull()
    ;(q.shadowRoot!.querySelector('button.filter-toggle') as HTMLElement).click()
    await q.updateComplete
    expect(q.shadowRoot!.querySelector('.quote-content')!.textContent).toContain('Quoted')
  })

  it('a no-override label covers the quote with no Show', async () => {
    signIn()
    // The outer post counts its quote's labels too: open it, as a thread would.
    const el = await mount(await mappedPost(quoting({ labels: [label('!hide', BSKY_LABELER)] })), 'focused')
    const q = await quoteOf(el)
    expect(q.shadowRoot!.querySelector('.quote-note')).not.toBeNull()
    expect(q.shadowRoot!.querySelector('button.filter-toggle')).toBeNull()
    expect(q.shadowRoot!.querySelector('.quote-content')).toBeNull()
  })

  it("a labeled quoted author's avatar is blurred", async () => {
    signIn(WARN)
    const el = await mount(await mappedPost(quoting({ author: author(ALICE, [label('porn', BSKY_LABELER, ALICE)]) }), WARN))
    const q = await quoteOf(el)
    expect(q.shadowRoot!.querySelector('.author img')!.classList.contains('blurred')).toBe(true)
  })
})

describe('the reader veil', () => {
  it('with a Bluesky account and no reader loaded, the post stays covered, with no Show', async () => {
    agent = fakeAgent()
    signInBluesky(blueskyClient(agent), null)
    const el = await mount(await mappedPost(post()))
    expect($(el, 'article.labeled')!.textContent).toContain('Checking this post against your moderation settings')
    expect($(el, 'button.filter-toggle')).toBeNull()
    expect($(el, '.status-content')).toBeNull()
    // The reader loads: the post shows.
    setBlueskyReader(readerOf())
    await settle(el)
    expect($(el, '.status-content')).not.toBeNull()
  })

  it("a post fetched without a subscribed labeler's labels stays covered", async () => {
    signIn({ covered: [BSKY_LABELER] })
    const el = await mount(await mappedPost(post(), { covered: [BSKY_LABELER] }))
    expect($(el, 'article.labeled')).not.toBeNull()
    expect($(el, '.status-content')).toBeNull()
  })

  it('a reader for another account is no reader', async () => {
    signIn()
    setBlueskyReader({ ...readerOf(), userKey: 'did:plc:other@bsky' })
    const el = await mount(await mappedPost(post()))
    expect($(el, '.status-content')).toBeNull()
  })

  it('with a Mastodon account active, a Bluesky post settles at once', async () => {
    addUserSession({
      userKey: toUserKey('alice', 'example.social'), server: 'example.social', token: 't', vapidKey: '', createdAt: 0,
      account: { id: 'me', acct: 'alice', username: 'alice' } as Account,
    })
    // The copy a reader with no Bluesky account gets: decided for no reader.
    const el = await mount(publicPost(post()))
    expect($(el, '.status-content')).not.toBeNull()
  })

  it('signed out, a Bluesky post settles at once', async () => {
    const el = await mount(publicPost(post()))
    expect($(el, '.status-content')).not.toBeNull()
  })
})
