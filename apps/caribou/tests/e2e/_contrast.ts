import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { MASTODON_CAPABILITIES, type Status } from '@beatzball/caribou-mastodon-client'
import { BLUESKY_CAPABILITIES } from '@beatzball/caribou-bluesky-client'
import { emptyDraft } from '@beatzball/caribou-state'

export type Network = 'mastodon' | 'bluesky'
export type Theme = 'dark' | 'light'

export function post(network: Network, id = '1'): Status {
  const uri = `at://did:plc:alice/app.bsky.feed.post/contrast${id}`
  return {
    id: network === 'bluesky' ? uri : id,
    uri, url: `https://example.social/@alice/${id}`, content: '<p>A post with <a href="https://example.com">a link</a>.</p>',
    createdAt: '2026-01-01T12:00:00Z', visibility: 'public', spoilerText: '', sensitive: false,
    account: {
      id: 'alice', acct: network === 'bluesky' ? 'alice.example.com' : 'alice@example.social',
      username: 'alice', displayName: 'Alice', avatar: '', avatarStatic: '',
      url: 'https://example.social/@alice', emojis: [],
      ...(network === 'bluesky' ? { bluesky: { did: 'did:plc:alice', handleInvalid: false } } : {}),
    },
    reblogged: true, reblogsCount: 3, favourited: false, favouritesCount: 2, repliesCount: 1,
    mediaAttachments: [], mentions: [], tags: [], emojis: [],
    ...(network === 'bluesky' ? {
      bluesky: {
        uri, cid: 'bafyfixture', labels: [], viewerOf: null,
        replyDisabled: false, embeddingDisabled: false,
        moderation: {
          contexts: Object.fromEntries(['contentList', 'contentView', 'contentMedia', 'avatar', 'banner', 'profileList', 'profileView']
            .map((key) => [key, { filter: false, blur: false, alert: false, inform: false, noOverride: false, reasons: [] }])),
          labelersCovered: [],
        },
      },
    } : {}),
  } as unknown as Status
}

// Load the production constructors through the router's own lazy actions.
// Mount isolated display fixtures without signing in or reaching an upstream.
// State below selects render branches; the browser uses the real component CSS.
export async function fixture(page: Page, theme: Theme) {
  await page.route((url) => !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), (route) => route.abort())
  await page.goto('/about')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.evaluate(async (theme) => {
    const outlet = document.querySelector('litro-outlet')! as HTMLElement & {
      routes: { path: string; action(): Promise<void> }[]
    }
    for (const path of ['/', '/home', '/settings', '/search', '/lists', '/settings/moderation', '/@:handle/:statusId']) {
      const route = outlet.routes.find((route) => route.path === path)
      if (!route) throw new Error(`Missing fixture route: ${path}`)
      await route.action()
    }
    outlet.hidden = true
    document.documentElement.dataset.theme = theme
    const box = document.createElement('div')
    box.id = 'contrast-fixture'
    box.style.cssText = 'width:min(600px, 100%); padding:16px; background:var(--bg-0);'
    document.body.append(box)
  }, theme)
}

export async function mount(page: Page, tag: string, props: Record<string, unknown> = {}, id = tag) {
  await page.evaluate(async ({ tag, props, id }) => {
    if (!customElements.get(tag)) throw new Error(`Unregistered fixture: ${tag}`)
    const el = document.createElement(tag) as HTMLElement & { updateComplete: Promise<boolean> }
    el.id = id
    document.querySelector('#contrast-fixture')!.append(el)
    while (!(await el.updateComplete)) { /* settle initial effects */ }
    Object.assign(el, props)
    while (!(await el.updateComplete)) { /* settle selected render branch */ }
    for (const dialog of el.shadowRoot?.querySelectorAll('dialog') ?? []) dialog.show()
  }, { tag, props, id })
  return page.locator(`#${id}`)
}

export async function compose(page: Page, network: Network, poll = false) {
  const media = { id: 'image', type: 'image' as const, url: '', previewUrl: '', description: '' }
  const draft = emptyDraft({
    cw: network === 'mastodon',
    poll: poll ? { options: ['', ''], expiresIn: 86400, multiple: false, hideTotals: false } : null,
    media: !poll && network === 'mastodon' ? [media] : [],
    ...(network === 'bluesky' ? { bluesky: { images: [{ id: 'image', alt: '', name: 'image.png', mime: 'image/png', size: 1, aspectRatio: null, blob: { $type: 'blob' as const, ref: { $link: 'bafyfixture' }, mimeType: 'image/png', size: 1 } }], labels: [], reply: null, quote: null, rkey: null, sent: null } } : {}),
  })
  return mount(page, 'caribou-compose-dialog', {
    ready: true, draft,
    client: { capabilities: network === 'bluesky' ? BLUESKY_CAPABILITIES : MASTODON_CAPABILITIES },
  })
}

