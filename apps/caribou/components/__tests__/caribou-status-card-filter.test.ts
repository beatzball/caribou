import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { mastodon } from 'masto'
import { activeUserKey, cacheStatus, mergeStatus, statusCache, users } from '@beatzball/caribou-state'
import '../caribou-status-card.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'

type Status = mastodon.v1.Status

const account = { id: '1', acct: 'alice', username: 'alice', displayName: 'Alice', avatar: '', avatarStatic: '' }

function match(title: string, action: 'warn' | 'hide', context = ['home', 'public', 'thread', 'notifications', 'account']) {
  return { filter: { id: title, title, context, filterAction: action, keywords: [], statuses: [] }, keywordMatches: ['x'], statusMatches: null }
}

// The shown filtered posts are kept by post id for the whole module, so
// each test uses ids of its own.
const post = (id: string, over: Record<string, unknown> = {}) => ({
  id, content: '<p>the butler did it</p>', createdAt: '2026-04-28T12:00:00Z', account,
  spoilerText: '', ...over,
}) as unknown as Status

async function mount(status: Status, context: string, variant = 'timeline'): Promise<CaribouStatusCard> {
  const el = document.createElement('caribou-status-card') as CaribouStatusCard
  el.setAttribute('filter-context', context)
  el.variant = variant as CaribouStatusCard['variant']
  el.status = status
  document.body.appendChild(el)
  while (!(await el.updateComplete)) { /* settle the post-mount render */ }
  return el
}

const $ = (el: Element, sel: string) => el.shadowRoot!.querySelector(sel)

describe('<caribou-status-card> server filters', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    statusCache.value = new Map()
    users.value = new Map()
  })
  afterEach(() => { activeUserKey.value = null })

  it('a post without `filtered` renders as before', async () => {
    const el = await mount(post('p1'), 'home')
    expect(el.hasAttribute('hidden')).toBe(false)
    expect($(el, '.notice')).toBeNull()
    expect($(el, '.status-content')!.textContent).toBe('the butler did it')
  })

  it('hide: the card renders nothing and hides its host', async () => {
    const el = await mount(post('h1', { filtered: [match('Spoilers', 'hide')] }), 'home')
    expect(el.hasAttribute('hidden')).toBe(true)
    expect($(el, 'article')).toBeNull()
  })

  it('hide on the post the reader opened in a thread warns instead', async () => {
    const el = await mount(post('h2', { filtered: [match('Spoilers', 'hide')] }), 'thread', 'focused')
    expect(el.hasAttribute('hidden')).toBe(false)
    expect($(el, '.notice p')!.textContent).toBe('Hidden by filter: Spoilers')
  })

  it('warn: the filter name and a Show button, and nothing of the post', async () => {
    const el = await mount(post('w1', { filtered: [match('Spoilers', 'warn'), match('Sports', 'warn')] }), 'home')
    expect(el.hasAttribute('hidden')).toBe(false)
    expect($(el, '.notice p')!.textContent).toBe('Hidden by filter: Spoilers, Sports')
    const b = $(el, 'button.filter-toggle') as HTMLButtonElement
    expect(b.textContent).toBe('Show')
    // Named with its post, so a list of buttons is not a list of "Show".
    expect(b.getAttribute('aria-label')).toBe('Show post hidden by filter: Spoilers, Sports')
    expect(b.getAttribute('aria-expanded')).toBe('false')
    const region = $(el, '#filtered-post')!
    expect(b.getAttribute('aria-controls')).toBe(region.id)
    expect(region.hasAttribute('hidden')).toBe(true)
    expect($(el, '.status-content')).toBeNull()
    expect($(el, '.author')).toBeNull()
  })

  it('Show reveals the post on the same button, and Hide covers it again', async () => {
    const el = await mount(post('w2', { filtered: [match('Spoilers', 'warn')] }), 'home')
    const b = $(el, 'button.filter-toggle') as HTMLButtonElement
    b.focus()
    b.click()
    await el.updateComplete
    expect($(el, 'button.filter-toggle')).toBe(b)
    expect(b.textContent).toBe('Hide')
    expect(b.getAttribute('aria-expanded')).toBe('true')
    expect($(el, '#filtered-post')!.hasAttribute('hidden')).toBe(false)
    expect($(el, '.status-content')!.textContent).toBe('the butler did it')
    expect(el.shadowRoot!.activeElement).toBe(b)
    b.click()
    await el.updateComplete
    expect($(el, '.status-content')).toBeNull()
  })

  it('a shown post stays shown when its card is made again', async () => {
    const first = await mount(post('w3', { filtered: [match('Spoilers', 'warn')] }), 'home')
    ;($(first, 'button.filter-toggle') as HTMLButtonElement).click()
    await first.updateComplete
    first.remove()
    const again = await mount(post('w3', { filtered: [match('Spoilers', 'warn')] }), 'home')
    expect($(again, '.status-content')).not.toBeNull()
  })

  it('a filter for another context does nothing', async () => {
    const el = await mount(post('c1', { filtered: [match('Spoilers', 'hide', ['home'])] }), 'public')
    expect(el.hasAttribute('hidden')).toBe(false)
    expect($(el, '.notice')).toBeNull()
  })

  it('no context (bookmarks) never filters', async () => {
    const el = await mount(post('c2', { filtered: [match('Spoilers', 'hide')] }), '')
    expect(el.hasAttribute('hidden')).toBe(false)
  })

  it('a filter on the boosted post applies to the boost', async () => {
    const boost = post('b1', { reblog: post('b2', { filtered: [match('Spoilers', 'warn')] }) })
    const el = await mount(boost, 'home')
    expect($(el, '.notice p')!.textContent).toBe('Hidden by filter: Spoilers')
    expect($(el, '.boost-attribution')).toBeNull()
  })

  it('follows the cached copy: a filter that arrives later hides the post', async () => {
    const plain = post('l1')
    cacheStatus(plain)
    const el = await mount(plain, 'home')
    expect(el.hasAttribute('hidden')).toBe(false)
    cacheStatus(post('l1', { filtered: [match('Spoilers', 'hide')] }))
    await el.updateComplete
    expect(el.hasAttribute('hidden')).toBe(true)
  })

  it('a boost follows the newest cached copy of the post it boosts', async () => {
    const boost = post('bb1', { reblog: post('bb2', { filtered: [] }), filtered: [] })
    cacheStatus(boost)
    const el = await mount(boost, 'home')
    expect(el.hasAttribute('hidden')).toBe(false)
    // The boosted post is fetched again elsewhere (its thread), and a new
    // hide filter matches it there.
    mergeStatus(post('bb2', { filtered: [match('Spoilers', 'hide')] }))
    await el.updateComplete
    expect(el.hasAttribute('hidden')).toBe(true)
  })
})
