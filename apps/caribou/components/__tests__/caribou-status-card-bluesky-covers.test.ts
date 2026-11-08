import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ClientModule from '@beatzball/caribou-mastodon-client'
import type { Relationship, Status } from '@beatzball/caribou-mastodon-client'
import {
  activeUserKey, cacheStatus, readSource, relationshipCache, relationshipKey, removeActiveUser, statusCache, users,
} from '@beatzball/caribou-state'
import '../caribou-status-card.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'
import { _testOnlyResetBlueskyVeil, _testOnlyVeilLoaded, setBlueskyReader } from '../_bluesky-moderation.js'
import { blueskyClients } from './_bluesky-clients.js'
import {
  ALICE, BSKY_LABELER, DEFS, LABELER, READER_KEY, asPostView, author, blueskyClient, fakeAgent, label,
  mappedPost, post, prefs, publicPost, quoting, readerOf, signInBluesky, type FakeAgent,
} from './_bluesky-helpers.js'

// Covers compose; the strictest wins; a decision belongs to one reader
// (app README, "Bluesky views"). Every post is a labeled AppView fixture
// through the real client and the real `moderate()`, then JSON.

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
const $$ = (el: Element, sel: string) => [...el.shadowRoot!.querySelectorAll<HTMLElement>(sel)]

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
function signIn() {
  agent = fakeAgent()
  signInBluesky(blueskyClient(agent))
}

// The reader mutes `did`: in the cache, and as the AppView answers a
// relationship read, so a fetch the card makes agrees.
function mute(did: string) {
  agent.getProfiles.mockResolvedValue({ data: { profiles: [{ ...author(did), viewer: { muted: true } }] } } as never)
  relationshipCache.value = new Map([[relationshipKey(READER_KEY, did), {
    id: did, following: false, muting: true, blocking: false,
  } as Relationship]])
}

const withFilter = (s: Status): Status => ({
  ...s,
  filtered: [{ filter: { id: 'f', title: 'Spoilers', context: ['thread', 'home'], filterAction: 'warn' }, keywordMatches: [] }],
} as unknown as Status)

const NO_UNAUTH = 'This account asked to be seen only by signed-in readers.'

beforeEach(() => {
  document.body.replaceChildren()
  statusCache.value = new Map()
  relationshipCache.value = new Map()
  users.value = new Map()
  activeUserKey.value = null
  blueskyClients.clear()
  localStorage.clear()
  _testOnlyResetBlueskyVeil()
})
afterEach(() => { vi.restoreAllMocks() })

describe('covers compose; the strictest wins', () => {
  it('a muted author does not lift a noOverride label: no Show anywhere', async () => {
    signIn()
    mute(ALICE)
    const el = await mount(await mappedPost(post({ labels: [label('!hide', BSKY_LABELER)] })), 'focused')
    expect($(el, 'article.labeled')).not.toBeNull()
    expect($(el, 'button.filter-toggle')).toBeNull()
    expect($(el, '.status-content')).toBeNull()
  })

  it('an overridable label over a mute: each Show lifts only its own cover', async () => {
    signIn()
    mute(ALICE)
    // `!warn` covers the opened post (contentView) and allows Show.
    const el = await mount(await mappedPost(post({ labels: [label('!warn', BSKY_LABELER)] })), 'focused')
    expect($$(el, 'button.filter-toggle')).toHaveLength(1)
    $$(el, 'button.filter-toggle')[0]!.click()
    await settle(el)
    // The label is lifted; the mute cover is still there.
    expect($(el, '.status-content')).toBeNull()
    expect(el.shadowRoot!.textContent).toContain('You muted')
    const toggles = $$(el, 'button.filter-toggle')
    expect(toggles).toHaveLength(2)
    toggles[1]!.click()
    await settle(el)
    expect($(el, '.status-content')).not.toBeNull()
  })

  it('a filter verdict and a label: two covers, two Shows', async () => {
    signIn()
    const el = await mount(withFilter(await mappedPost(post({ labels: [label('spoiler', LABELER)] }))))
    expect(el.shadowRoot!.textContent).toContain('Spoiler')
    $$(el, 'button.filter-toggle')[0]!.click()
    await settle(el)
    expect($(el, '.status-content')).toBeNull()
    expect(el.shadowRoot!.textContent).toContain('Hidden by filter')
    $$(el, 'button.filter-toggle')[1]!.click()
    await settle(el)
    expect($(el, '.status-content')).not.toBeNull()
  })

  it('a filter verdict does not lift a noOverride label', async () => {
    signIn()
    const el = await mount(withFilter(await mappedPost(post({ labels: [label('!hide', BSKY_LABELER)] }))), 'focused')
    expect($(el, 'button.filter-toggle')).toBeNull()
    expect($(el, '.status-content')).toBeNull()
  })
})

