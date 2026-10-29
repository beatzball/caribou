import { readFileSync } from 'node:fs'
import { expect, test, type Page } from './_fixtures.js'

const INSTANCE = 'example.social'
const FILES = `https://files.${INSTANCE}`

const ACCOUNT = {
  id: 'a1', username: 'alice', acct: 'alice', display_name: 'Alice Example',
  avatar: '', avatar_static: '',
  url: `https://${INSTANCE}/@alice`, header: '', header_static: '', note: '',
  followers_count: 0, following_count: 0, statuses_count: 1, locked: false, bot: false,
  discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}

function attachment(id: string, over: Record<string, unknown> = {}) {
  return {
    id, type: 'image', url: `${FILES}/${id}.png`, preview_url: `${FILES}/${id}-small.png`,
    remote_url: null, description: null, blurhash: null,
    meta: { small: { width: 400, height: 200, size: '400x200', aspect: 2 } },
    ...over,
  }
}

function status(id: string, media: unknown[], over: Record<string, unknown> = {}) {
  return {
    id, uri: `https://${INSTANCE}/@alice/${id}`, url: `https://${INSTANCE}/@alice/${id}`,
    created_at: '2024-01-01T00:00:00.000Z', account: ACCOUNT, content: `<p>post ${id}</p>`,
    visibility: 'public', sensitive: false, spoiler_text: '',
    media_attachments: media, mentions: [], tags: [], emojis: [],
    reblogs_count: 0, favourites_count: 0, replies_count: 0,
    favourited: false, reblogged: false, bookmarked: false, language: 'en',
    ...over,
  }
}

// 1×1 transparent PNG.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