export function ratio(a: number[], b: number[]): number {
  const luminance = (color: number[]) => color.slice(0, 3).map((c) => {
    c /= 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0)
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

// Composite backgrounds and group opacity across every shadow boundary.
// A faded ancestor must fail even if its declared text token passes.
export async function textContrast(target: Locator, pseudo?: '::placeholder') {
  await expect(target).toBeVisible()
  const colors = await target.evaluate((el, pseudo) => {
    type Color = [number, number, number, number]
    const parse = (s: string): Color => {
      const n = s.match(/[\d.]+/g)!.map(Number)
      return [n[0]!, n[1]!, n[2]!, n[3] ?? 1]
    }
    const over = (fg: Color, bg: Color): Color => {
      const a = fg[3] + bg[3] * (1 - fg[3])
      return a ? [0, 1, 2].map((i) => (fg[i]! * fg[3] + bg[i]! * bg[3] * (1 - fg[3])) / a).concat(a) as Color : [0, 0, 0, 0]
    }
    const parent = (node: Element): Element | null => node.parentElement ?? (node.getRootNode() as ShadowRoot).host ?? null
    const style = getComputedStyle(el, pseudo)
    let fg = parse(style.color)
    if (pseudo) fg[3] *= Number(style.opacity)
    let bg: Color = [0, 0, 0, 0]
    for (let node: Element | null = el; node; node = parent(node)) {
      const css = getComputedStyle(node)
      const fill = parse(css.backgroundColor)
      fg = over(fg, fill)
      bg = over(bg, fill)
      fg[3] *= Number(css.opacity)
      bg[3] *= Number(css.opacity)
    }
    return { fg: over(fg, [255, 255, 255, 1]), bg: over(bg, [255, 255, 255, 1]) }
  }, pseudo)
  return ratio(colors.fg, colors.bg)
}

export async function expectText(target: Locator, pseudo?: '::placeholder') {
  expect(await textContrast(target, pseudo), await target.evaluate((el) => el.outerHTML.slice(0, 150))).toBeGreaterThanOrEqual(4.5)
}

export async function expectBoundary(target: Locator) {
  await expect(target).toBeVisible()
  await target.evaluate((el) => (el as HTMLElement).blur())
  const colors = await target.evaluate((el) => {
    const parse = (s: string) => s.match(/[\d.]+/g)!.map(Number)
    const style = getComputedStyle(el)
    const parent = (node: Element): Element | null => node.parentElement ?? (node.getRootNode() as ShadowRoot).host ?? null
    let outside = parent(el)
    while (outside && getComputedStyle(outside).backgroundColor === 'rgba(0, 0, 0, 0)') outside = parent(outside)
    return {
      border: parse(style.borderTopColor), fill: parse(style.backgroundColor),
      outside: parse(getComputedStyle(outside!).backgroundColor),
      width: parseFloat(style.borderTopWidth), borderStyle: style.borderTopStyle,
      focused: el.matches(':focus'),
    }
  })
  expect(colors.focused).toBe(false)
  expect(colors.width).toBeGreaterThanOrEqual(1)
  expect(colors.borderStyle).toBe('solid')
  expect(ratio(colors.border, colors.fill), 'border / field').toBeGreaterThanOrEqual(3)
  expect(ratio(colors.border, colors.outside), 'border / outside').toBeGreaterThanOrEqual(3)
}

// Use the shared control's enabled/pressed display state without an account.
export async function activeBoost(card: Locator) {
  const control = card.locator('caribou-icon-button.boost')
  await control.evaluate(async (el) => {
    const button = el as HTMLElement & { softDisabled: boolean; updateComplete: Promise<boolean> }
    button.softDisabled = false
    while (!(await button.updateComplete)) { /* settle */ }
  })
  const button = control.locator('button')
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect(button).not.toHaveAttribute('aria-disabled', 'true')
  return button
}