describe('a decision belongs to one reader', () => {
  it('after sign-out a signed-in copy of a !no-unauthenticated author shows only the notice', async () => {
    signIn()
    const view = post({ author: author(ALICE, [label('!no-unauthenticated', ALICE, `at://${ALICE}/app.bsky.actor.profile/self`)]) })
    const el = await mount(await mappedPost(view), 'focused')
    expect($(el, '.status-content')).not.toBeNull()
    removeActiveUser()
    await settle(el)
    expect($(el, '.status-content')).toBeNull()
    expect(el.shadowRoot!.textContent).toContain(NO_UNAUTH)
    expect($(el, 'button.filter-toggle')).toBeNull()
  })

  it('after sign-out a clean signed-in copy is covered: its decision was not made for this reader', async () => {
    signIn()
    const el = await mount(await mappedPost(post()))
    expect($(el, '.status-content')).not.toBeNull()
    removeActiveUser()
    await settle(el)
    expect($(el, '.status-content')).toBeNull()
    expect($(el, 'article.labeled')!.textContent).toContain('Checking this post')
    expect($(el, 'button.filter-toggle')).toBeNull()
  })

  it('through the status cache, after sign-out the cached copy is covered, never shown as clean', async () => {
    signIn()
    const s = await mappedPost(post())
    cacheStatus(s)
    const el = await mount(s)
    expect($(el, '.status-content')).not.toBeNull()
    removeActiveUser()
    await settle(el)
    // The cache cleared the copy's reader and, with it, its decision.
    expect(statusCache.value.get(s.id)!.bluesky!.viewerOf).toBeNull()
    expect($(el, '.status-content')).toBeNull()
    expect($(el, 'button.filter-toggle')).toBeNull()
  })

  it('a signed-out copy (no reader) shows to a signed-out reader', async () => {
    const el = await mount(publicPost(post()))
    expect($(el, '.status-content')).not.toBeNull()
  })

  it('a signed-out copy is not reused for a signed-in reader', async () => {
    signIn()
    const el = await mount(publicPost(post()))
    expect($(el, '.status-content')).toBeNull()
    expect($(el, 'article.labeled')!.textContent).toContain('Checking this post')
  })

  it('signed out, a !no-unauthenticated author never shows, whatever the copy says', async () => {
    const view = post({ author: author(ALICE, [label('!no-unauthenticated', ALICE)]) })
    const el = await mount(publicPost(view), 'focused')
    expect($(el, '.status-content')).toBeNull()
    expect(el.shadowRoot!.textContent).toContain(NO_UNAUTH)
  })

  it('a Bluesky post with no moderation is covered (fail closed)', async () => {
    signIn()
    const s = await mappedPost(post())
    delete (s.bluesky as { moderation?: unknown }).moderation
    const el = await mount(s)
    expect($(el, '.status-content')).toBeNull()
    expect($(el, 'article.labeled')!.textContent).toContain('moderation failed')
  })
})

describe('Retry', () => {
  it('a successful Retry moves focus to the revealed post', async () => {
    signIn()
    const el = await mount(publicPost(post()))
    agent.getPosts.mockResolvedValue({ data: { posts: [asPostView(post())] } })
    const retry = $(el, 'caribou-button.retry')!
    retry.focus()
    retry.click()
    await settle(el)
    await settle(el)
    expect($(el, '.status-content')).not.toBeNull()
    expect(el.shadowRoot!.activeElement).toBe($(el, 'article'))
  })
})

