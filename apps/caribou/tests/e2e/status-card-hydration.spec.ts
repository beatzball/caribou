import { expect, test, type Page } from '@playwright/test'
import { SSR_CW_STATUS, SSR_CW_STATUS_CARD, SSR_STATUS, SSR_STATUS_CARD } from './_status-card-ssr.js'

// The status card is the first shared-control consumer the server renders:
// four `<caribou-icon-button>`s per card, each with a nested `<caribou-icon>`,
// all as declarative shadow roots. With no instance cookie a timeline route
// renders no cards in CI (the server would fetch a real instance; see
// public-timeline.spec.ts for that run), so this replays real server markup
// into a page that has loaded the timeline, and lets Lit hydrate it. The card
// waits for its `.status` the way a timeline's card does, then hydrates.

const ACTIONS = ['reply', 'boost', 'favourite', 'bookmark']

// 1×1 transparent PNG.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

interface Hydrated {
  kept: boolean
  buttonsPerControl: number[]
  deferred: string[]
  linkCard: string[]
  actions: Array<Array<string | null>>
}

// Replays the card into `#replay` and reports what hydration did to it.
async function replay(
  page: Page,
  fixture: { markup: string; status: unknown } = { markup: SSR_STATUS_CARD, status: SSR_STATUS },
  before?: () => Promise<void>,
): Promise<Hydrated> {
  // The link card's image does not exist; answer so no load error is logged.
  await page.route('https://files.example.social/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }))
  await page.goto('/local')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.waitForFunction(() => customElements.get('caribou-status-card') !== undefined)
  await before?.()

  return page.evaluate(async ({ markup, status }) => {
    type Lit = HTMLElement & { updateComplete: Promise<boolean> }
    const deep = (root: ParentNode, sel: string, out: Element[] = []): Element[] => {
      out.push(...root.querySelectorAll(sel))
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) deep(el.shadowRoot, sel, out)
      return out
    }
    // A timeline's card waits with `defer-hydration` until its parent has
    // set `.status`; do the same, so nothing hydrates before the snapshot
    // below. setHTMLUnsafe parses declarative shadow roots, as page load
    // does.
    const box = document.createElement('div')
    box.id = 'replay'
    box.setHTMLUnsafe(markup.replace('<caribou-status-card ', '<caribou-status-card defer-hydration '))
    // Chromium (scoped registries) gives the elements inside a shadow root
    // that setHTMLUnsafe made no registry, so they never upgrade. A page
    // load uses the document's registry; hand each root that registry.
    const registry = customElements as CustomElementRegistry & { initialize?: (root: Node) => void }
    for (const host of [box, ...deep(box, '*')]) if (host.shadowRoot) registry.initialize?.(host.shadowRoot)
    // The fixture leaves out each root's <style>, and Lit does not add
    // styles to a root the server made. Give each root its element's own
    // stylesheet, as the server's <style> would.
    type Styled = { elementStyles?: Array<{ styleSheet?: CSSStyleSheet }> }
    for (const host of deep(box, '*')) {
      const styles = (customElements.get(host.localName) as unknown as Styled | undefined)?.elementStyles
      if (host.shadowRoot && styles) host.shadowRoot.adoptedStyleSheets = styles.flatMap((c) => c.styleSheet ?? [])
    }
    const card = box.querySelector('caribou-status-card') as Lit & { status: unknown }
    // `<litro-link>` makes its anchor on the client, so plain `a` is not
    // watched; the link card's link carries `data-layout`.
    const watched = 'caribou-icon-button, caribou-icon, button, svg, caribou-status-link-card, a[data-layout], img, .warning, #status-body'
    const sent = deep(card.shadowRoot!, watched)
    document.body.append(box)
    card.status = status
    card.removeAttribute('defer-hydration')
    while (!(await card.updateComplete)) { /* settle the post-mount render */ }
    const hosts: Lit[] = [...card.shadowRoot!.querySelectorAll('caribou-icon-button')]
    await Promise.all(hosts.map((h) => h.updateComplete))
    // The nested icons hydrate last, once their button has.
    const icons = deep(card.shadowRoot!, 'caribou-icon') as Lit[]
    await Promise.all(icons.map((i) => i.updateComplete))
    const now = deep(card.shadowRoot!, watched)
    return {
      kept: now.length === sent.length && now.every((el, i) => el === sent[i]),
      buttonsPerControl: hosts.map((h) => h.shadowRoot!.querySelectorAll('button').length),
      deferred: deep(card.shadowRoot!, '[defer-hydration]').map((el) => el.localName),
      // The displayed post's link card, with its link and image in place.
      linkCard: [...card.shadowRoot!.querySelector('caribou-status-link-card')?.shadowRoot?.querySelectorAll('a, img') ?? []]
        .map((el) => el.getAttribute('href') ?? el.getAttribute('src') ?? ''),
      actions: hosts.map((h) => {
        const b = h.shadowRoot!.querySelector('button')!
        return [b.getAttribute('aria-label'), b.getAttribute('aria-pressed'), b.getAttribute('aria-disabled'), b.getAttribute('title')]
      }),
    }
  }, fixture)
}

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  return errors
}

