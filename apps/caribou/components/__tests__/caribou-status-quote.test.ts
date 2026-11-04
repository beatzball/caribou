import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import { toUserKey } from '@beatzball/caribou-auth'
import { LitroRouter } from '@beatzball/litro-router'
import {
  _testOnlyResetRelationships, activeUserKey, addUserSession, deletedStatusIds, postRecords,
  mergeStatus, relationshipCache, relationshipKey, statusCache, users,
} from '@beatzball/caribou-state'
import '../caribou-status-quote.js'
import type { CaribouStatusQuote } from '../caribou-status-quote.js'

type Status = mastodon.v1.Status
type Quote = NonNullable<Status['quote']>

const ME = toUserKey('alice', 'example.social')
const bob = {
  id: '42', acct: 'bob', username: 'bob', displayName: 'Bob', avatar: '', avatarStatic: '',
  url: 'https://example.social/@bob',
}

const post = (id: string, over: Record<string, unknown> = {}) => ({
  id, content: `<p>quoted ${id}</p>`, createdAt: '2026-04-28T12:00:00Z', visibility: 'public',
  account: bob, spoilerText: '', sensitive: false, mediaAttachments: [], mentions: [], tags: [], ...over,
}) as unknown as Status

const accepted = (s: Status): Quote => ({ state: 'accepted', quotedStatus: s })

function signIn() {
  addUserSession({
    userKey: ME, server: 'example.social', token: 't', vapidKey: '', createdAt: 0,
    account: { id: 'me', acct: 'alice', username: 'alice' } as mastodon.v1.Account,
  })
}

async function mount(quote: Quote, context = 'home'): Promise<CaribouStatusQuote> {
  const el = document.createElement('caribou-status-quote') as CaribouStatusQuote
  el.instance = 'example.social'
  el.setAttribute('filter-context', context)
  el.quote = quote
  document.body.appendChild(el)
  await settle(el)
  return el
}

async function settle(el: CaribouStatusQuote) {
  for (let i = 0; i < 5; i++) await el.updateComplete
  await new Promise((r) => setTimeout(r, 0))
  await el.updateComplete
}

const $ = (el: Element, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel)
const text = (el: Element) => (el.shadowRoot!.textContent ?? '').replace(/\s+/g, ' ').trim()

beforeEach(() => {
  _testOnlyResetRelationships()
  document.body.replaceChildren()
  statusCache.value = new Map()
  relationshipCache.value = new Map()
  deletedStatusIds.value = new Set()
  postRecords.value = new Map()
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
})
afterEach(() => { vi.restoreAllMocks() })

