import type { Locator } from '@playwright/test'
import { expect, test, type Page } from './_fixtures.js'
import { LONG_ALT, centerOf, opened, openTimeline, scaleOf, transformOf, viewer } from './_media-viewer.js'

// Swipe to dismiss. At 1x a drag on the image moves it up or down with the
// pointer and fades the backdrop; let go past a fifth of the stage's height,
// or with a flick, and the viewer closes. A shorter drag springs back.
// Zoomed, a drag pans. The thresholds themselves are unit-tested
// (components/__tests__/media-swipe.test.ts); these check the wiring, with
// a real mouse on every desktop browser and real touch in Chromium.

type At = { x: number; y: number }

// A slow drag: 10px every 40ms (0.25px/ms, under a flick), then a pause
// before the release, so only the distance decides.
async function slowDrag(page: Page, from: At, dy: number, opts: { release?: boolean } = {}) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  const n = Math.max(1, Math.ceil(Math.abs(dy) / 10))
  for (let i = 1; i <= n; i++) {
    await page.mouse.move(from.x, from.y + (dy * i) / n)
    await page.waitForTimeout(40)
  }
  await page.waitForTimeout(150)
  if (opts.release !== false) await page.mouse.up()
}

function backdropOpacity(dialog: Locator) {
  return dialog.evaluate((el) => Number(getComputedStyle(el, '::backdrop').opacity))
}

function translateYOf(transform: string): number {
  const m = /translateY\((-?[\d.]+)px\)/.exec(transform)
  return m ? Number(m[1]) : 0
}

// Every click the document sees from now on: whether it was inside the
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

const clicks = (page: Page) => page.evaluate(() => (window as Window & { inViewer?: boolean[] }).inViewer)

async function open(page: Page, opts: { alt?: string } = {}) {
  await openTimeline(page, opts)
  const v = viewer(page)
  await v.thumb.click()
  await opened(page)
  const stage = (await v.stage.boundingBox())!
  return { v, c: await centerOf(v.image), height: stage.height }
}

test('a mouse drag past a fifth of the stage closes the viewer; focus goes back, and no click reaches the page', async ({ page }) => {
  const { v, c, height } = await open(page)
  await recordClicks(page)
  await slowDrag(page, c, height * 0.25)
  await expect(v.dialog).toBeHidden()
  await expect(v.thumb).toBeFocused()
  expect(await clicks(page)).not.toContain(false)
  expect(new URL(page.url()).pathname).toBe('/home')
})

test('up works as down', async ({ page }) => {
  const { v, c, height } = await open(page)
  await slowDrag(page, c, -height * 0.25)
  await expect(v.dialog).toBeHidden()
})

test('the image follows the drag and the backdrop fades with the distance; a short drag springs back and stays open', async ({ page }) => {
  const { v, c, height } = await open(page)
  expect(await backdropOpacity(v.dialog)).toBe(1)

  // A quarter of the way to where the dim is gone (half the height).
  await slowDrag(page, c, height * 0.125, { release: false })
  // WebKit puts the mouse on whole pixels.
  expect(Math.abs(translateYOf(await transformOf(v.image)) - height * 0.125)).toBeLessThan(1.5)
  const faded = await backdropOpacity(v.dialog)
  expect(faded).toBeGreaterThan(0.6)
  expect(faded).toBeLessThan(0.85)
  // Further: fainter.
  await page.mouse.move(c.x, c.y + height * 0.18, { steps: 4 })
  expect(await backdropOpacity(v.dialog)).toBeLessThan(faded)

  // Back under the threshold, slowly, and let go.
  await page.mouse.move(c.x, c.y + height * 0.1, { steps: 8 })
  await page.waitForTimeout(150)
  await page.mouse.up()
  await expect.poll(() => transformOf(v.image)).toBe('')
  await expect.poll(() => backdropOpacity(v.dialog)).toBe(1)
  await page.waitForTimeout(400)
  await expect(v.dialog).toBeVisible()
  // The keys still work.
  await page.keyboard.press('+')
  await expect.poll(async () => scaleOf(await transformOf(v.image))).toBe(1.5)
  await page.keyboard.press('Escape')
  await expect(v.dialog).toBeHidden()
})

// A drag sent as pointer events from inside the page, each step `ms` after
// the one before, so its speed does not depend on how fast the test talks
// to the browser. `type` is the pointer type the browser would send.
type Step = { dy: number; ms: number }
async function timedDrag(target: Locator, from: At, steps: Step[], type = 'mouse') {
  await target.evaluate(async (el, { from, steps, type }) => {
    const send = (name: string, y: number) => el.dispatchEvent(new PointerEvent(name, {
      pointerId: 1, pointerType: type, isPrimary: true, button: 0, buttons: name === 'pointerup' ? 0 : 1,
      clientX: from.x, clientY: y, bubbles: true, composed: true, cancelable: true,
    }))
    send('pointerdown', from.y)
    for (const s of steps) {
      await new Promise((r) => setTimeout(r, s.ms))
      send('pointermove', from.y + s.dy)
    }
    send('pointerup', from.y + (steps.at(-1)?.dy ?? 0))
  }, { from, steps, type })
}

