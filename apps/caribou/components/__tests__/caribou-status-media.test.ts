import { beforeEach, describe, expect, it } from 'vitest'
import type { CSSResult } from 'lit'
import '../caribou-status-card.js'
import '../caribou-status-media.js'
import { CaribouStatusMedia, aspectOf } from '../caribou-status-media.js'
import { httpUrl } from '../_http-url.js'
import { DIM, dimOf } from '../_media-dim.js'
import { chromeDim } from '../_theme.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'

type Media = CaribouStatusMedia['media'][number]

function media(id: string, over: Partial<Media> = {}): Media {
  return {
    id, type: 'image',
    url: `https://files.example.social/${id}.png`,
    previewUrl: `https://files.example.social/${id}-small.png`,
    meta: { small: { width: 400, height: 300, size: '400x300', aspect: 4 / 3 } },
    description: null,
    ...over,
  } as Media
}

async function mount(items: Media[], sensitive = false): Promise<CaribouStatusMedia> {
  const el = document.createElement('caribou-status-media')
  el.media = items
  el.sensitive = sensitive
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const $ = (el: Element, sel: string) => el.shadowRoot!.querySelector(sel)
const $$ = (el: Element, sel: string) => [...el.shadowRoot!.querySelectorAll(sel)]

describe('<caribou-status-media>', () => {
  beforeEach(() => { document.body.replaceChildren() })

  it('renders nothing with no media', async () => {
    const el = await mount([])
    expect($(el, '.grid')).toBeNull()
  })

  it.each([1, 2, 3, 4])('lays out %i item(s) in one grid', async (n) => {
    const el = await mount(Array.from({ length: n }, (_, i) => media(String(i))))
    expect($(el, '.grid')!.getAttribute('data-count')).toBe(String(n))
    expect($$(el, '.item')).toHaveLength(n)
  })

  it('shows at most four items', async () => {
    const el = await mount(Array.from({ length: 6 }, (_, i) => media(String(i))))
    expect($$(el, '.item')).toHaveLength(4)
  })

  it('reserves each box with the aspect ratio from meta', async () => {
    const el = await mount([media('a')])
    expect(($(el, '.item') as HTMLElement).style.getPropertyValue('--ar').trim()).toBe(String(4 / 3))
  })

  it('an image is a link to the full file around a lazy preview', async () => {
    const el = await mount([media('a', { description: 'A red fox' })])
    const a = $(el, 'a.thumb')!
    expect(a.getAttribute('href')).toBe('https://files.example.social/a.png')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('aria-label')).toBe('Open image: A red fox')
    const img = $(el, 'img')!
    expect(img.getAttribute('src')).toBe('https://files.example.social/a-small.png')
    expect(img.getAttribute('alt')).toBe('A red fox')
    expect(img.getAttribute('loading')).toBe('lazy')
  })

  it('an image with no description has an empty alt and no ALT badge', async () => {
    const el = await mount([media('a')])
    expect($(el, 'img')!.getAttribute('alt')).toBe('')
    expect($(el, 'button.alt')).toBeNull()
    expect($(el, '[popover]')).toBeNull()
  })

  it('the ALT badge is a button that opens a popover with the description', async () => {
    const el = await mount([media('a'), media('b', { description: 'Second <b>pic</b>' })])
    const badges = $$(el, 'button.alt')
    expect(badges).toHaveLength(1)
    expect(badges[0]!.textContent).toBe('ALT')
    const target = badges[0]!.getAttribute('popovertarget')!
    const pop = el.shadowRoot!.getElementById(target)!
    expect(pop.hasAttribute('popover')).toBe(true)
    // Text, never markup.
    expect(pop.textContent).toBe('Second <b>pic</b>')
    expect(pop.querySelector('b')).toBeNull()
  })

  it('a video has controls, the preview as poster, and does not preload', async () => {
    const el = await mount([media('v', { type: 'video', url: 'https://files.example.social/v.mp4' })])
    const v = $(el, 'video')!
    expect(v.getAttribute('src')).toBe('https://files.example.social/v.mp4')
    expect(v.getAttribute('poster')).toBe('https://files.example.social/v-small.png')
    expect(v.hasAttribute('controls')).toBe(true)
    expect(v.getAttribute('preload')).toBe('none')
  })

  it('a gifv is a muted loop inside a play/pause toggle button', async () => {
    const el = await mount([media('g', { type: 'gifv', url: 'https://files.example.social/g.mp4', description: 'A cat' })])
    const v = $(el, 'video.gifv')!
    expect(v.hasAttribute('muted')).toBe(true)
    expect(v.hasAttribute('loop')).toBe(true)
    expect(v.hasAttribute('controls')).toBe(false)
    expect(v.getAttribute('poster')).toBe('https://files.example.social/g-small.png')
    const toggle = $(el, 'button.gifv-toggle') as HTMLButtonElement
    expect(toggle.contains(v)).toBe(true)
    expect(toggle.getAttribute('aria-label')).toBe('Play GIF: A cat')
    // No reduced-motion preference here: it plays after mount.
    await el.updateComplete
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect($(el, '.gif-badge')).toBeNull()
    toggle.click()
    await el.updateComplete
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect($(el, '.gif-badge')!.textContent).toContain('GIF')
    toggle.click()
    await el.updateComplete
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps following the motion setting after a move in the DOM', async () => {
    const queries: Array<{ matches: boolean; fire: () => void }> = []
    const real = window.matchMedia
    let reduce = false
    window.matchMedia = ((q: string) => {
      const listeners: Array<() => void> = []
      const mq = {
        media: q, get matches() { return reduce },
        addEventListener: (_: string, f: () => void) => { listeners.push(f) },
        removeEventListener: (_: string, f: () => void) => { listeners.splice(listeners.indexOf(f), 1) },
        fire: () => { for (const f of [...listeners]) f() },
      }
      queries.push(mq)
      return mq
    }) as unknown as typeof window.matchMedia
    try {
      const el = await mount([media('g', { type: 'gifv' })])
      await el.updateComplete
      const pressed = () => $(el, 'button.gifv-toggle')!.getAttribute('aria-pressed')
      expect(pressed()).toBe('true')
      el.remove()
      document.body.appendChild(el)
      reduce = true
      queries.at(-1)!.fire()
      await el.updateComplete
      expect(pressed()).toBe('false')
    } finally {
      window.matchMedia = real
    }
  })

  it('audio has controls', async () => {
    const el = await mount([media('s', { type: 'audio', url: 'https://files.example.social/s.mp3' })])
    const a = $(el, 'audio')!
    expect(a.getAttribute('src')).toBe('https://files.example.social/s.mp3')
    expect(a.hasAttribute('controls')).toBe(true)
  })

  it('an unknown type is a link to the remote file', async () => {
    const el = await mount([media('u', { type: 'unknown', url: null, remoteUrl: 'https://remote.example/u.bin' })])
    const a = $(el, 'a.file')!
    expect(a.getAttribute('href')).toBe('https://remote.example/u.bin')
    expect(a.textContent!.trim()).toBe('Open attachment')
  })

  it('drops URLs that are not http(s)', async () => {
    const el = await mount([media('x', { url: 'javascript:alert(1)', previewUrl: 'data:image/png;base64,AAAA' })])
    expect($(el, 'a.thumb')!.hasAttribute('href')).toBe(false)
    expect($(el, 'img')!.hasAttribute('src')).toBe(false)
  })

  it('sensitive media is hidden behind a button until revealed, then a Hide button hides it', async () => {
    const el = await mount([media('a'), media('b')], true)
    expect($$(el, '.item')).toHaveLength(2)
    expect($(el, 'img')).toBeNull()
    const reveal = $(el, 'caribou-button.reveal') as HTMLElement
    expect(reveal.textContent).toBe('Show sensitive media')
    reveal.click()
    await el.updateComplete
    expect($$(el, 'img')).toHaveLength(2)
    expect($(el, 'caribou-button.reveal')).toBeNull()
    ;($(el, 'caribou-button.hide') as HTMLElement).click()
    await el.updateComplete
    expect($(el, 'img')).toBeNull()
    expect($(el, 'caribou-button.reveal')).not.toBeNull()
  })

  it('no-override: sensitive media stays hidden with no Show button, even when revealed', async () => {
    const el = document.createElement('caribou-status-media')
    el.media = [media('a')]
    el.sensitive = true
    el.noOverride = true
    el.revealed = true
    document.body.appendChild(el)
    await el.updateComplete
    expect($(el, 'img')).toBeNull()
    expect($(el, 'caribou-button')).toBeNull()
    expect($(el, 'button')).toBeNull()
    expect($(el, '.locked')!.textContent!.trim()).toBe('Media hidden by a content label')
    // The box keeps its size.
    expect($$(el, '.item')).toHaveLength(1)
  })

  it('no-override reflects from the attribute and does nothing without sensitive', async () => {
    document.body.innerHTML = '<caribou-status-media no-override></caribou-status-media>'
    const el = document.querySelector('caribou-status-media')!
    expect(el.noOverride).toBe(true)
    el.media = [media('a')]
    await el.updateComplete
    expect($(el, 'img')).not.toBeNull()
    expect($(el, '.locked')).toBeNull()
  })

  it('aspectOf falls back from small to original to 16:9', () => {
    expect(aspectOf(media('a', { meta: { original: { width: 100, height: 200, size: '', aspect: 0 } } }))).toBe(0.5)
    expect(aspectOf(media('a', { meta: null }))).toBe(16 / 9)
  })

  it('httpUrl keeps only http and https', () => {
    expect(httpUrl('https://a.example/x')).toBe('https://a.example/x')
    expect(httpUrl('http://a.example/x')).toBe('http://a.example/x')
    expect(httpUrl('javascript:void 0')).toBeUndefined()
    expect(httpUrl('not a url')).toBeUndefined()
    expect(httpUrl(null)).toBeUndefined()
  })

  // No browser in the e2e runs lacks backdrop-filter, and only Chromium can
  // emulate reduced transparency, so the two fallbacks are checked here.
  const cssText = (CaribouStatusMedia.styles as CSSResult[]).map((s) => s.cssText).join('\n')
  // The rule or block that starts at `head` (from `from` on), on one line.
  const block = (head: string, from = 0) => {
    const start = cssText.indexOf(head, from)
    expect(start, head).toBeGreaterThanOrEqual(0)
    let depth = 0
    for (let i = cssText.indexOf('{', start); i < cssText.length; i++) {
      if (cssText[i] === '{') depth++
      else if (cssText[i] === '}' && --depth === 0) return cssText.slice(start, i + 1).replace(/\s+/g, ' ')
    }
    throw new Error(`unclosed ${head}`)
  }
  // The viewer's own `dialog { … }` rule.
  const dialogRule = () => block('dialog {', cssText.indexOf('dialog {'))

  it('the viewer falls back to an 85% backdrop and solid surfaces with reduced transparency, and to a darker tint without blur', () => {
    const reduced = block('@media (prefers-reduced-transparency: reduce)')
    expect(reduced).toMatch(/dialog::backdrop \{ background: rgb\(0 0 0 \/ 0\.85\); -webkit-backdrop-filter: none; backdrop-filter: none; \}/)
    expect(reduced).toMatch(/dialog :is\(\.hint, p\) \{ background: var\(--overlay-bg\); \}/)
    expect(reduced).toMatch(/caribou-button\.close \{ --caribou-button-bg: var\(--overlay-bg\); \}/)
    const noBlur = block('@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))')
    expect(noBlur).toMatch(/dialog::backdrop \{ background: rgb\(0 0 0 \/ 0\.8\); \}/)
    expect(noBlur).toMatch(/dialog :is\(\.hint, p\) \{ background: rgb\(0 0 0 \/ 0\.8\); \}/)
  })

  // The backdrop, the edge strips and the theme-color show one dim. In each
  // case the backdrop's alpha and the dialog's --dim (which the strips and
  // the theme-color read) come from the same row of DIM.
  it('each case sets the backdrop alpha and --dim from the same row of DIM', () => {
    expect(DIM).toEqual({ blur: 55, solid: 80, reduced: 85 })
    const cases: Array<[string, number]> = [
      ['@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))', DIM.solid],
      ['@media (prefers-reduced-transparency: reduce)', DIM.reduced],
    ]
    expect(dialogRule()).toContain(`--dim: ${DIM.blur}%;`)
    expect(block('dialog::backdrop {')).toContain(`background: rgb(0 0 0 / ${DIM.blur / 100});`)
    for (const [head, pct] of cases) {
      const b = block(head)
      expect(b, head).toContain(`dialog { --dim: ${pct}%; }`)
      expect(b, head).toContain(`dialog::backdrop { background: rgb(0 0 0 / ${pct / 100});`)
    }
    // Reduced transparency comes last, so it wins when both apply, for the
    // backdrop and --dim alike.
    expect(cssText.indexOf(cases[1]![0])).toBeGreaterThan(cssText.indexOf(cases[0]![0]))
    // The strips are the dim over the page color.
    expect(dialogRule()).toContain('--dim-page: color-mix(in srgb, black var(--dim), var(--bg-0));')
  })

  // Close, the hint and the description stay out of the notch and the home
  // indicator on all four sides, in portrait and landscape.
  it('the viewer fills the window and pads each side by the safe area or 2.5%, whichever is more', () => {
    const rule = dialogRule()
    expect(rule).toContain('inset: 0; margin: 0;')
    expect(rule).toContain('max-width: none; max-height: none;')
    for (const [side, unit] of [['top', 'dvh'], ['right', 'vw'], ['bottom', 'dvh'], ['left', 'vw']]) {
      expect(rule, side).toContain(`calc(max(2.5${unit}, env(safe-area-inset-${side}, 0px)) + var(--space-3))`)
    }
  })

  it('the edge strips are fixed, full width, the opaque dim, under the content, take no clicks, and only on touch screens', () => {
    const coarse = block('@media (pointer: coarse)', cssText.indexOf('dialog .edge {'))
    expect(coarse).toContain('dialog .edge { display: block; position: fixed; inset-inline: 0; z-index: -1; block-size: 12px; pointer-events: none; background-color: var(--dim-page); }')
    expect(coarse).toContain('dialog .edge.top { inset-block-start: 0; }')
    expect(coarse).toContain('dialog .edge.bottom { inset-block-end: 0; }')
    expect(cssText).toMatch(/dialog \.edge \{ display: none; \}\s*@media \(pointer: coarse\)/)
  })
})

