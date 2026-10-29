import { beforeEach, describe, expect, it } from 'vitest'
import '../caribou-status-card.js'
import '../caribou-status-link-card.js'
import { cardAspect, cardLayout, type CaribouStatusLinkCard, type LinkCard } from '../caribou-status-link-card.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'

function linkCard(over: Partial<LinkCard> = {}): LinkCard {
  return {
    url: 'https://news.example/story', title: 'A story', description: 'What happened today.',
    type: 'link', blurhash: '', authors: [], embedUrl: '',
    providerName: 'Example News', authorName: null,
    image: 'https://files.example.social/card.png', imageDescription: null,
    width: 1200, height: 600, html: null,
    ...over,
  } as LinkCard
}

async function mount(card: LinkCard | null): Promise<CaribouStatusLinkCard> {
  const el = document.createElement('caribou-status-link-card')
  el.card = card
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const $ = (el: Element, sel: string) => el.shadowRoot!.querySelector(sel)
const $$ = (el: Element, sel: string) => [...el.shadowRoot!.querySelectorAll(sel)]

describe('<caribou-status-link-card>', () => {
  beforeEach(() => { document.body.replaceChildren() })

  it('a wide image goes on top, full width, in a box sized from width/height', async () => {
    const el = await mount(linkCard())
    const a = $(el, 'a')!
    expect(a.getAttribute('data-layout')).toBe('large')
    expect(($(el, '.image') as HTMLElement).style.getPropertyValue('--ar').trim()).toBe('2')
    const img = $(el, 'img')!
    expect(img.getAttribute('src')).toBe('https://files.example.social/card.png')
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.getAttribute('alt')).toBe('')
  })

  it('is one link to the card URL in a new tab, named by the title', async () => {
    const el = await mount(linkCard({ imageDescription: 'A chart' }))
    const links = $$(el, 'a')
    expect(links).toHaveLength(1)
    const a = links[0]!
    expect(a.getAttribute('href')).toBe('https://news.example/story')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    expect($(el, '#' + a.getAttribute('aria-labelledby'))!.textContent).toBe('A story')
    expect($(el, 'img')!.getAttribute('alt')).toBe('A chart')
    expect($(el, '.description')!.textContent).toBe('What happened today.')
    expect($(el, '.byline')!.textContent).toBe('Example News')
  })

  it('a small image, or a photo or rich card, is a compact row', async () => {
    for (const card of [linkCard({ width: 200, height: 200 }), linkCard({ type: 'photo' }), linkCard({ type: 'rich' })]) {
      document.body.replaceChildren()
      const el = await mount(card)
      expect($(el, 'a')!.getAttribute('data-layout')).toBe('compact')
      expect($(el, 'img')).not.toBeNull()
    }
  })

  it('with no image, only the text', async () => {
    const el = await mount(linkCard({ image: null }))
    expect($(el, 'a')!.getAttribute('data-layout')).toBe('text')
    expect($(el, 'img')).toBeNull()
    expect($(el, '.title')!.textContent).toBe('A story')
  })

  it('renders every string as text and never the embed html', async () => {
    const el = await mount(linkCard({
      type: 'video', title: '<b>bold</b>', description: '<img src=x onerror=alert(1)>',
      html: '<iframe src="https://video.example/embed"></iframe>',
    }))
    expect($(el, '.title')!.textContent).toBe('<b>bold</b>')
    expect($(el, 'b')).toBeNull()
    expect($(el, 'iframe')).toBeNull()
    expect($$(el, 'img')).toHaveLength(1)
  })

  it('drops an image URL that is not http(s), and the card when its link is not', async () => {
    const el = await mount(linkCard({ image: 'javascript:alert(1)' }))
    expect($(el, 'a')!.getAttribute('data-layout')).toBe('text')
    expect($(el, 'img')).toBeNull()
    document.body.replaceChildren()
    const bad = await mount(linkCard({ url: 'javascript:alert(1)' }))
    expect($(bad, 'a')).toBeNull()
  })

  it('shows nothing with no card or no title', async () => {
    expect($(await mount(null), 'a')).toBeNull()
    expect($(await mount(linkCard({ title: '' })), 'a')).toBeNull()
  })

  it('names the host when the card names no site, and adds the author', async () => {
    const el = await mount(linkCard({ url: 'https://www.blog.example/p', providerName: '', authorName: 'Alice' }))
    expect($(el, '.byline')!.textContent).toBe('blog.example · Alice')
  })

  it('layout and aspect helpers', () => {
    expect(cardLayout(linkCard({ width: 400 }))).toBe('large')
    expect(cardLayout(linkCard({ width: 399 }))).toBe('compact')
    expect(cardAspect(linkCard({ width: null, height: null }))).toBeCloseTo(1200 / 630)
  })
})

describe('<caribou-status-card> link card', () => {
  beforeEach(() => { document.body.replaceChildren() })

  const account = { id: '1', acct: 'alice', username: 'alice', displayName: 'Alice', avatar: '', avatarStatic: '' }
  const post = (over: Record<string, unknown> = {}) => ({
    id: '1', content: '<p>x</p>', createdAt: '2026-04-28T12:00:00Z', account, mediaAttachments: [], card: linkCard(), ...over,
  })

  async function statusCard(status: unknown): Promise<CaribouStatusCard> {
    const el = document.createElement('caribou-status-card') as CaribouStatusCard
    el.status = status as CaribouStatusCard['status']
    document.body.appendChild(el)
    await el.updateComplete
    return el
  }

  it('passes the card under the content', async () => {
    const el = await statusCard(post())
    const c = $(el, '.status-content + caribou-status-link-card') as CaribouStatusLinkCard
    expect(c.card?.title).toBe('A story')
  })

  it('shows no card when the post has media, or no card', async () => {
    const media = [{ id: 'm', type: 'image', previewUrl: 'https://files.example.social/m.png', meta: {} }]
    expect($(await statusCard(post({ mediaAttachments: media })), 'caribou-status-link-card')).toBeNull()
    expect($(await statusCard(post({ card: null })), 'caribou-status-link-card')).toBeNull()
  })

  it('a boost shows the boosted post card', async () => {
    const el = await statusCard(post({ card: null, reblog: post({ id: 'i' }) }))
    expect(($(el, 'caribou-status-link-card') as CaribouStatusLinkCard).card?.title).toBe('A story')
  })
})
