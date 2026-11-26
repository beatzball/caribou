import type { Locator } from '@playwright/test'
import { expect, test, type Page } from './_fixtures.js'
import { ratio } from './_contrast.js'
import { opened, openTimeline, scaleOf, transformOf, viewer } from './_media-viewer.js'

// The media viewer draws no box of its own: the image floats over a tinted,
// blurred page. The text and Close sit on small dark surfaces, and a click
// on any empty place around the image closes the viewer.

type Rgba = [number, number, number, number]

// The dialog's and its backdrop's own look.
function looks(dialog: Locator) {
  return dialog.evaluate((el) => {
    const d = getComputedStyle(el)
    const b = getComputedStyle(el, '::backdrop') as CSSStyleDeclaration & { webkitBackdropFilter?: string }
    return {
      background: d.backgroundColor, border: d.borderTopWidth, radius: d.borderTopLeftRadius, shadow: d.boxShadow,
      tint: b.backgroundColor,
      blur: b.backdropFilter || b.webkitBackdropFilter || 'none',
      supported: CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'),
    }
  })
}

// The text color and the fill under it, composited up to the dialog, then
// over the worst page behind: white, under the backdrop's tint (or with no
// tint at all, as a stricter case).
async function surfaceColors(target: Locator) {
  await expect(target).toBeVisible()
  return target.evaluate((el) => {
    const parse = (s: string): Rgba => {
      const n = s.match(/[\d.]+/g)!.map(Number)
      return [n[0]!, n[1]!, n[2]!, n[3] ?? 1]
    }
    const over = (fg: Rgba, bg: Rgba): Rgba => {
      const a = fg[3] + bg[3] * (1 - fg[3])
      return a ? [0, 1, 2].map((i) => (fg[i]! * fg[3] + bg[i]! * bg[3] * (1 - fg[3])) / a).concat(a) as Rgba : [0, 0, 0, 0]
    }
    const parent = (n: Element): Element | null => n.parentElement ?? (n.getRootNode() as ShadowRoot).host ?? null
    let fill: Rgba = [0, 0, 0, 0]
    let dialog: Element | null = null
    for (let n: Element | null = el; n; n = parent(n)) {
      fill = over(fill, parse(getComputedStyle(n).backgroundColor))
      if (n.localName === 'dialog') { dialog = n; break }
    }
    const white: Rgba = [255, 255, 255, 1]
    const tinted = over(parse(getComputedStyle(dialog!, '::backdrop').backgroundColor), white)
    const text = parse(getComputedStyle(el).color)
    const tintedBg = over(fill, tinted)
    const whiteBg = over(fill, white)
    return {
      tinted: { fg: over(text, tintedBg), bg: tintedBg },
      white: { fg: over(text, whiteBg), bg: whiteBg },
      page: tinted,
    }
  })
}

async function expectReadable(target: Locator) {
  const c = await surfaceColors(target)
  expect(ratio(c.tinted.fg, c.tinted.bg), 'over a white page under the tint').toBeGreaterThanOrEqual(4.5)
  expect(ratio(c.white.fg, c.white.bg), 'over a white page with no tint').toBeGreaterThanOrEqual(4.5)
}

// A click beside the image closes the viewer only once no second click
// came for a double click (300ms). Wait past that before saying a click
// did not close it.
async function stillOpen(page: Page, dialog: Locator) {
  await page.waitForTimeout(400)
  await expect(dialog).toBeVisible()
}

// Record every click the document sees, and whether it was inside the
// viewer's dialog.
function recordClicks(page: Page) {
  return page.evaluate(() => {
    const w = window as Window & { inViewer?: boolean[] }
    w.inViewer = []
    document.addEventListener('click', (e) => {
      w.inViewer!.push(e.composedPath().some((n) => n instanceof HTMLDialogElement))
    }, true)
  })
}

function clicks(page: Page) {
  return page.evaluate(() => (window as Window & { inViewer?: boolean[] }).inViewer)
}