describe('<caribou-status-media> viewer and the browser bars', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    chromeDim.value = null
  })

  async function openViewer(el: CaribouStatusMedia) {
    ;($(el, 'a.thumb') as HTMLElement).click()
    while (!(await el.updateComplete)) { /* render again */ }
    await new Promise((r) => setTimeout(r, 0))
    return $(el, 'dialog') as HTMLDialogElement
  }

  it('dims the bars while open, with the dim the dialog shows, and undims on close', async () => {
    const el = await mount([media('a', { description: 'A red fox' })])
    expect($$(el, '.edge')).toHaveLength(0)
    const dialog = await openViewer(el)
    expect(dialog.open).toBe(true)
    expect(chromeDim.value).toBe(dimOf(dialog))
    const edges = $$(el, 'dialog > .edge')
    expect(edges.map((e) => e.className)).toEqual(['edge top', 'edge bottom'])
    for (const e of edges) expect(e.getAttribute('aria-hidden')).toBe('true')

    dialog.close()
    dialog.dispatchEvent(new Event('close'))
    expect(chromeDim.value).toBeNull()
    await el.updateComplete
    expect($$(el, '.edge')).toHaveLength(0)
  })

  it('a viewer taken out of the page while open undims the bars', async () => {
    const el = await mount([media('a')])
    await openViewer(el)
    expect(chromeDim.value).not.toBeNull()
    document.body.replaceChildren()
    expect(chromeDim.value).toBeNull()
  })

  it('a close event that comes after the viewer opened again keeps the dim', async () => {
    const el = await mount([media('a')])
    const dialog = await openViewer(el)
    dialog.close()
    const again = await openViewer(el)
    expect(again.open).toBe(true)
    dialog.dispatchEvent(new Event('close'))
    expect(chromeDim.value).toBe(dimOf(again))
  })

  it('dimOf reads --dim, and falls back to the blur row', () => {
    const d = document.createElement('div')
    document.body.append(d)
    expect(dimOf(d)).toBe(DIM.blur / 100)
    d.style.setProperty('--dim', '85%')
    expect(dimOf(d)).toBe(0.85)
    d.style.setProperty('--dim', 'bogus')
    expect(dimOf(d)).toBe(DIM.blur / 100)
    d.style.setProperty('--dim', '150%')
    expect(dimOf(d)).toBe(DIM.blur / 100)
  })
})