test('a flick closes the viewer at a short distance; a flick back toward the start does not', async ({ page }) => {
  const { v, c, height } = await open(page)
  // Slowly past the threshold, then fast back toward the start, still past
  // it: the flick back keeps the viewer.
  const out = height * 0.4
  // About 10px every 30ms: slower than a flick.
  const n = Math.ceil(out / 10)
  const slow = Array.from({ length: n }, (_, i) => ({ dy: (out * (i + 1)) / n, ms: 30 }))
  await timedDrag(v.image, c, [...slow, { dy: out - 20, ms: 8 }, { dy: out - 40, ms: 8 }])
  expect(out - 40).toBeGreaterThan(height * 0.2)
  await expect.poll(() => transformOf(v.image)).toBe('')
  await page.waitForTimeout(400)
  await expect(v.dialog).toBeVisible()

  // 60px, fast, and let go at once: a flick, well short of the threshold.
  expect(60).toBeLessThan(height * 0.2)
  await timedDrag(v.image, c, [{ dy: 20, ms: 8 }, { dy: 40, ms: 8 }, { dy: 60, ms: 8 }])
  await expect(v.dialog).toBeHidden()
  await expect(v.thumb).toBeFocused()
})

test('the same drag, slow, is not a flick: it springs back', async ({ page }) => {
  const { v, c } = await open(page)
  await timedDrag(v.image, c, [{ dy: 20, ms: 60 }, { dy: 40, ms: 60 }, { dy: 60, ms: 60 }])
  await expect.poll(() => transformOf(v.image)).toBe('')
  await page.waitForTimeout(400)
  await expect(v.dialog).toBeVisible()
})

test('zoomed, a drag pans the image and never closes the viewer', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const { v, c, height } = await open(page)
  await page.keyboard.press('+')
  await page.keyboard.press('+')
  await expect.poll(async () => scaleOf(await transformOf(v.image))).toBe(2.25)
  const zoomed = await transformOf(v.image)
  await slowDrag(page, c, height * 0.4)
  await page.mouse.move(c.x, c.y)
  await page.mouse.down()
  await page.mouse.move(c.x, c.y - 60, { steps: 3 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  await expect(v.dialog).toBeVisible()
  const panned = await transformOf(v.image)
  expect(panned).not.toBe(zoomed)
  expect(scaleOf(panned)).toBe(2.25)
  expect(panned).not.toContain('translateY')
  expect(await backdropOpacity(v.dialog)).toBe(1)
})

test('reduced motion: no spring and no fly-out; it snaps back or closes at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const { v, c, height } = await open(page)
  const durations = () => v.dialog.evaluate((el) => {
    const img = el.querySelector('.stage img')!
    return [getComputedStyle(img).transitionDuration, getComputedStyle(el, '::backdrop').transitionDuration]
  })
  await slowDrag(page, c, height * 0.1)
  // Back at once, nothing eases.
  expect(await transformOf(v.image)).toBe('')
  expect(await backdropOpacity(v.dialog)).toBe(1)
  expect(await durations()).toEqual(['0s', '0s'])
  await expect(v.dialog).toBeVisible()

  await slowDrag(page, c, height * 0.3, { release: false })
  await page.mouse.up()
  // No fly-out: it closes on the next task.
  await expect(v.dialog).toBeHidden({ timeout: 150 })
  await expect(v.thumb).toBeFocused()
})

test('a long description scrolls on its own; a drag on the image is a swipe, not a scroll', async ({ page }) => {
  const alt = Array(12).fill(LONG_ALT).join(' ')
  const { v, c, height } = await open(page, { alt })
  const p = v.dialog.locator('p')
  const box = await p.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight, tab: el.getAttribute('tabindex') }))
  expect(box.scroll).toBeGreaterThan(box.client)
  // It scrolls, so a keyboard can reach it.
  expect(box.tab).toBe('0')
  expect(await p.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto')

  // The wheel over it scrolls it, not the page, and the viewer stays.
  const pb = (await p.boundingBox())!
  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2)
  await page.mouse.wheel(0, 200)
  await expect.poll(() => p.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await expect(v.dialog).toBeVisible()

  // The keyboard scrolls it too.
  await p.evaluate((el) => { el.scrollTop = 0 })
  await p.focus()
  await page.keyboard.press('PageDown')
  await expect.poll(() => p.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)

  // The image still swipes the viewer away.
  await slowDrag(page, c, height * 0.25)
  await expect(v.dialog).toBeHidden()
})

test('a short description is not a scroller or a tab stop', async ({ page }) => {
  const { v } = await open(page)
  expect(await v.dialog.locator('p').getAttribute('tabindex')).toBeNull()
})

