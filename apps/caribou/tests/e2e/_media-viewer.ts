import type { Locator } from '@playwright/test'
import { expect, type Page } from './_fixtures.js'

// A signed-in home timeline with one post that has one image, for the
// media viewer's zoom tests.

const INSTANCE = 'example.social'
export const FILES = `https://files.${INSTANCE}`

const ACCOUNT = {
  id: 'a1', username: 'alice', acct: 'alice', display_name: 'Alice Example',
  avatar: '', avatar_static: '',
  url: `https://${INSTANCE}/@alice`, header: '', header_static: '', note: '',
  followers_count: 0, following_count: 0, statuses_count: 1, locked: false, bot: false,
  discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}

const STATUS = {
  id: 'a', uri: `https://${INSTANCE}/@alice/a`, url: `https://${INSTANCE}/@alice/a`,
  created_at: '2024-01-01T00:00:00.000Z', account: ACCOUNT, content: '<p>post a</p>',
  visibility: 'public', sensitive: false, spoiler_text: '',
  media_attachments: [{
    id: 'm1', type: 'image', url: `${FILES}/m1.svg`, preview_url: `${FILES}/m1-small.svg`,
    remote_url: null, description: 'A green field', blurhash: null,
    meta: { small: { width: 400, height: 300, size: '400x300', aspect: 4 / 3 } },
  }],
  mentions: [], tags: [], emojis: [],
  reblogs_count: 0, favourites_count: 0, replies_count: 0,
  favourited: false, reblogged: false, bookmarked: false, language: 'en',
}

// A 4:3 picture with a size of its own, so the viewer gives it a real box.
const PICTURE = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">'
  + '<rect width="800" height="600" fill="#2f7d4a"/><circle cx="400" cy="300" r="120" fill="#f4d35e"/></svg>'

export async function openTimeline(page: Page) {
  const session = {
    userKey: `alice@${INSTANCE}`, server: INSTANCE, token: 'TOKEN', vapidKey: '',
    account: ACCOUNT, createdAt: 1,
  }
  await page.addInitScript((data) => {
    localStorage.setItem('caribou.users', JSON.stringify([[data.userKey, data]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(data.userKey))
  }, session)
  await page.route(`${FILES}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: PICTURE }))
  await page.route('**/api/v1/timelines/home*', (route) => {
    const u = new URL(route.request().url())
    const body = u.searchParams.get('since_id') || u.searchParams.get('max_id') ? [] : [STATUS]
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto('/home')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

export function viewer(page: Page) {
  const media = page.locator('caribou-status-media')
  const dialog = media.locator('dialog')
  const stage = dialog.locator('.stage')
  return {
    thumb: media.getByRole('link', { name: 'Open image: A green field' }),
    dialog,
    stage,
    image: stage.locator('img'),
    close: dialog.getByRole('button', { name: 'Close' }),
  }
}

// The image's own transform, as the viewer wrote it.
export function transformOf(image: Locator): Promise<string> {
  return image.evaluate((img: HTMLImageElement) => img.style.transform)
}

export function scaleOf(transform: string): number {
  const m = /scale\(([\d.]+)\)/.exec(transform)
  return m ? Number(m[1]) : 1
}

export async function centerOf(loc: Locator): Promise<{ x: number; y: number }> {
  const box = (await loc.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

// The page's own zoom: 1 unless the browser zoomed the page.
export function pageScale(page: Page): Promise<number> {
  return page.evaluate(() => window.visualViewport?.scale ?? 1)
}

// Wait until the image has loaded and has a box.
export async function opened(page: Page) {
  const v = viewer(page)
  await expect(v.dialog).toBeVisible()
  await expect.poll(() => v.image.evaluate((img: HTMLImageElement) => img.complete && img.offsetWidth > 0)).toBe(true)
  return v
}
