import { expect, test } from './_fixtures.js'
import { opened, openTimeline, viewer } from './_media-viewer.js'
import { PAGE, dim, expectBars, near, pixels, setTheme, themeColor } from './_media-edges.js'

// The viewer's edge strips and theme-color in WebKit on a phone (iPhone 15),
// the engine they are for. Safari 26 colors its bars from the strips; older
// Safari from the theme-color. The safe-area checks need Chromium's CDP and
// stay in media-viewer-edges.spec.ts.

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: two hidden-from-assistive-tech strips at the top and bottom edges, and the theme-color takes the dim, until close`, async ({ page }) => {
    await setTheme(page, theme)
    await openTimeline(page)
    const v = viewer(page)
    const size = page.viewportSize()!
    expect(await themeColor(page)).toBe(PAGE[theme])

    await v.thumb.tap()
    await opened(page)
    const edges = v.dialog.locator('.edge')
    await expect(edges).toHaveCount(2)
    const top = (await edges.nth(0).boundingBox())!
    const bottom = (await edges.nth(1).boundingBox())!
    expect(top).toEqual({ x: 0, y: 0, width: size.width, height: 12 })
    expect(bottom).toEqual({ x: 0, y: size.height - 12, width: size.width, height: 12 })
    for (const edge of await edges.all()) {
      expect(await edge.getAttribute('aria-hidden')).toBe('true')
      expect(await edge.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none')
    }

    // The bars and the strips show the backdrop's own dim over the page.
    const alpha = await v.dialog.evaluate((el) => {
      const n = getComputedStyle(el, '::backdrop').backgroundColor.match(/[\d.]+/g)!.map(Number)
      return n[3] ?? 1
    })
    expect(alpha).toBe(0.55)
    await expectBars(page, dim(PAGE[theme], alpha))
    const [topMid, bottomMid] = await pixels(page, [
      { x: Math.round(size.width / 2), y: 4 }, { x: Math.round(size.width / 2), y: size.height - 5 },
    ])
    near(topMid!, dim(PAGE[theme], alpha))
    near(bottomMid!, dim(PAGE[theme], alpha))

    await v.close.tap()
    await expect(v.dialog).toBeHidden()
    await expect(edges).toHaveCount(0)
    // The close event, a task after the dialog hides, gives the color back.
    await expect.poll(() => themeColor(page)).toBe(PAGE[theme])
  })
}
