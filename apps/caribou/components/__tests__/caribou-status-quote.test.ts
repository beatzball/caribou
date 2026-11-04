import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import { toUserKey } from '@beatzball/caribou-auth'
import { LitroRouter } from '@beatzball/litro-router'
import {
  _testOnlyResetRelationships, activeUserKey, addUserSession, deletedStatusIds, filteredById,
  relationshipCache, relationshipKey, statusCache, users,
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
  filteredById.value = new Map()
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

  it('a content warning on the quoting post hides the quote too', async () => {
    const el = await card(post('1', { spoilerText: 'cw', quote: accepted(post('9')) }))
    expect(el.shadowRoot!.querySelector('caribou-status-quote')).toBeNull()
  })

  it('a boost shows the quote of the boosted post', async () => {
    const el = await card(post('2', { reblog: post('1', { quote: accepted(post('9')) }) }))
    expect(el.shadowRoot!.querySelector('caribou-status-quote')).not.toBeNull()
  })
})