describe('<caribou-status-quote>', () => {
  it('shows the quoted post: author, content and a link to its thread', async () => {
    const el = await mount(accepted(post('9')))
    expect($(el, '.author strong')?.textContent).toBe('Bob')
    expect($(el, '.author')?.getAttribute('href')).toBe('/@bob@example.social')
    expect($(el, '.quote-content')?.innerHTML).toContain('quoted 9')
    expect($(el, 'a.permalink')?.getAttribute('href')).toBe('/@bob/9')
  })

  it('sanitizes the quoted content on the client', async () => {
    const el = await mount(accepted(post('9', { content: '<p data-x="1" onclick="bad()">hi<img src="x" onerror="bad()"></p>' })))
    expect($(el, '.quote-content')!.innerHTML.replace(/<!--[^>]*-->/g, '')).toBe('<p>hi</p>')
  })

  it.each([
    ['pending', 'has not approved'],
    ['rejected', 'declined'],
    ['revoked', 'removed this quote'],
    ['deleted', 'was deleted'],
    ['unauthorized', 'cannot see'],
    ['blocked_account', 'you blocked its author'],
    ['blocked_domain', 'you blocked its author\'s server'],
    ['muted_account', 'you muted its author'],
  ])('a %s quote shows a short message and no post', async (state, words) => {
    const el = await mount({ state, quotedStatus: null } as unknown as Quote)
    expect($(el, '.quote-note')?.textContent).toContain(words)
    expect($(el, '.quote-content')).toBeNull()
  })

  it('an accepted quote without the post says it is not available', async () => {
    const el = await mount({ state: 'accepted', quotedStatusId: '9' } as unknown as Quote)
    expect($(el, '.quote-note')?.textContent).toContain('not available')
  })

  it('a state this build does not know says the post is not available', async () => {
    const el = await mount({ state: 'something_new', quotedStatus: null } as unknown as Quote)
    expect($(el, '.quote-note')?.textContent).toContain('not available')
  })

  it('does not nest a quote: the quoted post\'s own quote is a link to it', async () => {
    const inner = post('9', { quote: { state: 'accepted', quotedStatusId: '8' } })
    const el = await mount(accepted(inner))
    expect(el.shadowRoot!.querySelector('caribou-status-quote')).toBeNull()
    const link = $(el, 'a.nested')!
    expect(link.getAttribute('href')).toBe('/@bob/9')
    expect(link.textContent).toContain('another post')
  })

  it('keeps the body behind the quoted post\'s content warning until opened', async () => {
    const el = await mount(accepted(post('9', { spoilerText: 'Spoilers', sensitive: true })))
    expect($(el, '.spoiler')?.textContent).toBe('Spoilers')
    expect($(el, '.quote-content')).toBeNull()
    const toggle = $(el, 'button.cw-toggle')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    toggle.click()
    await settle(el)
    expect($(el, '.quote-content')?.innerHTML).toContain('quoted 9')
    expect($(el, 'button.cw-toggle')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('summarizes media and marks sensitive media, without loading it', async () => {
    const media = [
      { id: 'm1', type: 'image', url: 'https://files.example/1.png' },
      { id: 'm2', type: 'image', url: 'https://files.example/2.png' },
      { id: 'm3', type: 'video', url: 'https://files.example/3.mp4' },
    ]
    const el = await mount(accepted(post('9', { mediaAttachments: media, sensitive: true })))
    expect($(el, '.media-summary')?.textContent).toMatch(/2 images, 1 video/)
    expect($(el, '.media-summary')?.textContent).toContain('sensitive')
    expect(el.shadowRoot!.querySelector('img:not(.avatar), video')).toBeNull()
  })

  it('hides a quoted post whose author the reader mutes', async () => {
    signIn()
    relationshipCache.value = new Map([[relationshipKey(ME, '42'), { id: '42', muting: true } as mastodon.v1.Relationship]])
    const el = await mount(accepted(post('9')))
    expect($(el, '.quote-note')?.textContent).toContain('you muted @bob')
    expect($(el, '.quote-content')).toBeNull()
  })

  it('hides a quoted post whose author the reader blocks', async () => {
    signIn()
    relationshipCache.value = new Map([[relationshipKey(ME, '42'), { id: '42', blocking: true } as mastodon.v1.Relationship]])
    const el = await mount(accepted(post('9')))
    expect($(el, '.quote-note')?.textContent).toContain('you blocked @bob')
  })

  it('a hide filter hides the quoted post; a warn filter covers it with Show', async () => {
    signIn()
    const filter = (action: string, title: string) => [{
      filter: { id: 'f', title, context: ['home'], filterAction: action }, keywordMatches: [],
    }]
    const hidden = await mount(accepted(post('9', { filtered: filter('hide', 'Spoilers') })))
    expect($(hidden, '.quote-note')?.textContent).toContain('hidden by a filter')
    expect($(hidden, '.quote-content')).toBeNull()

    const warned = await mount(accepted(post('10', { filtered: filter('warn', 'Sports') })))
    expect(text(warned)).toContain('Hidden by filter: Sports')
    expect($(warned, '.quote-content')).toBeNull()
    $(warned, 'button.filter-toggle')!.click()
    await settle(warned)
    expect($(warned, '.quote-content')?.innerHTML).toContain('quoted 10')
  })

  it('takes a newer edit of the quoted post from the cache', async () => {
    signIn()
    const old = post('9')
    const el = await mount(accepted(old))
    statusCache.value = new Map([['9', { ...old, content: '<p>edited text</p>', editedAt: '2026-04-29T00:00:00Z' }]])
    await settle(el)
    expect($(el, '.quote-content')?.innerHTML).toContain('edited text')
  })

  it('says the quoted post was deleted once the reader deletes it', async () => {
    signIn()
    const el = await mount(accepted(post('9')))
    deletedStatusIds.value = new Set(['9'])
    await settle(el)
    expect($(el, '.quote-note')?.textContent).toContain('was deleted')
  })

  it('an opened content warning stays open when a new copy of the same quote arrives', async () => {
    const el = await mount(accepted(post('9', { spoilerText: 'Spoilers' })))
    $(el, 'button.cw-toggle')!.click()
    await settle(el)
    el.quote = accepted(post('9', { spoilerText: 'Spoilers' }))
    await settle(el)
    expect($(el, '.quote-content')).not.toBeNull()
    el.quote = accepted(post('10', { spoilerText: 'Other' }))
    await settle(el)
    expect($(el, '.quote-content')).toBeNull()
  })

  it('a filter Show stays open when a new copy of the same quote arrives', async () => {
    signIn()
    const filtered = [{ filter: { id: 'f', title: 'Sports', context: ['home'], filterAction: 'warn' }, keywordMatches: [] }]
    const el = await mount(accepted(post('9', { filtered })))
    $(el, 'button.filter-toggle')!.click()
    await settle(el)
    el.quote = accepted(post('9', { filtered }))
    await settle(el)
    expect($(el, '.quote-content')).not.toBeNull()
  })

  it('names the quote\'s Show more apart from the post\'s', async () => {
    const el = await mount(accepted(post('9', { spoilerText: 'Spoilers' })))
    expect($(el, 'button.cw-toggle')?.getAttribute('aria-label')).toBe('Show more of the quoted post')
  })

  it('a shallow quote that is not accepted gets no nested link', async () => {
    const el = await mount(accepted(post('9', { quote: { state: 'deleted', quotedStatusId: null } })))
    expect($(el, 'a.nested')).toBeNull()
  })

  it('says the quoted post has a poll', async () => {
    const el = await mount(accepted(post('9', { poll: { id: 'p', options: [] } })))
    expect($(el, '.media-summary')?.textContent).toContain('a poll')
  })

  it('a hashtag or mention in the quoted text opens in Caribou', async () => {
    const go = vi.spyOn(LitroRouter, 'go').mockImplementation(async () => {})
    const el = await mount(accepted(post('9', {
      content: '<p><a href="https://example.social/tags/cats" class="mention hashtag" rel="tag">#<span>cats</span></a> '
        + '<span class="h-card"><a href="https://other.example/@carol" class="u-url mention">@<span>carol</span></a></span></p>',
      tags: [{ name: 'cats' }],
      mentions: [{ id: '7', acct: 'carol@other.example', username: 'carol', url: 'https://other.example/@carol' }],
    })))
    const click = (a: Element) => a.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, button: 0, cancelable: true }))
    const [tag, mention] = [...el.shadowRoot!.querySelectorAll('.quote-content a')]
    click(tag!)
    await new Promise((r) => setTimeout(r, 10))
    expect(go).toHaveBeenLastCalledWith('/tags/cats')
    click(mention!)
    await new Promise((r) => setTimeout(r, 10))
    expect(go).toHaveBeenLastCalledWith('/@carol@other.example')
    expect(go).toHaveBeenCalledTimes(2)
  })

  it('a plain click on the card opens the thread; a click on a link in the text does not', async () => {
    const go = vi.spyOn(LitroRouter, 'go').mockImplementation(async () => {})
    const el = await mount(accepted(post('9', { content: '<p>see <a href="https://news.example/">this</a></p>' })))
    const body = $(el, '.quote')!
    body.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, button: 0 }))
    await new Promise((r) => setTimeout(r, 10))
    expect(go).toHaveBeenCalledWith('/@bob/9')
    go.mockClear()
    const a = $(el, '.quote-content a')!
    a.addEventListener('click', (e) => e.preventDefault())
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, button: 0, cancelable: true }))
    await new Promise((r) => setTimeout(r, 10))
    expect(go).not.toHaveBeenCalled()
  })
})

