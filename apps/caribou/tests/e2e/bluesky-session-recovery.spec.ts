import { expect, test, type Page } from '@playwright/test'
import { ALICE, installFixtureAuth, loopbackOrigin, waitForSignedInHome } from './_bluesky-auth.js'

async function signIn(page: Page, origin: string) {
  await page.goto(origin)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.getByRole('tab', { name: 'Bluesky' }).click()
  await page.getByLabel('Bluesky handle').fill('alice.example.com')
  await page.getByRole('tabpanel', { name: 'Bluesky' }).getByRole('button', { name: 'Sign in' }).click()
  await waitForSignedInHome(page, origin)
  await page.waitForLoadState('networkidle')
}

// Expire only the access token, preserving the real SDK's DPoP keys and
// refresh token. No clock jump or live Bluesky account is needed.
async function expireAccess(page: Page) {
  await page.evaluate((did) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('@atproto-oauth-client')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction('session', 'readwrite')
      const store = tx.objectStore('session')
      const get = store.get(did)
      get.onsuccess = () => {
        if (!get.result) { reject(new Error('Fixture session missing')); return }
        const row = get.result
        row.value.tokenSet.expires_at = '2000-01-01T00:00:00.000Z'
        store.put(row, did)
      }
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
    }
  }), ALICE)
}

async function expired(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('caribou.users') ?? '[]')[0]?.[1]?.expired ?? false)
}

test.describe('Bluesky session recovery', () => {
  test.skip(({ browserName }) => browserName === 'webkit' && process.platform === 'darwin',
    'Playwright WebKit on macOS hangs storing a CryptoKey in IndexedDB')

  for (const failure of ['offline', 503] as const) {
    test(`rule 2: challenged 401 with ${failure} refresh keeps the account and retries`, async ({ page, baseURL }) => {
      const origin = loopbackOrigin(baseURL)
      let rejectOld = false
      const auth = await installFixtureAuth(page, { xrpc: (method) => {
        if (rejectOld && method === 'app.bsky.feed.getTimeline') return {
          status: 401, headers: { 'www-authenticate': 'DPoP error="invalid_token"' }, body: { error: 'invalid_token' },
        }
        return undefined
      } })
      await signIn(page, origin)
      auth.refreshFailure = failure
      rejectOld = true
      await page.reload()
      await expect.poll(() => auth.tokenRequests.filter((r) => r.get('grant_type') === 'refresh_token').length).toBeGreaterThan(0)
      await expect(page.locator('caribou-timeline').getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
      expect(await expired(page)).toBe(false)
      await expect(page.getByText('Your Bluesky session ended. Sign in again.')).toHaveCount(0)
      rejectOld = false
      auth.refreshFailure = null
      // The expired access token can now refresh with the retained token.
      await expireAccess(page)
      await page.locator('caribou-timeline').getByRole('button', { name: 'Retry', exact: true }).click()
      await expect.poll(() => auth.pdsCalls.at(-1)?.authorization).toBe(`DPoP access-${ALICE}-2`)
      expect(await expired(page)).toBe(false)
      await expect(page.locator('caribou-timeline').getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0)
    })
  }

  test('rule 1: access token expires during a network outage, then refreshes on retry', async ({ page, context, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    const auth = await installFixtureAuth(page)
    await signIn(page, origin)
    // Begin a failing page load first so its real Retry button is available.
    auth.refreshFailure = 'offline'
    await expireAccess(page)
    await page.reload()
    const retry = page.locator('caribou-timeline').getByRole('button', { name: 'Retry', exact: true })
    await expect(retry).toBeVisible()
    await context.setOffline(true)
    await retry.click()
    await expect(retry).toBeEnabled()
    expect(await page.evaluate(() => navigator.onLine)).toBe(false)
    expect(await expired(page)).toBe(false)
    await context.setOffline(false)
    auth.refreshFailure = null
    await retry.click()
    await expect.poll(() => auth.pdsCalls.at(-1)?.authorization).toBe(`DPoP access-${ALICE}-2`)
    expect(await expired(page)).toBe(false)
  })

  test('rule 3: two tabs refresh one DID once with the SDK Web Lock', async ({ page, context, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    const auth = await installFixtureAuth(page)
    await signIn(page, origin)
    const other = await context.newPage()
    await installFixtureAuth(other, { state: auth })
    await other.goto(`${origin}/home`)
    await other.waitForLoadState('networkidle')
    expect(await page.evaluate(() => !!navigator.locks)).toBe(true)
    auth.refreshDelayMs = 200
    await expireAccess(page)
    await Promise.all([page.reload(), other.reload()])
    await expect.poll(() => auth.pdsCalls.filter((c) => c.method === 'app.bsky.feed.getTimeline' && c.authorization === `DPoP access-${ALICE}-2`).length).toBeGreaterThanOrEqual(2)
    expect(auth.tokenRequests.filter((r) => r.get('grant_type') === 'refresh_token')).toHaveLength(1)
    expect(await expired(page)).toBe(false)
    expect(await expired(other)).toBe(false)
  })

  test('rule 4: sign-out records a safe reason readable in another tab', async ({ page, context, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    const auth = await installFixtureAuth(page)
    await signIn(page, origin)
    await page.goto(`${origin}/settings`)
    const other = await context.newPage()
    await installFixtureAuth(other, { state: auth })
    await other.goto(`${origin}/settings`)
    await other.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
    await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
    await page.locator('caribou-settings-account').getByRole('button', { name: /Sign out of/ }).click()
    await page.waitForURL(`${origin}/`)
    await expect(other.locator('[data-session-end]')).toContainText('Signed out')
    await expect(other.locator('[data-session-end]')).toContainText('TokenRevokedError')
  })

  test('rule 4: invalid_grant records a safe reason visible in Settings', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    const auth = await installFixtureAuth(page)
    await signIn(page, origin)
    auth.revokedAtServer = true
    await page.reload()
    await expect(page.getByText('Your Bluesky session ended. Sign in again.')).toBeVisible()
    await page.goto(`${origin}/settings`)
    const reason = page.locator('[data-session-end]')
    await expect(reason).toContainText('invalid_grant')
    await expect(reason).toContainText('HTTP=400')
    await expect(reason).toContainText('TokenRefreshError')
    const log = await page.evaluate(() => localStorage.getItem('caribou.bluesky.session-ends')!)
    for (const privateText of [ALICE, 'alice.example.com', 'access-', 'refresh-']) expect(log).not.toContain(privateText)
  })
})