const action = (page: Page, cls: string) => page.locator(`#replay caribou-icon-button.${cls} button`)

test('a server-rendered status card hydrates its action buttons and icons without a second copy', async ({ page }) => {
  const errors = collectErrors(page)
  expect(await replay(page)).toEqual({
    // Every host, nested icon, native button, SVG, link and image is the node
    // the server sent, the link card's included.
    kept: true,
    buttonsPerControl: [1, 1, 1, 1],
    deferred: [],
    linkCard: ['https://news.example/story', 'https://files.example.social/card.png'],
    // Signed out: every action is soft-disabled with its sign-in hint.
    actions: [
      ['Reply', null, 'true', 'Sign in to reply'],
      ['Boost', 'false', 'true', 'Sign in to boost'],
      ['Unfavourite', 'true', 'true', 'Sign in to favourite'],
      ['Bookmark', 'false', 'true', 'Sign in to bookmark'],
    ],
  })

  // The adopted icons render again on a change: hydration attached them,
  // it did not just leave the server's SVG in place.
  const redrawn = await page.evaluate(async () => {
    const card = document.querySelector('#replay caribou-status-card')!
    const host = card.shadowRoot!.querySelector('caribou-icon-button.reply')!
    const icon = host.shadowRoot!.querySelector('caribou-icon') as HTMLElement & { name: string; updateComplete: Promise<boolean> }
    const before = icon.shadowRoot!.querySelector('svg')
    icon.name = 'x'
    await icon.updateComplete
    const after = icon.shadowRoot!.querySelector('svg')
    return after !== before && after?.querySelector('path')?.getAttribute('d') === 'M18 6L6 18M6 6l12 12'
  })
  expect(redrawn).toBe(true)
  expect(errors).toEqual([])
})

test('signed out, each server-rendered action is one tab stop and Enter or Space does nothing', async ({ page }) => {
  const errors = collectErrors(page)
  await replay(page)
  // A click that got past the icon button would bubble to the box.
  await page.evaluate(() => {
    const w = window as unknown as { __escaped: number; __compose: number }
    w.__escaped = 0
    w.__compose = 0
    document.querySelector('#replay')!.addEventListener('click', () => { w.__escaped++ })
    window.addEventListener('caribou:compose', () => { w.__compose++ })
  })

  await action(page, 'reply').focus()
  for (const [i, cls] of ACTIONS.entries()) {
    const b = action(page, cls)
    await expect(b).toBeFocused()
    await page.keyboard.press('Enter')
    await page.keyboard.press(' ')
    if (i < ACTIONS.length - 1) await page.keyboard.press('Tab')
  }
  expect(await page.evaluate(() => {
    const w = window as unknown as { __escaped: number; __compose: number }
    return { escaped: w.__escaped, compose: w.__compose }
  })).toEqual({ escaped: 0, compose: 0 })

  // The control: once it is no longer soft-disabled, Enter does click.
  await page.evaluate(() => {
    const card = document.querySelector('#replay caribou-status-card')!
    ;(card.shadowRoot!.querySelector('caribou-icon-button.bookmark') as HTMLElement & { softDisabled: boolean }).softDisabled = false
  })
  await expect(action(page, 'bookmark')).not.toHaveAttribute('aria-disabled', 'true')
  await action(page, 'bookmark').focus()
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => (window as unknown as { __escaped: number }).__escaped)).toBe(1)
  expect(errors).toEqual([])
})