test.describe('on a touch screen', () => {
  // Real touch through Chromium's input pipeline.
  test.skip(({ browserName }) => browserName !== 'chromium', 'CDP touch input is Chromium only')
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

  async function touchOpen(page: Page, alt?: string) {
    await openTimeline(page, alt ? { alt } : {})
    const v = viewer(page)
    await v.thumb.tap()
    await opened(page)
    const cdp = await page.context().newCDPSession(page)
    const stage = (await v.stage.boundingBox())!
    return { v, cdp, c: await centerOf(v.image), height: stage.height }
  }

  type Finger = { x: number; y: number; id: number }
  const touch = (cdp: Awaited<ReturnType<typeof touchOpen>>['cdp'], type: string, touchPoints: Finger[]) =>
    cdp.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints })

  test('a finger swipe past the threshold closes the viewer and focus goes back; a short one springs back', async ({ page }) => {
    const { v, cdp, c, height } = await touchOpen(page)
    const slide = async (dy: number) => {
      await touch(cdp, 'touchStart', [{ x: c.x, y: c.y, id: 1 }])
      for (let i = 1; i <= 10; i++) {
        await touch(cdp, 'touchMove', [{ x: c.x, y: c.y + (dy * i) / 10, id: 1 }])
        await page.waitForTimeout(30)
      }
      await page.waitForTimeout(150)
      await touch(cdp, 'touchEnd', [])
    }
    // Short: it springs back, and the strips come back with the dim.
    await slide(height * 0.1)
    await expect.poll(() => transformOf(v.image)).toBe('')
    await expect.poll(() => backdropOpacity(v.dialog)).toBe(1)
    await expect(v.dialog).toBeVisible()

    await slide(height * 0.25)
    await expect(v.dialog).toBeHidden()
    await expect(v.thumb).toBeFocused()
  })

  test('the edge strips fade with the backdrop during a swipe', async ({ page }) => {
    const { v, cdp, c, height } = await touchOpen(page)
    await touch(cdp, 'touchStart', [{ x: c.x, y: c.y, id: 1 }])
    for (let i = 1; i <= 5; i++) {
      await touch(cdp, 'touchMove', [{ x: c.x, y: c.y + (height * 0.15 * i) / 5, id: 1 }])
      await page.waitForTimeout(30)
    }
    const edge = await v.dialog.locator('.edge').first().evaluate((el) => Number(getComputedStyle(el).opacity))
    const backdrop = await backdropOpacity(v.dialog)
    expect(backdrop).toBeLessThan(1)
    expect(edge).toBeCloseTo(backdrop, 5)
    await touch(cdp, 'touchEnd', [])
  })

  test('a second finger during a swipe cancels it and starts a pinch', async ({ page }) => {
    const { v, cdp, c } = await touchOpen(page)
    await touch(cdp, 'touchStart', [{ x: c.x, y: c.y, id: 1 }])
    for (let i = 1; i <= 4; i++) {
      await touch(cdp, 'touchMove', [{ x: c.x, y: c.y + 15 * i, id: 1 }])
      await page.waitForTimeout(30)
    }
    expect(translateYOf(await transformOf(v.image))).toBeGreaterThan(40)
    expect(await backdropOpacity(v.dialog)).toBeLessThan(1)

    // A second finger: the image goes back to its place at once, the dim
    // eases back, and the two fingers pinch.
    const y = c.y + 60
    await touch(cdp, 'touchStart', [{ x: c.x, y, id: 1 }, { x: c.x + 40, y, id: 2 }])
    expect(await transformOf(v.image)).toBe('')
    await expect.poll(() => backdropOpacity(v.dialog)).toBe(1)
    for (let d = 50; d <= 120; d += 10) {
      await touch(cdp, 'touchMove', [{ x: c.x - (d - 40) / 2, y, id: 1 }, { x: c.x + 40 + (d - 40) / 2, y, id: 2 }])
    }
    await touch(cdp, 'touchEnd', [])
    await expect.poll(async () => scaleOf(await transformOf(v.image))).toBeGreaterThan(2)
    await page.waitForTimeout(400)
    await expect(v.dialog).toBeVisible()
  })

  test('a finger on a long description scrolls it, and the viewer stays', async ({ page }) => {
    const { v, cdp } = await touchOpen(page, Array(12).fill(LONG_ALT).join(' '))
    const p = v.dialog.locator('p')
    const pb = (await p.boundingBox())!
    const x = pb.x + pb.width / 2
    const y = pb.y + pb.height - 10
    await touch(cdp, 'touchStart', [{ x, y, id: 1 }])
    for (let i = 1; i <= 8; i++) {
      await touch(cdp, 'touchMove', [{ x, y: y - 10 * i, id: 1 }])
      await page.waitForTimeout(20)
    }
    await touch(cdp, 'touchEnd', [])
    await expect.poll(() => p.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
    await page.waitForTimeout(400)
    await expect(v.dialog).toBeVisible()
    expect(await transformOf(v.image)).toBe('')
  })
})
