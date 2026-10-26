import { expect, test, type Page } from '@playwright/test'
import { SSR_STATUS, SSR_STATUS_CARD } from './_status-card-ssr.js'

// The status card is the first shared-control consumer the server renders:
// four `<caribou-icon-button>`s per card, each with a nested `<caribou-icon>`,
// all as declarative shadow roots. With no instance cookie a timeline route
// renders no cards in CI (the server would fetch a real instance; see
// public-timeline.spec.ts for that run), so this replays real server markup
// into a page that has loaded the timeline, and lets Lit hydrate it. The card
// waits for its `.status` the way a timeline's card does, then hydrates.

const ACTIONS = ['reply', 'boost', 'favourite', 'bookmark']

interface Hydrated {
  kept: boolean
  buttonsPerControl: number[]
  deferred: string[]
  actions: Array<Array<string | null>>
}

// Replays the card into `#replay` and reports what hydration did to it.
async function replay(page: Page): Promise<Hydrated> {
  await page.goto('/local')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.waitForFunction(() => customElements.get('caribou-status-card') !== undefined)

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
    const watched = 'caribou-icon-button, caribou-icon, button, svg'
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
      actions: hosts.map((h) => {
        const b = h.shadowRoot!.querySelector('button')!
        return [b.getAttribute('aria-label'), b.getAttribute('aria-pressed'), b.getAttribute('aria-disabled'), b.getAttribute('title')]
      }),
    }
  }, { markup: SSR_STATUS_CARD, status: SSR_STATUS })
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
    // Every host, nested icon, native button and SVG is the node the server sent.
    kept: true,
    buttonsPerControl: [1, 1, 1, 1],
    deferred: [],
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
