import { expect, test } from './_fixtures.js'
import {
  LONG_ALT, centerOf, opened, openTimeline, pageScale, placeOf, pointOn, scaleOf, transformOf, viewer,
} from './_media-viewer.js'

// The media viewer zooms its image, never the page: ctrl+wheel (a trackpad
// pinch arrives as one), a double click, and the + / - / 0 keys.

test('ctrl+wheel zooms the image, a plain wheel pans it, and the page stays at 1x', async ({ page }) => {
  await openTimeline(page)
  const v = viewer(page)
  await v.thumb.click()
  await opened(page)
  expect(await v.stage.evaluate((el) => getComputedStyle(el).touchAction)).toBe('none')
  const ratio = await page.evaluate(() => window.devicePixelRatio)

  const c = await centerOf(v.image)
  await page.mouse.move(c.x + 40, c.y + 30)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -40)
  await page.keyboard.up('Control')
  await expect.poll(async () => scaleOf(await transformOf(v.image))).toBeGreaterThan(1)
  expect(await pageScale(page)).toBe(1)
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(ratio)

  // Zoomed: a plain wheel moves the image, not the page behind.
  const before = await transformOf(v.image)
  const scrollY = await page.evaluate(() => window.scrollY)
  await page.mouse.wheel(0, 30)
  await expect.poll(() => transformOf(v.image)).not.toBe(before)
  expect(scaleOf(await transformOf(v.image))).toBe(scaleOf(before))
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY)

  // The Close bar is outside the zoom surface and stays where it was.
  await expect(v.close).toBeInViewport()
  await v.close.click()
  await expect(v.dialog).toBeHidden()
})

test('keys zoom in, out and back; closing and opening again starts at 1x', async ({ page }) => {
  await openTimeline(page)
  const v = viewer(page)
  await v.thumb.click()
  await opened(page)
  await expect(v.close).toBeFocused()

  await page.keyboard.press('+')
  await expect.poll(async () => scaleOf(await transformOf(v.image))).toBe(1.5)
  await page.keyboard.press('=')
  await expect.poll(async () => scaleOf(await transformOf(v.image))).toBe(2.25)
  await page.keyboard.press('-')
  await expect.poll(async () => scaleOf(await transformOf(v.image))).toBe(1.5)
  await page.keyboard.press('0')
  await expect.poll(() => transformOf(v.image)).toBe('')
  // The keys move no focus; Close keeps it, and Escape still closes.
  await expect(v.close).toBeFocused()
  // With ctrl or cmd the keys stay the browser's own page zoom.
  for (const mod of ['ctrlKey', 'metaKey']) {
    const taken = await v.close.evaluate((el, m) => {
      const e = new KeyboardEvent('keydown', { key: '+', [m]: true, bubbles: true, composed: true, cancelable: true })
      el.dispatchEvent(e)
      return e.defaultPrevented
    }, mod)
    expect(taken, mod).toBe(false)
  }
  expect(await transformOf(v.image)).toBe('')

  // The dialog names the keys.
  await expect(v.dialog).toHaveAccessibleDescription(/\+ and − to zoom, arrows to move, 0 to reset/)
  // At 1x the arrows are not taken: they scroll as usual.
  const arrowTaken = () => v.close.evaluate((el) => {
    const e = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true, cancelable: true })
    el.dispatchEvent(e)
    return e.defaultPrevented
  })
  expect(await arrowTaken()).toBe(false)

  // Zoomed, the arrows move the image: right shows more of the right side.
  await page.keyboard.press('+')
  await page.keyboard.press('+')
  await expect.poll(async () => scaleOf(await transformOf(v.image))).toBe(2.25)
  const xOf = async () => Number(/translate\((-?[\d.]+)px/.exec(await transformOf(v.image))?.[1] ?? 0)
  const yOf = async () => Number(/translate\(-?[\d.]+px, (-?[\d.]+)px/.exec(await transformOf(v.image))?.[1] ?? 0)
  await page.keyboard.press('ArrowRight')
  await expect.poll(xOf).toBeLessThan(0)
  await page.keyboard.press('ArrowLeft')
  await expect.poll(xOf).toBe(0)
  await page.keyboard.press('ArrowDown')
  await expect.poll(yOf).toBeLessThan(0)
  expect(await arrowTaken()).toBe(true)
  await page.keyboard.press('Escape')
  await expect(v.dialog).toBeHidden()
  await expect(v.thumb).toBeFocused()

  await page.keyboard.press('Enter')
  await opened(page)
  expect(await transformOf(v.image)).toBe('')
})

