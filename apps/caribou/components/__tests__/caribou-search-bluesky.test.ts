import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CaribouError, type Account, type Capabilities, type CaribouClient, type Relationship, type Search, type SearchInput, type Status,
} from '@beatzball/caribou-mastodon-client'
import {
  activeUserKey, blueskyUserKey, relationshipCache, setBlueskyDriver, statusCache, users, type BlueskyDriver, type UserSession,
} from '@beatzball/caribou-state'
import '../caribou-search.js'
import type { CaribouSearch as El } from '../caribou-search.js'
import { _testOnlyResetBlueskyVeil, _testOnlyVeilLoaded, setBlueskyReader } from '../_bluesky-moderation.js'

// Search with a Bluesky account active (README, "Bluesky search and hashtag
// page"): people and posts from the reader's client, paging by cursor,
// clear messages, and each person row through the reader's moderation.

const CAPS = { network: 'bluesky', readLagMs: 60_000, followTags: false } as unknown as Capabilities
const alice = blueskyUserKey('did:plc:alice')
const BSKY_LABELER = 'did:plc:ar7c4by46qjdydhdevvrndac'

const CONTEXTS = ['contentList', 'contentView', 'contentMedia', 'avatar', 'banner', 'profileList', 'profileView']
type Ui = { filter: boolean; blur: boolean; alert: boolean; inform: boolean; noOverride: boolean; reasons: { label: string; source: string; name: string }[] }
const CLEAN: Ui = { filter: false, blur: false, alert: false, inform: false, noOverride: false, reasons: [] }

function decision(over: Partial<Record<string, Partial<Ui>>> = {}, covered = [BSKY_LABELER]) {
  return { contexts: Object.fromEntries(CONTEXTS.map((c) => [c, { ...CLEAN, ...over[c] }])), labelersCovered: covered }
}

function person(name: string, moderation: unknown = decision()): Account {
  const did = `did:plc:${name}`
  return {
    id: did, acct: `${name}.example.com`, username: `${name}.example.com`, displayName: name.toUpperCase(),
    avatar: `https://cdn.example.test/${name}.jpg`, avatarStatic: `https://cdn.example.test/${name}.jpg`,
    url: `https://bsky.app/profile/${name}.example.com`,
    bluesky: { did, handleInvalid: false, labels: [], moderation },
  } as unknown as Account
}

function post(rkey: string): Status {
  const uri = `at://did:plc:bob/app.bsky.feed.post/${rkey}`
  return {
    id: uri, uri, url: null, content: `<p>post ${rkey}</p>`, createdAt: '2026-11-07T08:00:00.000Z',
    account: person('bob'), inReplyToId: null, mediaAttachments: [], emojis: [], mentions: [], tags: [],
    bluesky: {
      uri, cid: 'c', likeUri: null, repostUri: null, replyRef: null, replyDisabled: false, embeddingDisabled: false,
      labels: [], moderation: decision(), viewerOf: alice,
    },
  } as unknown as Status
}

const answer = (over: Partial<Search> = {}, cursors = { accountsCursor: null as string | null, statusesCursor: null as string | null }): Search =>
  ({ accounts: [], statuses: [], hashtags: [], bluesky: cursors, ...over })

const search = vi.fn<(p: SearchInput) => Promise<Search>>()
const fetchRelationships = vi.fn<(ids: string[]) => Promise<Relationship[]>>()

const driver: BlueskyDriver = {
  capabilities: CAPS,
  timelineOrder: () => null,
  restore: async (s) => ({
    userKey: s.userKey, capabilities: CAPS, timelineOrder: () => null, search, fetchRelationships,
  }) as unknown as CaribouClient,
  signOut: async () => {},
}

