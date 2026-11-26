import { expect, type Page } from './_fixtures.js'
import { LIGHT_THEME_COLOR, THEME_COLOR } from '../../server/lib/brand-head.js'

// Helpers for the media viewer's edge strips and theme-color
// (media-viewer-edges.spec.ts and media-viewer-edges.mobile.spec.ts).

export type Rgb = [number, number, number]

const PREFS = 'caribou.prefs.alice@example.social'
export const PAGE = { light: LIGHT_THEME_COLOR, dark: THEME_COLOR } as const

// Black at `alpha` over a `#rrggbb` color: what the backdrop's tint makes of
// the page color. Worked out here on its own, not with the app's helper.
export function dim(hex: string, alpha: number): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return [n >> 16, (n >> 8) & 255, n & 255].map((c) => c * (1 - alpha)) as Rgb
}

export function near(actual: number[], expected: Rgb, tolerance = 2) {
  for (let i = 0; i < 3; i++) expect(Math.abs(actual[i]! - expected[i]!), `${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance)
}

export const sum = (rgb: number[]) => rgb[0]! + rgb[1]! + rgb[2]!

export async function setTheme(page: Page, theme: 'light' | 'dark' | 'system') {
  await page.addInitScript(([key, theme]) => localStorage.setItem(key!, JSON.stringify({ theme })), [PREFS, theme])
}

export const themeColor = (page: Page) => page.locator('meta[name="theme-color"]').getAttribute('content')

// A #rrggbb meta value, within one step of `rgb` (rounding).
export async function expectBars(page: Page, rgb: Rgb) {
  const hex = await themeColor(page)
  expect(hex).toMatch(/^#[0-9a-f]{6}$/)
  const n = parseInt(hex!.slice(1), 16)
  near([n >> 16, (n >> 8) & 255, n & 255], rgb, 1)
}

// The screen's pixels at these CSS points, from a real screenshot.
export async function pixels(page: Page, points: Array<{ x: number; y: number }>): Promise<number[][]> {
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

export function corners(size: { width: number; height: number }) {
  return [
    { x: 1, y: 1 }, { x: size.width - 2, y: 1 },
    { x: 1, y: size.height - 2 }, { x: size.width - 2, y: size.height - 2 },
  ]
}