describe('<caribou-status-card> media', () => {
  beforeEach(() => { document.body.replaceChildren() })

  const account = { id: '1', acct: 'alice', username: 'alice', displayName: 'Alice', avatar: '', avatarStatic: '' }

  async function card(status: unknown): Promise<CaribouStatusCard> {
    const el = document.createElement('caribou-status-card') as CaribouStatusCard
    el.status = status as CaribouStatusCard['status']
    document.body.appendChild(el)
    await el.updateComplete
    return el
  }

  it('shows no media element for a post without media', async () => {
    const el = await card({ id: '1', content: '<p>x</p>', createdAt: '2026-04-28T12:00:00Z', account, mediaAttachments: [] })
    expect($(el, 'caribou-status-media')).toBeNull()
  })

  it('passes the post media and sensitive flag under the content', async () => {
    const el = await card({
      id: '1', content: '<p>x</p>', createdAt: '2026-04-28T12:00:00Z', account,
      sensitive: true, mediaAttachments: [media('a')],
    })
    const m = $(el, '.status-content + caribou-status-media') as CaribouStatusMedia
    expect(m).not.toBeNull()
    expect(m.media).toHaveLength(1)
    expect(m.sensitive).toBe(true)
  })

  it('a boost shows the boosted post media', async () => {
    const el = await card({
      id: 'w', content: '', createdAt: '2026-04-28T12:00:00Z', account, mediaAttachments: [],
      reblog: { id: 'i', content: '<p>x</p>', createdAt: '2026-04-28T12:00:00Z', account, mediaAttachments: [media('a'), media('b')] },
    })
    expect(($(el, 'caribou-status-media') as CaribouStatusMedia).media).toHaveLength(2)
  })
})