function signIn() {
  const s: UserSession = {
    network: 'bluesky', userKey: alice, did: 'did:plc:alice', handle: 'alice.example.com',
    pds: 'https://pds.example.test', generation: 'G1', account: null, createdAt: 1,
  }
  users.value = new Map([[alice, s]])
  activeUserKey.value = alice
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

async function settle(el: El) {
  // The veil's check loads lazily, once the element has mounted.
  await el.updateComplete
  await flush()
  await _testOnlyVeilLoaded()
  for (let i = 0; i < 4; i++) {
    await flush()
    await el.updateComplete
  }
}

async function mount(q: string, type: 'accounts' | 'hashtags' | 'statuses' = 'accounts'): Promise<El> {
  history.replaceState(null, '', `/search?q=${encodeURIComponent(q)}`)
  const el = document.createElement('caribou-search') as El
  el.q = q
  el.type = type
  document.body.appendChild(el)
  await settle(el)
  return el
}

const text = (el: El) => el.shadowRoot!.querySelector('.results')!.textContent!.replace(/\s+/g, ' ').trim()
const rows = (el: El) => [...el.shadowRoot!.querySelectorAll('.accounts > li')]
const more = (el: El) => el.shadowRoot!.querySelector<HTMLElement>('caribou-button.more')

async function tab(el: El, label: string) {
  const a = [...el.shadowRoot!.querySelectorAll<HTMLAnchorElement>('caribou-tabs a')].find((x) => x.textContent === label)!
  a.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, button: 0 }))
  await settle(el)
}

beforeEach(() => {
  setBlueskyDriver(driver)
  _testOnlyResetBlueskyVeil()
  setBlueskyReader({
    userKey: alice,
    prefs: { adultContentEnabled: false, labels: {}, labelers: [], mutedWords: [], hiddenPosts: [] },
    labelDefs: { [BSKY_LABELER]: [] },
  })
  search.mockReset()
  fetchRelationships.mockReset()
  fetchRelationships.mockResolvedValue([])
  relationshipCache.value = new Map()
  statusCache.value = new Map()
  localStorage.clear()
  signIn()
})

afterEach(() => {
  document.body.replaceChildren()
  setBlueskyDriver(null)
  users.value = new Map()
  activeUserKey.value = null
})