async function whitePage(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((theme) => {
    document.documentElement.dataset.theme = theme
    document.body.style.background = '#fff'
  }, theme)
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: the dialog has no box, the backdrop tints and blurs, and the text reads on its own surface`, async ({ page }) => {
    await openTimeline(page)
    await whitePage(page, theme)
    const v = viewer(page)
    // Open with the keyboard, so Close shows its focus ring.
    await v.thumb.focus()
    await page.keyboard.press('Enter')
    await opened(page)

    const s = await looks(v.dialog)
    expect(s.background).toBe('rgba(0, 0, 0, 0)')
    expect(s.border).toBe('0px')
    expect(s.radius).toBe('0px')
    expect(s.shadow).toBe('none')
    if (s.supported) {
      expect(s.blur).toBe('blur(16px)')
      expect(s.tint).toBe('rgba(0, 0, 0, 0.55)')
    } else {
      expect(s.tint).toBe('rgba(0, 0, 0, 0.8)')
    }

    // The size of the dialog is as before.
    const box = (await v.dialog.boundingBox())!
    const size = page.viewportSize()!
    expect(Math.abs(box.width - size.width * 0.95)).toBeLessThan(1)
    expect(Math.abs(box.height - size.height * 0.95)).toBeLessThan(1)

    // Nothing tints or blurs the image itself.
    for (const el of [v.stage, v.image]) {
      const own = await el.evaluate((n) => {
        const c = getComputedStyle(n) as CSSStyleDeclaration & { webkitBackdropFilter?: string }
        return { bg: c.backgroundColor, filter: c.filter, opacity: c.opacity, blur: c.backdropFilter || c.webkitBackdropFilter || 'none' }
      })
      expect(own).toEqual({ bg: 'rgba(0, 0, 0, 0)', filter: 'none', opacity: '1', blur: 'none' })
    }

    // The description, the key hint and Close read at 4.5:1 or more.
    await expectReadable(v.dialog.locator('p'))
    await expectReadable(v.dialog.locator('.hint'))
    await expectReadable(v.close)

    // Close's focus ring: white on a black halo, so it shows on any page.
    await expect(v.close).toBeFocused()
    expect(await v.close.evaluate((el) => el.matches(':focus-visible'))).toBe(true)
    const ring = await v.close.evaluate((el) => {
      const c = getComputedStyle(el)
      return { color: c.outlineColor, width: parseFloat(c.outlineWidth), style: c.outlineStyle, shadow: c.boxShadow }
    })
    expect(ring.style).toBe('solid')
    expect(ring.width).toBeGreaterThanOrEqual(2)
    expect(ring.color).toBe('rgb(255, 255, 255)')
    expect(ring.shadow).toMatch(/rgb\(0, 0, 0\).*6px|6px.*rgb\(0, 0, 0\)/)
    const { page: behind } = await surfaceColors(v.close)
    expect(ratio([255, 255, 255, 1], behind), 'ring against the tinted white page').toBeGreaterThanOrEqual(3)
  })
}

test('with reduced transparency the backdrop is an 85% black tint, the surfaces are solid, and nothing blurs', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Playwright cannot emulate reduced transparency; CDP is Chromium only')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
  })
  await openTimeline(page)
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches)).toBe(true)
  await whitePage(page, 'light')
  const v = viewer(page)
  await v.thumb.click()
  await opened(page)

  const s = await looks(v.dialog)
  expect(s.tint).toBe('rgba(0, 0, 0, 0.85)')
  expect(s.blur).toBe('none')
  expect(s.background).toBe('rgba(0, 0, 0, 0)')
  for (const el of [v.dialog.locator('p'), v.dialog.locator('.hint'), v.close]) {
    const own = await el.evaluate((n) => {
      const c = getComputedStyle(n) as CSSStyleDeclaration & { webkitBackdropFilter?: string }
      return { bg: c.backgroundColor, blur: c.backdropFilter || c.webkitBackdropFilter || 'none' }
    })
    expect(own).toEqual({ bg: 'rgb(0, 0, 0)', blur: 'none' })
  }
  await expectReadable(v.dialog.locator('p'))
})

test('a click on empty space closes the viewer; a click on the image, the text or a drag does not', async ({ page }) => {
  await openTimeline(page)
  const v = viewer(page)
  const open = async () => {
    await v.thumb.click()
    await opened(page)
  }
  await open()
  const img = (await v.image.boundingBox())!
  const stage = (await v.stage.boundingBox())!
  // A 4:3 picture in a wide stage: empty stage on each side of it.
  expect(img.x - stage.x).toBeGreaterThan(40)
  const beside = { x: (stage.x + img.x) / 2, y: img.y + img.height / 2 }

  // The image, the description and the key hint keep the viewer open.
  await v.image.click()
  await v.dialog.locator('p').click()
  await v.dialog.locator('.hint').click()
  await stillOpen(page, v.dialog)

  // A drag beside the image is not a click.
  await page.mouse.move(beside.x, beside.y)
  await page.mouse.down()
  await page.mouse.move(beside.x, beside.y + 80, { steps: 5 })
  await page.mouse.up()
  await stillOpen(page, v.dialog)
  // Nor is one that starts on the padding and ends there.
  const dlg = (await v.dialog.boundingBox())!
  await page.mouse.move(dlg.x + 4, dlg.y + 100)
  await page.mouse.down()
  await page.mouse.move(dlg.x + 4, dlg.y + 200, { steps: 5 })
  await page.mouse.up()
  await stillOpen(page, v.dialog)

  // A click on the stage beside the image closes it, and focus goes back.
  await page.mouse.click(beside.x, beside.y)
  await expect(v.dialog).toBeHidden()
  await expect(v.thumb).toBeFocused()

  // So does a click on the dialog's padding, and one on the empty middle
  // of the bar.
  await open()
  await page.mouse.click(dlg.x + 4, dlg.y + dlg.height / 2)
  await expect(v.dialog).toBeHidden()
  await open()
  const hint = (await v.dialog.locator('.hint').boundingBox())!
  const close = (await v.close.boundingBox())!
  expect(close.x - (hint.x + hint.width)).toBeGreaterThan(40)
  await page.mouse.click((hint.x + hint.width + close.x) / 2, close.y + close.height / 2)
  await expect(v.dialog).toBeHidden()
  // Still on the timeline: no click reached the page behind.
  expect(new URL(page.url()).pathname).toBe('/home')
})

test('a double click beside the image zooms there; neither click reaches the page behind', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openTimeline(page)
  const v = viewer(page)
  await v.thumb.click()
  await opened(page)
  const img = (await v.image.boundingBox())!
  const stage = (await v.stage.boundingBox())!
  expect(img.x - stage.x).toBeGreaterThan(40)
  await recordClicks(page)

  await page.mouse.dblclick((stage.x + img.x) / 2, img.y + img.height / 2)
  await expect.poll(async () => scaleOf(await transformOf(v.image))).toBe(2.5)
  await stillOpen(page, v.dialog)
  expect(await clicks(page)).toEqual([true, true])
  expect(new URL(page.url()).pathname).toBe('/home')
})

test('zoomed, no click closes the viewer: not beside the image, not on the padding, not on the backdrop', async ({ page }) => {
  // A tall picture: empty stage on each side, even zoomed in.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openTimeline(page, { portrait: true })
  const v = viewer(page)
  await v.thumb.click()
  await opened(page)
  const stage = (await v.stage.boundingBox())!
  const dlg = (await v.dialog.boundingBox())!

  await page.keyboard.press('+')
  await expect.poll(async () => scaleOf(await transformOf(v.image))).toBe(1.5)
  const zoomed = (await v.image.boundingBox())!
  expect(zoomed.x - stage.x).toBeGreaterThan(40)
  await page.mouse.click(stage.x + 20, stage.y + 40)
  await stillOpen(page, v.dialog)
  // The padding and the backdrop wait for 1x too.
  expect(dlg.x).toBeGreaterThan(10)
  await page.mouse.click(dlg.x + 4, dlg.y + dlg.height / 2)
  await page.mouse.click(5, 5)
  await stillOpen(page, v.dialog)
  expect(scaleOf(await transformOf(v.image))).toBe(1.5)

  // Back at 1x the same kind of click closes it. A point far from the last
  // one, so the two are not a double click.
  await page.keyboard.press('0')
  await expect.poll(() => transformOf(v.image)).toBe('')
  await page.mouse.click(stage.x + 20, stage.y + stage.height - 40)
  await expect(v.dialog).toBeHidden()
})
