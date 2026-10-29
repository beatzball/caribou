import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { activeUserKey } from '@beatzball/caribou-state'
import '../caribou-status-card.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'
import type { CaribouStatusMedia } from '../caribou-status-media.js'

const account = { id: '1', acct: 'alice', username: 'alice', displayName: 'Alice', avatar: '', avatarStatic: '' }
const image = { id: 'm1', type: 'image', url: 'https://files.example.social/m1.png', previewUrl: 'https://files.example.social/m1-small.png' }

// The opened warnings are kept by post id for the whole module, so each test
// uses ids of its own.
const post = (id: string, over: Record<string, unknown> = {}) => ({
  id, content: '<p>the butler did it</p>', createdAt: '2026-04-28T12:00:00Z', account,
  spoilerText: '', ...over,
})

async function mount(status: unknown, instance = ''): Promise<CaribouStatusCard> {
  const el = document.createElement('caribou-status-card') as CaribouStatusCard
  if (instance) el.instance = instance
  el.status = status as CaribouStatusCard['status']
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const $ = (el: Element, sel: string) => el.shadowRoot!.querySelector(sel)
const toggle = (el: Element) => $(el, 'button.cw-toggle') as HTMLButtonElement

async function click(el: CaribouStatusCard) {
  toggle(el).click()
  await el.updateComplete
}

describe('<caribou-status-card> content warning', () => {
  beforeEach(() => { document.body.replaceChildren() })
  afterEach(() => { activeUserKey.value = null })

  it('a post without a warning shows its text and no toggle', async () => {
    const el = await mount(post('n1'))
    expect($(el, '.warning')).toBeNull()
    expect($(el, '#status-body')!.hasAttribute('hidden')).toBe(false)
    expect($(el, '.status-content')!.textContent).toBe('the butler did it')
  })

  it('collapsed: the warning as text, a Show more button, and an empty hidden region', async () => {
    const el = await mount(post('c1', { spoilerText: 'Spoilers & <b>plot</b>', sensitive: true, mediaAttachments: [image] }))
    const spoiler = $(el, '.spoiler')!
    expect(spoiler.textContent).toBe('Spoilers & <b>plot</b>')
    expect(spoiler.querySelector('b')).toBeNull()
    const b = toggle(el)
    expect(b.textContent).toBe('Show more')
    expect(b.getAttribute('aria-expanded')).toBe('false')
    const region = $(el, '#status-body')!
    expect(b.getAttribute('aria-controls')).toBe(region.id)
    expect(region.hasAttribute('hidden')).toBe(true)
    expect($(el, '.status-content')).toBeNull()
    expect($(el, 'caribou-status-media')).toBeNull()
  })

  // The button is the same node in both states, so focus stays on it (the
  // e2e spec checks focus itself).
  it('Show more shows the text and the media, and Show less hides them again, on the same button', async () => {
    const el = await mount(post('c2', { spoilerText: 'cw', sensitive: true, mediaAttachments: [image] }))
    const b = toggle(el)
    await click(el)
    expect(toggle(el)).toBe(b)
    expect(b.textContent).toBe('Show less')
    expect(b.getAttribute('aria-expanded')).toBe('true')
    expect($(el, '#status-body')!.hasAttribute('hidden')).toBe(false)
    expect($(el, '.status-content')!.textContent).toBe('the butler did it')

    // The reveal opens the sensitive-media gate too; the media keeps its own
    // Hide button.
    const media = $(el, 'caribou-status-media') as CaribouStatusMedia
    await media.updateComplete
    expect(media.sensitive).toBe(true)
    expect(media.revealed).toBe(true)
    expect(media.shadowRoot!.querySelector('img')).not.toBeNull()
    ;(media.shadowRoot!.querySelector('button.hide') as HTMLButtonElement).click()
    await media.updateComplete
    expect(media.shadowRoot!.querySelector('img')).toBeNull()

    await click(el)
    expect(toggle(el)).toBe(b)
    expect(b.textContent).toBe('Show more')
    expect(b.getAttribute('aria-expanded')).toBe('false')
    expect($(el, '.status-content')).toBeNull()
    expect($(el, 'caribou-status-media')).toBeNull()
  })

  it('a link card stays out of the collapsed region and shows after Show more', async () => {
    const link = { url: 'https://news.example/story', title: 'A story', image: 'https://files.example.social/card.png', width: 1200, height: 600 }
    const el = await mount(post('l1', { spoilerText: 'cw', card: link }))
    expect($(el, 'caribou-status-link-card')).toBeNull()
    await click(el)
    expect($(el, '#status-body caribou-status-link-card')).not.toBeNull()
  })

  it('a sensitive post with no warning keeps its media gate closed', async () => {
    const el = await mount(post('s1', { sensitive: true, mediaAttachments: [image] }))
    const media = $(el, 'caribou-status-media') as CaribouStatusMedia
    await media.updateComplete
    expect(media.revealed).toBe(false)
    expect(media.shadowRoot!.querySelector('img')).toBeNull()
  })

  it('a boost uses the warning of the boosted post', async () => {
    const el = await mount(post('w1', {
      content: '', spoilerText: '',
      account: { ...account, id: '2', acct: 'bob', username: 'bob', displayName: 'Bob' },
      reblog: post('b1', { spoilerText: 'boosted cw' }),
    }))
    expect($(el, '.spoiler')!.textContent).toBe('boosted cw')
    expect($(el, '.status-content')).toBeNull()
  })

  it('an opened warning stays open in a new card for the same post, and not for another post', async () => {
    const first = await mount(post('k1', { spoilerText: 'cw' }))
    await click(first)
    first.remove()
    // The page cache paints a page again with new cards.
    const again = await mount(post('k1', { spoilerText: 'cw' }))
    expect(toggle(again).getAttribute('aria-expanded')).toBe('true')
    expect($(again, '.status-content')).not.toBeNull()

    again.status = post('k2', { spoilerText: 'cw' }) as CaribouStatusCard['status']
    await again.updateComplete
    expect(toggle(again).getAttribute('aria-expanded')).toBe('false')
    expect($(again, '.status-content')).toBeNull()
  })

  // Status ids are minted per instance: two instances can each have a post 7.
  it('an opened warning does not open a post with the same id from another instance', async () => {
    const first = await mount(post('7', { spoilerText: 'cw' }), 'one.example')
    await click(first)
    first.remove()
    const other = await mount(post('7', { spoilerText: 'cw', content: '<p>a different post</p>' }), 'two.example')
    expect(toggle(other).getAttribute('aria-expanded')).toBe('false')
    expect($(other, '.status-content')).toBeNull()
    other.remove()
    // Host case does not matter.
    const same = await mount(post('7', { spoilerText: 'cw' }), 'ONE.example')
    expect(toggle(same).getAttribute('aria-expanded')).toBe('true')
  })

  it('an account change forgets every opened warning', async () => {
    const first = await mount(post('g1', { spoilerText: 'cw' }), 'one.example')
    await click(first)
    first.remove()
    activeUserKey.value = 'bob@one.example' as typeof activeUserKey.value
    const again = await mount(post('g1', { spoilerText: 'cw' }), 'one.example')
    expect(toggle(again).getAttribute('aria-expanded')).toBe('false')
  })
})