describe('media toggle', () => {
  it('says its state with aria-pressed', async () => {
    const warn = { prefs: (await import('./_bluesky-helpers.js')).prefs({ adultContentEnabled: true, labels: { 'graphic-media': 'warn' } }) }
    agent = fakeAgent()
    signInBluesky(blueskyClient(agent, warn))
    const { externalView } = await import('../../../../packages/bluesky-client/src/__fixtures__/embeds.js')
    const view = post({ labels: [label('graphic-media', BSKY_LABELER)] })
    ;(view as { embed: unknown }).embed = externalView
    const el = await mount(await mappedPost(view, warn))
    const toggle = $(el, 'button.media-toggle')!
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    toggle.click()
    await settle(el)
    expect($(el, 'button.media-toggle')!.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('the quote card', () => {
  const quoteOf = async (el: CaribouStatusCard) => {
    const q = $(el, 'caribou-status-quote') as HTMLElement & { updateComplete: Promise<boolean> }
    await q.updateComplete
    return q
  }
  const quotedUri = `at://${ALICE}/app.bsky.feed.post/3kabc2xyzaa22`

  it('follows a newer cached copy of the quoted post: a fresh !hide covers it', async () => {
    signIn()
    const el = await mount(await mappedPost(quoting({})))
    let q = await quoteOf(el)
    expect(q.shadowRoot!.querySelector('.quote-content')).not.toBeNull()
    const fresh = await mappedPost({ ...post({ labels: [label('!hide', BSKY_LABELER)] }), uri: quotedUri })
    cacheStatus(fresh)
    await settle(el)
    q = await quoteOf(el)
    expect(q.shadowRoot!.querySelector('.quote-content')).toBeNull()
    expect(q.shadowRoot!.querySelector('button.filter-toggle')).toBeNull()
  })

  it('a fail-closed quote has a Retry that refetches the quoted post', async () => {
    signIn()
    const el = await mount(await mappedPost(quoting({ labels: [label('not-defined', LABELER)] })))
    let q = await quoteOf(el)
    expect(q.shadowRoot!.querySelector('.quote-note')!.textContent).toContain('unknown label')
    agent.getPosts.mockResolvedValue({ data: { posts: [asPostView({ ...post(), uri: quotedUri })] } })
    const quoteRetry = q.shadowRoot!.querySelector('caribou-button.retry') as HTMLElement
    quoteRetry.focus()
    quoteRetry.click()
    await settle(el)
    q = await quoteOf(el)
    expect(agent.getPosts).toHaveBeenCalledWith({ uris: [quotedUri] })
    expect(q.shadowRoot!.querySelector('.quote-content')).not.toBeNull()
    // Focus went from the Retry to the quote it revealed.
    expect(q.shadowRoot!.activeElement).toBe(q.shadowRoot!.querySelector('.quote'))
  })

  it("a signed-out reader never uses another reader's copy of the quoted post", async () => {
    // The outer post is the signed-out copy; a reader's copy of the quoted
    // post sits in the cache (left from a session that ended).
    const el = await mount(publicPost(quoting({})), 'focused')
    let q = await quoteOf(el)
    expect(q.shadowRoot!.querySelector('.quote-content')).not.toBeNull()
    cacheStatus(await mappedPost({ ...post(), uri: quotedUri }))
    await settle(el)
    q = await quoteOf(el)
    expect(q.shadowRoot!.querySelector('.quote-content')).toBeNull()
    // The cache dropped the other reader's decision: covered, no Show.
    expect(q.shadowRoot!.querySelector('.quote-note')).not.toBeNull()
    expect(q.shadowRoot!.querySelector('button.filter-toggle')).toBeNull()
  })
})

describe('the veil on every surface: every subscribed labeler covered', () => {
  const NEW_LABELER = 'did:plc:newlabeler'
  const quotedUri = `at://${ALICE}/app.bsky.feed.post/3kabc2xyzaa22`
  const ALL = [BSKY_LABELER, LABELER, NEW_LABELER]
  const quoteOf = async (el: CaribouStatusCard) => {
    const q = $(el, 'caribou-status-quote') as HTMLElement & { updateComplete: Promise<boolean> }
    await q.updateComplete
    return q
  }

  it('a quoted copy for this reader that misses a labeler stays covered until a covered copy arrives', async () => {
    signIn()
    const el = await mount(await mappedPost(quoting({})))
    cacheStatus(await mappedPost({ ...post(), uri: quotedUri }, { covered: [BSKY_LABELER] }), readSource(READER_KEY))
    await settle(el)
    let q = await quoteOf(el)
    expect($(el, '.status-content')).not.toBeNull()
    expect(q.shadowRoot!.querySelector('.quote-content')).toBeNull()
    expect(q.shadowRoot!.querySelector('button.filter-toggle')).toBeNull()
    expect(q.shadowRoot!.querySelector('caribou-button.retry')).not.toBeNull()
    cacheStatus(await mappedPost({ ...post(), uri: quotedUri }), readSource(READER_KEY))
    await settle(el)
    q = await quoteOf(el)
    expect(q.shadowRoot!.querySelector('.quote-content')).not.toBeNull()
  })

  it('a new subscription covers the quote again, while the outer post (covered for it) shows', async () => {
    signIn()
    const el = await mount(await mappedPost(quoting({}), { covered: ALL }))
    cacheStatus(await mappedPost({ ...post(), uri: quotedUri }), readSource(READER_KEY))
    await settle(el)
    expect((await quoteOf(el)).shadowRoot!.querySelector('.quote-content')).not.toBeNull()
    setBlueskyReader(readerOf({
      prefs: prefs({ labelers: [{ did: BSKY_LABELER, labels: {} }, { did: LABELER, labels: {} }, { did: NEW_LABELER, labels: {} }] }),
      defs: { ...DEFS, [NEW_LABELER]: [] },
    }))
    await settle(el)
    expect($(el, '.status-content')).not.toBeNull()
    expect((await quoteOf(el)).shadowRoot!.querySelector('.quote-content')).toBeNull()
  })
})

describe('Retry needs a reader', () => {
  it('signed out, a cover has no Retry', async () => {
    signIn()
    const el = await mount(await mappedPost(post()))
    removeActiveUser()
    await settle(el)
    expect($(el, 'article.filtered')).not.toBeNull()
    expect($(el, 'caribou-button.retry')).toBeNull()
  })
})

describe('the article class follows the cover shown', () => {
  it('a lifted label over a filter cover: the article is no longer "labeled"', async () => {
    signIn()
    const el = await mount(withFilter(await mappedPost(post({ labels: [label('spoiler', LABELER)] }))))
    expect($(el, 'article')!.classList.contains('labeled')).toBe(true)
    $$(el, 'button.filter-toggle')[0]!.click()
    await settle(el)
    expect($(el, 'article')!.classList.contains('labeled')).toBe(false)
    expect($(el, 'article')!.classList.contains('filtered')).toBe(true)
  })
})

describe('the settled check keeps tracking after a first run with no fitting decision', () => {
  const NEW_LABELER = 'did:plc:newlabeler'

  it('card: ownership cover, Retry, then a new subscription re-covers', async () => {
    agent = fakeAgent()
    signInBluesky(blueskyClient(agent))
    // The signed-out copy is not this reader's: covered on the first run.
    const el = await mount(publicPost(post()))
    expect($(el, '.status-content')).toBeNull()
    agent.getPosts.mockResolvedValue({ data: { posts: [asPostView(post())] } })
    $(el, 'caribou-button.retry')!.click()
    await settle(el)
    expect($(el, '.status-content')).not.toBeNull()
    setBlueskyReader(readerOf({
      prefs: prefs({ labelers: [{ did: BSKY_LABELER, labels: {} }, { did: LABELER, labels: {} }, { did: NEW_LABELER, labels: {} }] }),
      defs: { ...DEFS, [NEW_LABELER]: [] },
    }))
    await settle(el)
    expect($(el, '.status-content')).toBeNull()
  })
})
