import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { ALICE, installFixtureAuth, loopbackOrigin, type XrpcAnswer } from './_bluesky-auth.js'

// Bluesky notifications through the real SDK and the fixture PDS
// (`_bluesky-auth.ts`): the list groups on the client and skips a reason it
// does not know, the badge is the server's count, and updateSeen is sent
// once, when the list is on screen (state README, "Notifications").

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/bluesky-client/src/__fixtures__')
const read = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Record<string, unknown>
const NOTIFICATIONS = read('notifications-page.json')
const BASE_POST = (read('feed-page.json').feed as { post: Record<string, unknown> }[])[0]!.post

// The SDK checks every answer against the lexicon, so the CID is a real one.
const CID = 'bafyreidsemiehpaya7tpoqfsgxvxkepmwmzfljvdovbvmmiznxuks5injm'

function postView(uri: string) {
  return { ...BASE_POST, uri, cid: CID, $type: 'app.bsky.feed.defs#postView' }
}

interface Pds {
  unread: number
  seen: string[]
  answer: XrpcAnswer
}

function fixturePds(): Pds {
  const pds: Pds = {
    unread: 2,
    seen: [],
    answer: (method, url, body) => {
      switch (method) {
        case 'app.bsky.notification.listNotifications':
          // One page; the cursor's page is the end.
          return { body: url.searchParams.get('cursor') ? { notifications: [] } : NOTIFICATIONS }
        case 'app.bsky.notification.getUnreadCount':
          return { body: { count: pds.unread } }
        case 'app.bsky.notification.updateSeen':
          pds.seen.push((JSON.parse(body ?? '{}') as { seenAt: string }).seenAt)
          pds.unread = 0
          return { body: {} }
        case 'app.bsky.feed.getPosts':
          return { body: { posts: url.searchParams.getAll('uris').map(postView) } }
        default:
          return undefined
      }
    },
  }
  return pds
}

async function signIn(page: Page, origin: string) {
  await page.addInitScript(() => localStorage.setItem('caribou.flag.bluesky', '1'))
  await page.goto(`${origin}/`)
  await page.getByRole('tab', { name: 'Bluesky' }).click()
  await page.getByLabel('Bluesky handle').fill('alice.example.com')
  await page.getByRole('tabpanel', { name: 'Bluesky' }).getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(`${origin}/home`)
}

test.describe('Bluesky notifications', () => {
  // As in bluesky-signin.spec.ts: Playwright WebKit on macOS hangs storing
  // the SDK's DPoP key in IndexedDB. CI runs WebKit on Linux.
  test.skip(({ browserName }) => browserName === 'webkit' && process.platform === 'darwin',
    'Playwright WebKit on macOS hangs storing a CryptoKey in IndexedDB')

  test('the badge, the grouped list, and updateSeen sent once', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    const pds = fixturePds()
    await installFixtureAuth(page, { xrpc: pds.answer })
    await signIn(page, origin)

    const rail = page.locator('page-home caribou-nav-rail')
    await expect(rail.getByRole('link', { name: /^Notifications ?, 2 unread$/ })).toBeVisible()

    await rail.getByRole('link', { name: /^Notifications/ }).click()
    await expect(page).toHaveURL(/\/notifications$/)
    const list = page.locator('page-notifications caribou-notifications')
    const rows = list.locator('ul.rows > li')
    // Like, reply, follow, repost; the `verified` one is skipped.
    await expect(rows).toHaveCount(4)
    await expect(rows.nth(0).locator('.line')).toContainText('Bob liked your post')
    await expect(rows.nth(0).getByRole('link', { name: 'Bob' })).toHaveAttribute('href', '/@bob.example.com')
    await expect(rows.nth(1)).toHaveClass(/n-mention/)
    await expect(rows.nth(2).locator('.line')).toContainText('dave.example.com followed you')
    await expect(rows.nth(3).locator('.line')).toContainText('Bob reposted your post')

    // Seen up to the newest time read; the badge goes.
    await expect.poll(() => pds.seen).toEqual(['2026-11-07T12:00:00.000Z'])
    const nextRail = page.locator('page-notifications caribou-nav-rail')
    await expect(nextRail.locator('.badge')).toHaveCount(0)

    // A reload shows the same list and does not send it again.
    await page.reload()
    await expect(page.locator('page-notifications caribou-notifications ul.rows > li')).toHaveCount(4)
    await page.waitForLoadState('networkidle')
    expect(pds.seen).toHaveLength(1)
    const prefs = await page.evaluate((key) => localStorage.getItem(`caribou.prefs.${key}`), `${ALICE}@bsky`)
    expect(JSON.parse(prefs!)).toMatchObject({ lastSeenNotificationAt: '2026-11-07T12:00:00.000Z' })
  })
})