test('a pressed boost keeps its success colour under the pointer', async ({ page }) => {
  await replay(page)
  // Signed-in and pressed, as after a boost; set on the icon button, since
  // a signed-in card needs a client this page does not have.
  await page.evaluate(async () => {
    const card = document.querySelector('#replay caribou-status-card')!
    for (const cls of ['boost', 'favourite']) {
      const host = card.shadowRoot!.querySelector(`caribou-icon-button.${cls}`) as HTMLElement & {
        softDisabled: boolean; pressed: boolean; updateComplete: Promise<boolean>
      }
      host.softDisabled = false
      host.pressed = true
      await host.updateComplete
    }
  })
  const colours = (cls: string) => action(page, cls).evaluate((b, cls) => {
    const probe = document.createElement('span')
    probe.style.color = cls === 'boost' ? 'var(--success)' : 'var(--accent)'
    b.getRootNode().appendChild(probe)
    const expected = getComputedStyle(probe).color
    probe.remove()
    return { colour: getComputedStyle(b).color, expected }
  }, cls)

  for (const cls of ['boost', 'favourite']) {
    const rest = await colours(cls)
    expect(rest.colour).toBe(rest.expected)
    await action(page, cls).hover()
    const hover = await colours(cls)
    expect(hover.colour, `${cls} on hover`).toBe(rest.expected)
  }
})

test('a server-rendered post behind a content warning hydrates collapsed, then opens', async ({ page }) => {
  const errors = collectErrors(page)
  const files: string[] = []
  page.on('request', (r) => { if (r.url().includes('files.example.social')) files.push(r.url()) })
  const result = await replay(page, { markup: SSR_CW_STATUS_CARD, status: SSR_CW_STATUS })
  expect(result.kept).toBe(true)
  expect(result.deferred).toEqual([])

  const card = page.locator('#replay caribou-status-card')
  const toggle = card.getByRole('button', { name: 'Show more' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(card.locator('.status-content')).toHaveCount(0)
  await expect(card.locator('caribou-status-media')).toHaveCount(0)
  expect(files).toEqual([])

  await toggle.click()
  const less = card.getByRole('button', { name: 'Show less' })
  await expect(less).toHaveAttribute('aria-expanded', 'true')
  await expect(card.locator('.status-content')).toHaveText('the butler did it')
  // The reveal opens the sensitive media too.
  await expect(card.locator('caribou-status-media img')).toHaveCount(1)
  await expect(card.locator('caribou-status-media').getByRole('button', { name: 'Hide' })).toBeVisible()
  expect(errors).toEqual([])
})

// The card remembers an opened warning for the page session. A card that
// hydrates server markup must still render collapsed, like the server did,
// or hydration would not match.
test('a server-rendered post hydrates collapsed even after the reader opened it in this page', async ({ page }) => {
  const errors = collectErrors(page)
  const result = await replay(page, { markup: SSR_CW_STATUS_CARD, status: SSR_CW_STATUS }, async () => {
    // Open the same post in a client-rendered card, then check that a new
    // client card for it starts open: the memory is seeded.
    const seeded = await page.evaluate(async (status) => {
      type Card = HTMLElement & { status: unknown; updateComplete: Promise<boolean> }
      const mount = async () => {
        const card = document.createElement('caribou-status-card') as Card
        card.status = status
        document.body.append(card)
        await card.updateComplete
        return card
      }
      const first = await mount()
      ;(first.shadowRoot!.querySelector('button.cw-toggle') as HTMLButtonElement).click()
      await first.updateComplete
      first.remove()
      const second = await mount()
      const open = second.shadowRoot!.querySelector('button.cw-toggle')!.getAttribute('aria-expanded')
      second.remove()
      return open
    }, SSR_CW_STATUS)
    expect(seeded).toBe('true')
  })
  expect(result.kept).toBe(true)
  expect(result.deferred).toEqual([])
  const card = page.locator('#replay caribou-status-card')
  await expect(card.getByRole('button', { name: 'Show more' })).toHaveAttribute('aria-expanded', 'false')
  await expect(card.locator('.status-content')).toHaveCount(0)
  await expect(card.locator('caribou-status-media')).toHaveCount(0)
  expect(errors).toEqual([])
})