describe('<caribou-status-card> with a quote', () => {
  async function card(status: Status) {
    await import('../caribou-status-card.js')
    const el = document.createElement('caribou-status-card') as HTMLElement & { status: Status; updateComplete: Promise<boolean> }
    el.setAttribute('instance', 'example.social')
    el.status = status
    document.body.appendChild(el)
    while (!(await el.updateComplete)) { /* settle */ }
    return el
  }

  it('mounts the quote in the post body, with the instance of the card', async () => {
    const el = await card(post('1', {
      content: '<p>look</p><p class="quote-inline">RE: <a href="https://example.social/@bob/9">link</a></p>',
      quote: accepted(post('9')),
    }))
    const quote = el.shadowRoot!.querySelector('#status-body caribou-status-quote') as CaribouStatusQuote
    expect(quote).not.toBeNull()
    expect(quote.getAttribute('instance')).toBe('example.social')
    await settle(quote)
    expect($(quote, '.quote-content')?.innerHTML).toContain('quoted 9')
  })

  // A thread keeps its own copy of the post; the reader's copy, with the
  // reader's quote state, reaches only the cache. No relationship is known.
  it.each([
    ['muted_account', 'you muted its author'],
    ['blocked_account', 'you blocked its author'],
    ['blocked_domain', 'you blocked its author\'s server'],
    ['unauthorized', 'cannot see'],
    ['revoked', 'removed this quote'],
    ['deleted', 'was deleted'],
  ])('takes the reader\'s quote state (%s) from the cache over its own copy', async (state, words) => {
    signIn()
    const own = post('1', { quote: accepted(post('9')) })
    const el = await card(own)
    let quote = el.shadowRoot!.querySelector('caribou-status-quote') as CaribouStatusQuote
    await settle(quote)
    expect($(quote, '.quote-content')?.innerHTML).toContain('quoted 9')
    mergeStatus({ ...own, quote: { state, quotedStatus: null } } as unknown as Status)
    for (let i = 0; i < 5; i++) await el.updateComplete
    quote = el.shadowRoot!.querySelector('caribou-status-quote') as CaribouStatusQuote
    await settle(quote)
    expect($(quote, '.quote-note')?.textContent).toContain(words)
    expect($(quote, '.quote-content')).toBeNull()
  })

  it('a reader copy without `quote` (an older server) leaves the quote as it is', async () => {
    signIn()
    const own = post('1', { quote: accepted(post('9')) })
    const el = await card(own)
    const { quote: _drop, ...plain } = own as unknown as Record<string, unknown>
    mergeStatus(plain as unknown as Status)
    for (let i = 0; i < 5; i++) await el.updateComplete
    const quote = el.shadowRoot!.querySelector('caribou-status-quote') as CaribouStatusQuote
    await settle(quote)
    expect($(quote, '.quote-content')?.innerHTML).toContain('quoted 9')
  })

  // The thread's background refresh offers the server's copy (no token)
  // before it asks for the reader's again, and that ask may fail.
  it('a later copy without a token does not bring back a quote the reader may not see', async () => {
    signIn()
    const own = post('1', { quote: accepted(post('9')) })
    const el = await card(own)
    mergeStatus({ ...own, filtered: [], quote: { state: 'muted_account', quotedStatus: null } } as unknown as Status)
    mergeStatus(own)
    for (let i = 0; i < 5; i++) await el.updateComplete
    const quote = el.shadowRoot!.querySelector('caribou-status-quote') as CaribouStatusQuote
    await settle(quote)
    expect($(quote, '.quote-note')?.textContent).toContain('you muted its author')
    expect($(quote, '.quote-content')).toBeNull()
    expect(quote.shadowRoot!.querySelector('img')).toBeNull()
  })

  it('a later copy without a token does not undo a newer hide filter on the quoted post', async () => {
    signIn()
    const hide = [{ filter: { id: 'f', title: 'x', context: ['home'], filterAction: 'hide' }, keywordMatches: [] }]
    const own = post('1', { quote: accepted(post('9')) })
    mergeStatus({ ...own, filtered: [], quote: accepted(post('9', { filtered: [] })) } as unknown as Status)
    mergeStatus(post('9', { filtered: hide }))
    const el = await card(own)
    el.setAttribute('filter-context', 'home')
    mergeStatus(own)
    for (let i = 0; i < 5; i++) await el.updateComplete
    const quote = el.shadowRoot!.querySelector('caribou-status-quote') as CaribouStatusQuote
    await settle(quote)
    expect($(quote, '.quote-note')?.textContent).toContain('hidden by a filter')
    expect($(quote, '.quote-content')).toBeNull()
    expect(quote.shadowRoot!.querySelector('img')).toBeNull()
  })

  it('a second boost of a post finds the reader\'s quote inside the first boost', async () => {
    signIn()
    const inner = post('1', { quote: accepted(post('9')) })
    mergeStatus(post('b1', { reblog: { ...inner, filtered: [], quote: { state: 'muted_account', quotedStatus: null } } }))
    const b2 = post('b2', { reblog: inner })
    mergeStatus(b2)
    const el = await card(b2)
    for (let i = 0; i < 5; i++) await el.updateComplete
    const quote = el.shadowRoot!.querySelector('caribou-status-quote') as CaribouStatusQuote
    await settle(quote)
    expect($(quote, '.quote-note')?.textContent).toContain('you muted its author')
    expect(quote.shadowRoot!.querySelector('img')).toBeNull()
  })

  it('with an accepted then a muted reader copy in two boosts, a public third boost shows the note', async () => {
    signIn()
    const inner = post('1', { quote: accepted(post('9')) })
    mergeStatus(post('b1', { reblog: { ...inner, filtered: [] } }))
    mergeStatus(post('b2', { reblog: { ...inner, filtered: [], quote: { state: 'muted_account', quotedStatus: null } } }))
    const b3 = post('b3', { reblog: inner })
    mergeStatus(b3)
    const el = await card(b3)
    for (let i = 0; i < 5; i++) await el.updateComplete
    const quote = el.shadowRoot!.querySelector('caribou-status-quote') as CaribouStatusQuote
    await settle(quote)
    expect($(quote, '.quote-note')?.textContent).toContain('you muted its author')
    expect($(quote, '.quote-content')).toBeNull()
    expect(quote.shadowRoot!.querySelector('img')).toBeNull()
  })

  it('a post that quotes this one does not cut this one\'s quote short', async () => {
    signIn()
    const b = post('b', { quote: accepted(post('a')) })
    mergeStatus(b)
    const el = await card(b)
    mergeStatus(post('c', { quote: accepted({ ...b, quote: { state: 'accepted', quotedStatusId: 'a' } } as unknown as Status) }))
    for (let i = 0; i < 5; i++) await el.updateComplete
    const quote = el.shadowRoot!.querySelector('caribou-status-quote') as CaribouStatusQuote
    await settle(quote)
    expect($(quote, '.quote-content')?.innerHTML).toContain('quoted a')
  })

  it('a content warning on the quoting post hides the quote too', async () => {
    const el = await card(post('1', { spoilerText: 'cw', quote: accepted(post('9')) }))
    expect(el.shadowRoot!.querySelector('caribou-status-quote')).toBeNull()
  })

  it('a boost shows the quote of the boosted post', async () => {
    const el = await card(post('2', { reblog: post('1', { quote: accepted(post('9')) }) }))
    expect(el.shadowRoot!.querySelector('caribou-status-quote')).not.toBeNull()
  })
})
