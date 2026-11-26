import type { Locator } from '@playwright/test'
import { expect, test, type Page } from './_fixtures.js'
import { centerOf, opened, openTimeline, scaleOf, transformOf, viewer } from './_media-viewer.js'

// Swipe to dismiss on a phone (iPhone 15, WebKit). Playwright can tap in
// WebKit but cannot drag a finger, so the drags are touch pointer events
// sent to the image from inside the page, as WebKit sends them, each step
// after a set time so the speed is known. Real touch drags run in Chromium
// (media-viewer-swipe.spec.ts, "on a touch screen").

type Step = { id: number; dy: number; dx?: number; type?: 'pointerdown' | 'pointermove' | 'pointerup'; ms?: number }

function fingers(target: Locator, from: { x: number; y: number }, steps: Step[]) {
  return target.evaluate(async (el, { from, steps }) => {
    for (const s of steps) {
      if (s.ms) await new Promise((r) => setTimeout(r, s.ms))
      const type = s.type ?? 'pointermove'
      el.dispatchEvent(new PointerEvent(type, {
        pointerId: s.id, pointerType: 'touch', isPrimary: s.id === 1,
        clientX: from.x + (s.dx ?? 0), clientY: from.y + s.dy,
        bubbles: true, composed: true, cancelable: true, buttons: type === 'pointerup' ? 0 : 1,
      }))
    }
  }, { from, steps })
}

// One finger, about 10px every 30ms (slower than a flick), a pause, then up.
function slowSwipe(dy: number, opts: { release?: boolean } = {}): Step[] {
  const n = Math.max(1, Math.ceil(Math.abs(dy) / 10))
  const moves = Array.from({ length: n }, (_, i) => ({ id: 1, dy: (dy * (i + 1)) / n, ms: 30 }))
  const up: Step[] = opts.release === false ? [] : [{ id: 1, dy, type: 'pointerup', ms: 150 }]
  return [{ id: 1, dy: 0, type: 'pointerdown' }, ...moves, ...up]
}

function opacityOf(dialog: Locator) {
  return dialog.evaluate((el) => ({
    backdrop: Number(getComputedStyle(el, '::backdrop').opacity),
    edge: Number(getComputedStyle(el.querySelector('.edge')!).opacity),
  }))
}

async function open(page: Page) {
  await openTimeline(page)
  const v = viewer(page)
  await v.thumb.tap()
  await opened(page)
  return { v, c: await centerOf(v.image), height: (await v.stage.boundingBox())!.height }
}

test('a swipe past a fifth of the stage closes the viewer and focus goes back to the thumbnail', async ({ page }) => {
  const { v, c, height } = await open(page)
  await fingers(v.image, c, slowSwipe(height * 0.25))
  await expect(v.dialog).toBeHidden()
  await expect(v.thumb).toBeFocused()
})

test('during a swipe the image follows the finger and the backdrop and edge strips fade; a short one springs back', async ({ page }) => {
  const { v, c, height } = await open(page)
  await fingers(v.image, c, slowSwipe(height * 0.15, { release: false }))
  expect(await transformOf(v.image)).toMatch(/^translateY\(/)
  const during = await opacityOf(v.dialog)
  expect(during.backdrop).toBeLessThan(1)
  expect(during.backdrop).toBeGreaterThan(0)
  expect(during.edge).toBeCloseTo(during.backdrop, 5)

  await fingers(v.image, c, [{ id: 1, dy: height * 0.15, type: 'pointerup', ms: 150 }])
  await expect.poll(() => transformOf(v.image)).toBe('')
  await expect.poll(async () => (await opacityOf(v.dialog)).backdrop).toBe(1)
  await page.waitForTimeout(400)
  await expect(v.dialog).toBeVisible()
})

test('zoomed, one finger pans and does not close; a second finger during a swipe starts a pinch instead', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const { v, c, height } = await open(page)
  // A swipe, then a second finger: the image goes back and the two pinch.
  await fingers(v.image, c, [
    ...slowSwipe(60, { release: false }),
    { id: 2, dy: 60, dx: 40, type: 'pointerdown' },
  ])
  expect(await transformOf(v.image)).toBe('')
  await fingers(v.image, c, [
    { id: 1, dy: 60, dx: -40 }, { id: 2, dy: 60, dx: 80 },
    { id: 1, dy: 60, dx: -80 }, { id: 2, dy: 60, dx: 120 },
    { id: 1, dy: 60, type: 'pointerup', dx: -80 }, { id: 2, dy: 60, dx: 120, type: 'pointerup' },
  ])
  // 40px apart to 200px: 5x, capped at the zoom's maximum.
  await expect.poll(async () => scaleOf(await transformOf(v.image))).toBeGreaterThan(2)
  const zoomed = await transformOf(v.image)

  // Zoomed, a long drag pans.
  await fingers(v.image, c, slowSwipe(height * 0.4))
  await page.waitForTimeout(400)
  await expect(v.dialog).toBeVisible()
  const panned = await transformOf(v.image)
  expect(panned).not.toBe(zoomed)
  expect(panned).not.toContain('translateY')
  expect(scaleOf(panned)).toBe(scaleOf(zoomed))
  expect((await opacityOf(v.dialog)).backdrop).toBe(1)
})