async function openHome(page: Page, statuses: unknown[]) {
  await page.route('**/api/v1/timelines/home*', (route) => {
    const u = new URL(route.request().url())
    const body = u.searchParams.get('since_id') || u.searchParams.get('max_id') ? [] : statuses
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto('/home')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}

test.beforeEach(async ({ page }) => {
  const session = {
    userKey: `alice@${INSTANCE}`, server: INSTANCE, token: 'TOKEN', vapidKey: '',
    account: ACCOUNT, createdAt: 1,
  }
  await page.addInitScript((data) => {
    localStorage.setItem('caribou.users', JSON.stringify([[data.userKey, data]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(data.userKey))
  }, session)
})

test('a post with four images shows a grid, an ALT popover, and a lightbox that gives focus back', async ({ page }) => {
  await page.route(`${FILES}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }))
  await openHome(page, [status('a', [
    attachment('m1', { description: 'A red fox in the snow' }),
    attachment('m2'), attachment('m3'), attachment('m4'),
  ])])

  const media = page.locator('caribou-status-media')
  await expect(media.locator('.grid[data-count="4"] .item')).toHaveCount(4)
  await expect(media.locator('img').first()).toHaveAttribute('alt', 'A red fox in the snow')

  // ALT: one badge, a real button; its popover shows the description.
  const alt = media.getByRole('button', { name: /ALT/ })
  await expect(alt).toHaveCount(1)
  await alt.click()
  await expect(media.locator('[popover]')).toBeVisible()
  await expect(media.locator('[popover]')).toHaveText('A red fox in the snow')
  await page.keyboard.press('Escape')
  await expect(media.locator('[popover]')).toBeHidden()

  // Lightbox: Enter on the thumbnail opens the full file; Esc closes it and
  // focus goes back to the thumbnail.
  const thumb = media.getByRole('link', { name: 'Open image: A red fox in the snow' })
  await thumb.focus()
  await page.keyboard.press('Enter')
  const dialog = media.locator('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('img')).toHaveAttribute('src', `${FILES}/m1.png`)
  await expect(dialog.locator('p')).toHaveText('A red fox in the snow')
  await expect(dialog).toHaveAccessibleName('A red fox in the snow')
  // A click on the dialog's padding, or on the description, leaves it open.
  const box = (await dialog.boundingBox())!
  await page.mouse.click(box.x + 3, box.y + box.height / 2)
  await dialog.locator('p').click()
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(thumb).toBeFocused()

  // The Close button closes it too.
  await media.getByRole('link', { name: 'Open image' }).nth(1).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()

  // A click on the backdrop closes it.
  await media.getByRole('link', { name: 'Open image' }).nth(1).click()
  await expect(dialog).toBeVisible()
  await page.mouse.click(5, 5)
  await expect(dialog).toBeHidden()
  // Still on the timeline: the click did not follow the link.
  expect(new URL(page.url()).pathname).toBe('/home')
})

test('a single image holds its size before the file arrives', async ({ page }) => {
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  await page.route(`${FILES}/**`, async (route) => {
    await held
    await route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })
  })
  await openHome(page, [status('a', [attachment('m1')])])
  const item = page.locator('caribou-status-media .item')
  await expect(item).toHaveCount(1)
  const before = await item.boundingBox()
  expect(before!.height).toBeGreaterThan(0)
  // meta.small is 2:1.
  expect(Math.abs(before!.width / before!.height - 2)).toBeLessThan(0.02)
  release()
  await expect.poll(() => item.locator('img').evaluate((img: HTMLImageElement) => img.complete)).toBe(true)
  expect(await item.boundingBox()).toEqual(before)
})

test('sensitive media stays hidden until the reader shows it, and hides again', async ({ page }) => {
  const requested: string[] = []
  await page.route(`${FILES}/**`, (route) => {
    requested.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })
  })
  await openHome(page, [status('a', [attachment('m1'), attachment('m2')], { sensitive: true })])
  const media = page.locator('caribou-status-media')
  await expect(media.locator('.item')).toHaveCount(2)
  await expect(media.locator('img')).toHaveCount(0)
  expect(requested).toEqual([])

  const show = media.getByRole('button', { name: 'Show sensitive media' })
  await show.focus()
  await page.keyboard.press('Enter')
  await expect(media.locator('img')).toHaveCount(2)
  const hide = media.getByRole('button', { name: 'Hide' })
  await expect(hide).toBeFocused()
  await hide.click()
  await expect(media.locator('img')).toHaveCount(0)
  await expect(show).toBeFocused()
})

// A one-second 16×16 clip, recorded once with MediaRecorder: WebM from
// Chromium, MP4 from WebKit. A 204 would leave the video paused whatever the
// component did, so the test needs a file the browser really plays.
const CLIPS = [
  { type: 'video/webm', body: readFileSync(new URL('./fixtures/gifv.webm', import.meta.url)) },
  { type: 'video/mp4', body: readFileSync(new URL('./fixtures/gifv.mp4', import.meta.url)) },
]

async function pickClip(page: Page): Promise<{ type: string; body: Buffer } | undefined> {
  await page.setContent('<video></video>')
  const types = await page.evaluate((all) => {
    const v = document.querySelector('video')!
    return all.filter((t) => v.canPlayType(t) !== '')
  }, CLIPS.map((c) => c.type))
  return CLIPS.find((c) => types.includes(c.type))
}

test('a gifv plays muted on a loop, pauses on click, and stops under reduced motion', async ({ page }) => {
  const clip = await pickClip(page)
  test.skip(!clip, 'This browser plays neither WebM nor MP4')
  if (!clip) return
  await page.route(`${FILES}/**`, (route) => route.request().url().endsWith('.vid')
    ? route.fulfill({ status: 200, contentType: clip.type, body: clip.body })
    : route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }))
  const gif = attachment('g', { type: 'gifv', url: `${FILES}/g.vid`, description: 'A cat' })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await openHome(page, [status('a', [gif])])

  const toggle = page.locator('caribou-status-media').getByRole('button', { name: 'Play GIF: A cat' })
  const video = toggle.locator('video.gifv')
  await expect(video).toHaveAttribute('loop', '')
  await expect(video).not.toHaveAttribute('controls', /.*/)
  expect(await video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true)
  const playing = () => video.evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0)

  // Plays after mount.
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(playing).toBe(true)

  // The reader can stop it, and start it again, with the keyboard too.
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(playing).toBe(true)

  // Turning on reduced motion stops it.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
})

test('a gifv waits, paused, when the reader already asked for reduced motion', async ({ page }) => {
  const clip = await pickClip(page)
  test.skip(!clip, 'This browser plays neither WebM nor MP4')
  if (!clip) return
  await page.route(`${FILES}/**`, (route) => route.request().url().endsWith('.vid')
    ? route.fulfill({ status: 200, contentType: clip.type, body: clip.body })
    : route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openHome(page, [status('a', [attachment('g', { type: 'gifv', url: `${FILES}/g.vid` })])])
  const toggle = page.locator('caribou-status-media').getByRole('button', { name: 'Play GIF' })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await page.waitForTimeout(300)
  expect(await toggle.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
  // Play on request.
  await toggle.click()
  await expect.poll(() => toggle.locator('video').evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0)).toBe(true)
})