test('opened again before the close event arrives, the viewer keeps its image', async ({ page }) => {
  await openTimeline(page)
  const v = viewer(page)
  await v.thumb.click()
  await opened(page)
  // The close event is a task after close(); a reopen in that gap (an
  // Enter on the thumbnail, which already has focus back) comes first.
  await page.locator('caribou-status-media').evaluate((el) => {
    el.shadowRoot!.querySelector('dialog')!.close()
    el.shadowRoot!.querySelector<HTMLElement>('a.thumb')!.click()
  })
  await opened(page)
  await expect(v.close).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(v.dialog).toBeHidden()
  await expect(v.thumb).toBeFocused()
})

test('a double click toggles 2.5x on that point; a click on the image does not close the viewer', async ({ page }) => {
  await openTimeline(page)
  const v = viewer(page)
  await v.thumb.click()
  await opened(page)

  const c = await centerOf(v.image)
  await page.mouse.click(c.x, c.y)
  await expect(v.dialog).toBeVisible()

  await page.mouse.dblclick(c.x + 50, c.y + 20)
  await expect.poll(async () => scaleOf(await transformOf(v.image))).toBe(2.5)
  await expect(v.dialog).toBeVisible()
  await page.mouse.dblclick(c.x, c.y)
  await expect.poll(() => transformOf(v.image)).toBe('')

  // At 1x the backdrop still closes it.
  await page.mouse.click(5, 5)
  await expect(v.dialog).toBeHidden()
})

test('a tall image with a long description: a double click keeps the clicked point in place', async ({ page }) => {
  // No easing, so the box is final at once.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openTimeline(page, { portrait: true, alt: LONG_ALT })
  const v = viewer(page)
  await v.thumb.click()
  await opened(page)
  const img = (await v.image.boundingBox())!
  const stage = (await v.stage.boundingBox())!
  // The description is wider than the image, so the stage is too.
  expect(stage.width).toBeGreaterThan(img.width)

  const c = await centerOf(v.image)
  const at = { x: c.x, y: c.y - img.height / 4 }
  const p = await pointOn(v.image, at)
  await page.mouse.dblclick(at.x, at.y)
  await expect.poll(async () => scaleOf(await transformOf(v.image))).toBe(2.5)
  const now = await placeOf(v.image, p)
  expect(Math.abs(now.x - at.x)).toBeLessThan(1)
  expect(Math.abs(now.y - at.y)).toBeLessThan(1)
})

test('the zoom eases only without reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await openTimeline(page)
  const v = viewer(page)
  const duration = () => v.image.evaluate((img) => getComputedStyle(img).transitionDuration)
  await v.thumb.click()
  await opened(page)
  await page.keyboard.press('+')
  expect(await duration()).not.toBe('0s')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await duration()).toBe('0s')
  await page.keyboard.press('+')
  await expect.poll(async () => scaleOf(await transformOf(v.image))).toBe(2.25)
})

test.describe('on a touch screen', () => {
  // A real two-finger pinch through Chromium's input pipeline: the browser
  // would zoom the page if the image did not take the gesture.
  test.skip(({ browserName }) => browserName !== 'chromium', 'CDP touch input is Chromium only')
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

  test('a pinch on the image zooms the image, not the page', async ({ page }) => {
    await openTimeline(page)
    const v = viewer(page)
    await v.thumb.tap()
    await opened(page)
    expect(await pageScale(page)).toBe(1)

    const c = await centerOf(v.image)
    const cdp = await page.context().newCDPSession(page)
    const fingers = (d: number) => [
      { x: c.x - d, y: c.y, id: 1 },
      { x: c.x + d, y: c.y, id: 2 },
    ]
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(20) })
    for (let d = 25; d <= 90; d += 5) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(d) })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })

    await expect.poll(async () => scaleOf(await transformOf(v.image))).toBeGreaterThan(2)
    expect(await pageScale(page)).toBe(1)
    await expect(v.close).toBeInViewport()
  })
})
