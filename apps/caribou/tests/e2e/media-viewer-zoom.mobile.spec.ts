import type { Locator } from '@playwright/test'
import { expect, test } from './_fixtures.js'
import { centerOf, opened, openTimeline, pageScale, scaleOf, transformOf, viewer } from './_media-viewer.js'

// The media viewer on a phone (iPhone 15, WebKit): a pinch or a double tap
// on the image zooms the image, and the page itself stays at 1x.
//
// Playwright has no two-finger touch for WebKit, so the pinch and double tap
// are pointer events sent to the image, as WebKit sends them for touches.
// The real taps below check that touch input still reaches it.

type Step = { type: string; id: number; x: number; y: number }

function touches(target: Locator, steps: Step[]) {
  return target.evaluate((el: Element, all: Step[]) => {
    for (const s of all) {
      el.dispatchEvent(new PointerEvent(s.type, {
        pointerId: s.id, pointerType: 'touch', isPrimary: s.id === 1,
        clientX: s.x, clientY: s.y, bubbles: true, composed: true, cancelable: true,
        buttons: s.type === 'pointerup' ? 0 : 1,
      }))
    }
  }, steps)
}

test('a pinch zooms the image, not the page, and Close stays in place', async ({ page }) => {
  await openTimeline(page)
  const v = viewer(page)
  await v.thumb.tap()
  await opened(page)

  // Page zoom stays on: only the zoom surface takes the gesture.
  const metas = await page.locator('meta[name="viewport"]').evaluateAll(
    (els) => els.map((e) => e.getAttribute('content') ?? ''))
  expect(metas.at(-1)).not.toMatch(/user-scalable\s*=\s*(no|0)|maximum-scale/)
  expect(await v.stage.evaluate((el) => getComputedStyle(el).touchAction)).toBe('none')
  const closeBox = await v.close.boundingBox()

  const c = await centerOf(v.image)
  await touches(v.image, [
    { type: 'pointerdown', id: 1, x: c.x - 30, y: c.y },
    { type: 'pointerdown', id: 2, x: c.x + 30, y: c.y },
    { type: 'pointermove', id: 1, x: c.x - 60, y: c.y },
    { type: 'pointermove', id: 2, x: c.x + 60, y: c.y },
    { type: 'pointermove', id: 1, x: c.x - 90, y: c.y },
    { type: 'pointermove', id: 2, x: c.x + 90, y: c.y },
    { type: 'pointerup', id: 1, x: c.x - 90, y: c.y },
    { type: 'pointerup', id: 2, x: c.x + 90, y: c.y },
  ])
  // The fingers went from 60px apart to 180px: 3x.
  await expect.poll(async () => scaleOf(await transformOf(v.image))).toBe(3)
  expect(await pageScale(page)).toBe(1)
  expect(await v.close.boundingBox()).toEqual(closeBox)

  // One finger pans the zoomed image.
  const zoomed = await transformOf(v.image)
  await touches(v.image, [
    { type: 'pointerdown', id: 1, x: c.x, y: c.y },
    { type: 'pointermove', id: 1, x: c.x + 40, y: c.y + 40 },
    { type: 'pointerup', id: 1, x: c.x + 40, y: c.y + 40 },
  ])
  await expect.poll(() => transformOf(v.image)).not.toBe(zoomed)
  expect(scaleOf(await transformOf(v.image))).toBe(3)

  // Close resets it: the next open starts at 1x.
  await v.close.tap()
  await expect(v.dialog).toBeHidden()
  await v.thumb.tap()
  await opened(page)
  expect(await transformOf(v.image)).toBe('')
})

test('a double tap toggles 2.5x; a tap on the image keeps the viewer, one on the backdrop closes it', async ({ page }) => {
  await openTimeline(page)
  const v = viewer(page)
  await v.thumb.tap()
  await opened(page)

  const c = await centerOf(v.image)
  const tap = (x: number, y: number): Step[] => [
    { type: 'pointerdown', id: 1, x, y },
    { type: 'pointerup', id: 1, x, y },
  ]
  await touches(v.image, [...tap(c.x + 20, c.y + 10), ...tap(c.x + 22, c.y + 12)])
  await expect.poll(async () => scaleOf(await transformOf(v.image))).toBe(2.5)
  expect(await pageScale(page)).toBe(1)
  await touches(v.image, [...tap(c.x, c.y), ...tap(c.x, c.y)])
  await expect.poll(() => transformOf(v.image)).toBe('')

  // A real tap on the image does not close the viewer.
  await v.image.tap()
  await expect(v.dialog).toBeVisible()
  expect(await pageScale(page)).toBe(1)

  // At 1x a tap on the backdrop does.
  await page.touchscreen.tap(4, 4)
  await expect(v.dialog).toBeHidden()
})
