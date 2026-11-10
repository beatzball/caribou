import { existsSync, readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'

// The tiny HLS stream in `fixtures/hls/` (how it is made: `make.sh` there),
// served in place of video.bsky.app (#261). Every request under that host is
// answered by the last part of its path: `playlist.m3u8` (Bluesky's main
// playlist), `video.m3u8`, `seg0.m2ts`, `seg1.m2ts`, and `thumbnail.jpg`.

const VIDEO_HOST = 'https://video.bsky.app'
const DIR = new URL('./fixtures/hls/', import.meta.url)
const TYPES: Record<string, string> = { m3u8: 'application/vnd.apple.mpegurl', m2ts: 'video/mp2t' }

// A 1×1 PNG for the thumbnail.
export const THUMB_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

// Returns the file names asked for, in order.
export async function routeHlsFixture(page: Page): Promise<string[]> {
  const served: string[] = []
  await page.route(`${VIDEO_HOST}/**`, (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop() ?? ''
    served.push(name)
    const cors = { 'access-control-allow-origin': '*' }
    if (name === 'thumbnail.jpg') return route.fulfill({ status: 200, contentType: 'image/png', body: THUMB_BYTES })
    const type = TYPES[name.split('.').pop() ?? '']
    const file = new URL(name, DIR)
    if (!type || !/^[\w.]+$/.test(name) || !existsSync(file)) {
      return route.fulfill({ status: 404, headers: cors, body: 'not found' })
    }
    return route.fulfill({ status: 200, headers: cors, contentType: type, body: readFileSync(file) })
  })
  return served
}

// As in a browser with no native HLS (Firefox, older Chromium): hls.js plays.
export async function forceHlsJs(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const real = HTMLMediaElement.prototype.canPlayType
    HTMLMediaElement.prototype.canPlayType = function (type: string) {
      return /mpegurl/i.test(type) ? '' : real.call(this, type)
    }
  })
}

// A new tab opened by a press shows up late (after a keyboard press, more
// than a second later in Chromium). Wait a moment for one before saying
// there was none. `seen` holds the ones that came already.
export async function noNewTab(page: Page, seen: string[]): Promise<string[]> {
  const late = await page.waitForEvent('popup', { timeout: 2_000 }).then((p) => p.url(), () => null)
  return late && !seen.includes(late) ? [...seen, late] : seen
}
