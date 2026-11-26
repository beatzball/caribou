import type { CDPSession } from '@playwright/test'
import { expect, test, type Page } from './_fixtures.js'
import { LIGHT_THEME_COLOR, THEME_COLOR } from '../../server/lib/brand-head.js'
import { opened, openTimeline, viewer } from './_media-viewer.js'

// On a phone the browser's own bars (the status bar, the address bar) sit
// outside the page, so the viewer's backdrop cannot paint them. Safari 26
// colors them from a fixed element at the middle of each edge of the page;
// older Safari and Chrome from the theme-color meta. So while the viewer is
// open, a strip at the top and bottom edges and the theme-color both show
// the dim over the page color. These tests run in Chromium at a phone size,
// with touch: Firefox has no isMobile, and safe areas need Chromium's CDP.

type Rgb = [number, number, number]

const PREFS = 'caribou.prefs.alice@example.social'
const PAGE = { light: LIGHT_THEME_COLOR, dark: THEME_COLOR } as const
const PHONE = { width: 390, height: 844 }

// Black at `alpha` over a `#rrggbb` color: what the backdrop's tint makes of
// the page color. Worked out here on its own, not with the app's helper.
function dim(hex: string, alpha: number): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return [n >> 16, (n >> 8) & 255, n & 255].map((c) => c * (1 - alpha)) as Rgb
}