describe('<caribou-search> with a Bluesky account', () => {
  it('asks people and posts from the reader\'s client and links each person by handle', async () => {
    search.mockResolvedValue(answer({ accounts: [person('carol')], statuses: [post('p1')] }))
    const el = await mount('cats')
    expect(search).toHaveBeenCalledWith({ q: 'cats', limit: 20 })
    const link = rows(el)[0]!.querySelector('a.who')!
    expect(link.getAttribute('href')).toBe('/@carol.example.com')
    expect(rows(el)[0]!.querySelector('.acct')!.textContent).toBe('@carol.example.com')
    await tab(el, 'Posts')
    expect(el.shadowRoot!.querySelectorAll('caribou-status-card')).toHaveLength(1)
  })

  it('pages people with More people, adds only new ones, and hides the button at the end', async () => {
    search.mockResolvedValueOnce(answer({ accounts: [person('carol')] }, { accountsCursor: 'A2', statusesCursor: null }))
    const el = await mount('cats')
    expect(more(el)!.textContent).toContain('More people')
    search.mockResolvedValueOnce(answer({ accounts: [person('carol'), person('dan')] }))
    more(el)!.click()
    await settle(el)
    expect(search).toHaveBeenLastCalledWith({ q: 'cats', type: 'accounts', cursor: 'A2', limit: 20 })
    expect(rows(el).map((r) => r.querySelector('.acct')!.textContent)).toEqual(['@carol.example.com', '@dan.example.com'])
    expect(more(el)).toBeNull()
  })

  it('keeps the list when a page fails, and says so with Retry', async () => {
    search.mockResolvedValueOnce(answer({ statuses: [post('p1')] }, { accountsCursor: null, statusesCursor: 'P2' }))
    const el = await mount('cats', 'statuses')
    expect(more(el)!.textContent).toContain('More posts')
    search.mockRejectedValueOnce(new CaribouError('server_error', 'boom'))
    more(el)!.click()
    await settle(el)
    expect(el.shadowRoot!.querySelectorAll('caribou-status-card')).toHaveLength(1)
    expect(text(el)).toContain('Could not load more.')
    search.mockResolvedValueOnce(answer({ statuses: [post('p2')] }))
    more(el)!.click()
    await settle(el)
    expect(el.shadowRoot!.querySelectorAll('caribou-status-card')).toHaveLength(2)
    expect(text(el)).not.toContain('Could not load more.')
  })

  it('says a 429 plainly, with Retry', async () => {
    search.mockRejectedValue(new CaribouError('rate_limited', 'Bluesky is getting too many requests. Wait a minute, then try again.'))
    const el = await mount('cats')
    expect(text(el)).toContain('Bluesky is getting too many requests. Wait a minute, then try again.')
    expect(el.shadowRoot!.querySelector('[role="alert"] caribou-button')!.textContent).toContain('Retry')
  })

  it('says the empty result', async () => {
    search.mockResolvedValue(answer())
    const el = await mount('zzz')
    expect(text(el)).toContain('No people found for “zzz”.')
  })

  it('leaves out a filtered person, covers a blurred one, and blurs a labeled face', async () => {
    search.mockResolvedValue(answer({ accounts: [
      person('hidden', decision({ profileList: { filter: true } })),
      person('covered', decision({ profileList: { blur: true, reasons: [{ label: 'rude', source: BSKY_LABELER, name: 'Rude' }] } })),
      person('face', decision({ avatar: { blur: true } })),
      person('none', null),
    ] }))
    const el = await mount('x')
    const r = rows(el)
    expect(r).toHaveLength(3)
    expect(r[0]!.textContent).toContain('Someone (Content warning: Rude)')
    expect(r[0]!.querySelector('a')).toBeNull()
    expect(r[0]!.textContent).not.toContain('COVERED')
    expect(r[1]!.querySelector('img.avatar')!.classList.contains('blurred')).toBe(true)
    expect(r[1]!.querySelector('a.who')).not.toBeNull()
    // No decision: covered (fail closed).
    expect(r[2]!.querySelector('a')).toBeNull()
    expect(r[2]!.textContent).not.toContain('NONE')
  })

  it('covers a person until the decision is settled for the reader', async () => {
    search.mockResolvedValue(answer({ accounts: [person('carol', decision({}, []))] }))
    const el = await mount('carol')
    const r = rows(el)[0]!
    expect(r.textContent).toContain('Checking this account against your moderation settings…')
    expect(r.querySelector('a')).toBeNull()
    expect(r.querySelector('img.avatar')!.classList.contains('blurred')).toBe(true)
  })

  it('offers the query as a Bluesky hashtag on the Hashtags tab', async () => {
    search.mockResolvedValue(answer())
    const el = await mount('#Cats', 'hashtags')
    const a = el.shadowRoot!.querySelector<HTMLAnchorElement>('.hashtags a.tag')!
    expect(a.getAttribute('href')).toBe('/tags/Cats?net=bsky')
    expect(a.textContent).toContain('#Cats')
    el.remove()
    const other = await mount('two words', 'hashtags')
    expect(text(other)).toContain('Bluesky does not search hashtags. Type a hashtag name to open its page.')
  })

  it('searches a web address as text, with no address note', async () => {
    search.mockResolvedValue(answer())
    const el = await mount('https://bsky.app/profile/carol.example.com')
    expect(search).toHaveBeenCalledWith({ q: 'https://bsky.app/profile/carol.example.com', limit: 20 })
    expect(text(el)).not.toContain('Press Enter')
  })

  // #251 review (Codex 3): the busy button keeps focus, and when the last
  // page removes it, focus moves to the first new result.
  it('keeps More focused while it loads, then focuses the first new person', async () => {
    search.mockResolvedValueOnce(answer({ accounts: [person('carol')] }, { accountsCursor: 'A2', statusesCursor: null }))
    const el = await mount('cats')
    let finish!: (s: Search) => void
    search.mockImplementationOnce(() => new Promise<Search>((r) => { finish = r }))
    const button = more(el)!
    button.focus()
    expect(el.shadowRoot!.activeElement).toBe(button)
    button.click()
    await settle(el)
    expect(more(el)).toBe(button)
    expect((button as HTMLElement & { loading: boolean }).loading).toBe(true)
    expect(el.shadowRoot!.activeElement).toBe(button)
    finish(answer({ accounts: [person('dan')] }))
    await settle(el)
    expect(button.isConnected).toBe(false)
    expect(el.shadowRoot!.activeElement).toBe(rows(el)[1])
  })

  it('focuses the list when the last page adds nothing new', async () => {
    search.mockResolvedValueOnce(answer({ statuses: [post('p1')] }, { accountsCursor: null, statusesCursor: 'P2' }))
    const el = await mount('cats', 'statuses')
    search.mockResolvedValueOnce(answer({ statuses: [post('p1')] }))
    more(el)!.focus()
    more(el)!.click()
    await settle(el)
    expect(more(el)).toBeNull()
    expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector('ul.statuses'))
  })

  // #251 review (Fable 2, Codex 4): paging one kind leaves the other's cursor.
  it('pages each kind with its own cursor', async () => {
    search.mockResolvedValueOnce(answer({ accounts: [person('carol')], statuses: [post('p1')] }, { accountsCursor: 'A2', statusesCursor: 'P2' }))
    const el = await mount('cats')
    search.mockResolvedValueOnce(answer({ accounts: [person('dan')] }, { accountsCursor: 'A3', statusesCursor: null }))
    more(el)!.click()
    await settle(el)
    expect(search).toHaveBeenLastCalledWith({ q: 'cats', type: 'accounts', cursor: 'A2', limit: 20 })
    await tab(el, 'Posts')
    search.mockResolvedValueOnce(answer({ statuses: [post('p2')] }))
    more(el)!.click()
    await settle(el)
    expect(search).toHaveBeenLastCalledWith({ q: 'cats', type: 'statuses', cursor: 'P2', limit: 20 })
    expect(el.shadowRoot!.querySelectorAll('caribou-status-card')).toHaveLength(2)
    await tab(el, 'People')
    // People still page on from their own cursor.
    search.mockResolvedValueOnce(answer({ accounts: [person('erin')] }))
    more(el)!.click()
    await settle(el)
    expect(search).toHaveBeenLastCalledWith({ q: 'cats', type: 'accounts', cursor: 'A3', limit: 20 })
    expect(rows(el)).toHaveLength(3)
  })

  // A page that lands after a new query or a new account is dropped: no row
  // and no error from it.
  it.each(['a new query', 'a new account'])('drops a late More page after %s', async (change) => {
    search.mockResolvedValueOnce(answer({ accounts: [person('carol')] }, { accountsCursor: 'A2', statusesCursor: null }))
    const el = await mount('cats')
    let finishOk!: (s: Search) => void
    search.mockImplementationOnce(() => new Promise<Search>((r) => { finishOk = r }))
    more(el)!.click()
    await settle(el)
    search.mockResolvedValue(answer({ accounts: [person('zed')] }))
    if (change === 'a new query') {
      const input = el.shadowRoot!.querySelector('input')!
      input.value = 'dogs'
      input.form!.dispatchEvent(new Event('submit', { cancelable: true }))
    } else {
      users.value = new Map()
      activeUserKey.value = null
      signIn()
    }
    await settle(el)
    finishOk(answer({ accounts: [person('late')] }))
    await settle(el)
    const names = rows(el).map((r) => r.querySelector('.acct')?.textContent)
    expect(names).not.toContain('@late.example.com')
    expect(names).toContain('@zed.example.com')
    expect(text(el)).not.toContain('Could not load more.')
  })

  it('drops a late failed More page after a new query', async () => {
    search.mockResolvedValueOnce(answer({ accounts: [person('carol')] }, { accountsCursor: 'A2', statusesCursor: null }))
    const el = await mount('cats')
    let fail!: (e: unknown) => void
    search.mockImplementationOnce(() => new Promise<Search>((_, reject) => { fail = reject }))
    more(el)!.click()
    await settle(el)
    search.mockResolvedValue(answer({ accounts: [person('zed')] }, { accountsCursor: 'Z2', statusesCursor: null }))
    const input = el.shadowRoot!.querySelector('input')!
    input.value = 'dogs'
    input.form!.dispatchEvent(new Event('submit', { cancelable: true }))
    await settle(el)
    fail(new CaribouError('server_error', 'boom'))
    await settle(el)
    expect(text(el)).not.toContain('Could not load more.')
    expect(more(el)!.textContent).toContain('More people')
  })
})