function near(actual: number[], expected: Rgb, tolerance = 2) {
  for (let i = 0; i < 3; i++) expect(Math.abs(actual[i]! - expected[i]!), `${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance)
}

const sum = (rgb: number[]) => rgb[0]! + rgb[1]! + rgb[2]!

async function setTheme(page: Page, theme: 'light' | 'dark' | 'system') {
  await page.addInitScript(([key, theme]) => localStorage.setItem(key!, JSON.stringify({ theme })), [PREFS, theme])
}

const themeColor = (page: Page) => page.locator('meta[name="theme-color"]').getAttribute('content')

// A #rrggbb meta value, within one step of `rgb` (rounding).
async function expectBars(page: Page, rgb: Rgb) {
  const hex = await themeColor(page)
  expect(hex).toMatch(/^#[0-9a-f]{6}$/)
  const n = parseInt(hex!.slice(1), 16)
  near([n >> 16, (n >> 8) & 255, n & 255], rgb, 1)
}

// The screen's pixels at these CSS points, from a real screenshot.
async function pixels(page: Page, points: Array<{ x: number; y: number }>): Promise<number[][]> {
  const png = (await page.screenshot({ scale: 'css' })).toString('base64')
  return page.evaluate(async ({ png, points }) => {
    const img = new Image()
    img.src = `data:image/png;base64,${png}`
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    return points.map((p) => Array.from(ctx.getImageData(p.x, p.y, 1, 1).data.slice(0, 3)))
  }, { png, points })
}

function corners(size: { width: number; height: number }) {
  return [
    { x: 1, y: 1 }, { x: size.width - 2, y: 1 },
    { x: 1, y: size.height - 2 }, { x: size.width - 2, y: size.height - 2 },
  ]
}

async function safeArea(cdp: CDPSession, insets: { top: number; right: number; bottom: number; left: number }) {
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets })
}

test.describe('on a phone', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
  test.skip(({ browserName }) => browserName !== 'chromium', 'isMobile and the safe-area override are Chromium only')

  for (const theme of ['light', 'dark'] as const) {
    test(`${theme}: strips at the top and bottom edges and the theme-color take the dim while open, and the dim reaches all four corners`, async ({ page }) => {
      await setTheme(page, theme)
      await openTimeline(page)
      const v = viewer(page)
      const bars = dim(PAGE[theme], 0.55)
      expect(await themeColor(page)).toBe(PAGE[theme])
      const before = await pixels(page, corners(PHONE))

      await v.thumb.click()
      await opened(page)

      // Two strips, fixed to the window's top and bottom edges, the full
      // width, 12px deep.
      const edges = v.dialog.locator('.edge')
      await expect(edges).toHaveCount(2)
      const top = (await edges.nth(0).boundingBox())!
      const bottom = (await edges.nth(1).boundingBox())!
      expect(top).toEqual({ x: 0, y: 0, width: PHONE.width, height: 12 })
      expect(bottom).toEqual({ x: 0, y: PHONE.height - 12, width: PHONE.width, height: 12 })
      expect(await edges.nth(0).getAttribute('aria-hidden')).toBe('true')
      expect(await edges.nth(0).evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none')

      // The browser's bars get the dim over the page color.
      await expectBars(page, bars)

      // On screen, the middle of each edge (where Safari looks) is that
      // color too: the strips paint, and nothing covers them.
      const [topMid, bottomMid] = await pixels(page, [
        { x: PHONE.width / 2, y: 4 }, { x: PHONE.width / 2, y: PHONE.height - 5 },
      ])
      near(topMid!, bars)
      near(bottomMid!, bars)

      // The dialog fills the window, and the dim covers every corner.
      expect(await v.dialog.boundingBox()).toEqual({ x: 0, y: 0, ...PHONE })
      const after = await pixels(page, corners(PHONE))
      after.forEach((px, i) => expect(sum(px), `corner ${i}: ${px} vs ${before[i]}`).toBeLessThan(sum(before[i]!)))

      // Close: the strips go, the bars get the page color back, and focus
      // goes back to the thumbnail.
      await v.close.click()
      await expect(v.dialog).toBeHidden()
      await expect(edges).toHaveCount(0)
      expect(await themeColor(page)).toBe(PAGE[theme])
      await expect(v.thumb).toBeFocused()
    })
  }

  test('a theme change while open dims the new theme, and close leaves the new theme color', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await setTheme(page, 'system')
    await openTimeline(page)
    const v = viewer(page)
    await v.thumb.click()
    await opened(page)
    await expectBars(page, dim(PAGE.dark, 0.55))

    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    // The theme sets data-theme and then the meta, in one go.
    await expectBars(page, dim(PAGE.light, 0.55))
    const [topMid] = await pixels(page, [{ x: PHONE.width / 2, y: 4 }])
    near(topMid!, dim(PAGE.light, 0.55))

    // Escape closes it as well.
    await page.keyboard.press('Escape')
    await expect(v.dialog).toBeHidden()
    expect(await themeColor(page)).toBe(PAGE.light)
  })

  test('with reduced transparency the strips and the theme-color take the 85% dim, as the backdrop does', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
    })
    await setTheme(page, 'light')
    await openTimeline(page)
    const v = viewer(page)
    await v.thumb.click()
    await opened(page)
    const tint = await v.dialog.evaluate((el) => getComputedStyle(el, '::backdrop').backgroundColor)
    expect(tint).toBe('rgba(0, 0, 0, 0.85)')
    await expectBars(page, dim(PAGE.light, 0.85))
    const [topMid, bottomMid] = await pixels(page, [
      { x: PHONE.width / 2, y: 4 }, { x: PHONE.width / 2, y: PHONE.height - 5 },
    ])
    near(topMid!, dim(PAGE.light, 0.85))
    near(bottomMid!, dim(PAGE.light, 0.85))
  })

  test('Close and the description stay inside the safe area, in portrait and landscape', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page)
    // Portrait: the status bar and Dynamic Island above, the home
    // indicator below.
    const portrait = { top: 59, right: 0, bottom: 34, left: 0 }
    await safeArea(cdp, portrait)
    await openTimeline(page)
    const v = viewer(page)
    await v.thumb.click()
    await opened(page)
    const description = v.dialog.locator('p')

    const inside = async (size: { width: number; height: number }, insets: typeof portrait) => {
      for (const el of [v.close, description, v.stage]) {
        const box = (await el.boundingBox())!
        expect(box.y, 'top').toBeGreaterThanOrEqual(insets.top)
        expect(box.x, 'left').toBeGreaterThanOrEqual(insets.left)
        expect(box.x + box.width, 'right').toBeLessThanOrEqual(size.width - insets.right)
        expect(box.y + box.height, 'bottom').toBeLessThanOrEqual(size.height - insets.bottom)
      }
      // The strips still reach the very edges, under the bars.
      const edges = v.dialog.locator('.edge')
      expect((await edges.nth(0).boundingBox())!.y).toBe(0)
      const bottom = (await edges.nth(1).boundingBox())!
      expect(bottom.y + bottom.height).toBe(size.height)
    }
    await inside(PHONE, portrait)
    // 2.5% of the height is less than the inset: the inset wins, plus 12px.
    expect((await v.dialog.locator('.bar').boundingBox())!.y).toBe(portrait.top + 12)

    // Landscape: the notch on one side, the home indicator below.
    const wide = { width: PHONE.height, height: PHONE.width }
    const landscape = { top: 0, right: 59, bottom: 21, left: 59 }
    await page.setViewportSize(wide)
    await safeArea(cdp, landscape)
    await expect.poll(async () => (await v.close.boundingBox())!.x + (await v.close.boundingBox())!.width)
      .toBeLessThanOrEqual(wide.width - landscape.right)
    await inside(wide, landscape)
  })
})
