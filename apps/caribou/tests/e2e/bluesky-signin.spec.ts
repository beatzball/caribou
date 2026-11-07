import { expect, test, type Page } from '@playwright/test'
import { ALICE, BOB, MALLORY, installFixtureAuth, loopbackOrigin } from './_bluesky-auth.js'

// Bluesky sign-in through the real SDK and a real callback, against the
// fixture authorization server in `_bluesky-auth.ts` (spec 5.5). A test that
// only inserted a session would pass with the code swap or the `sub` check
// broken; these do not.

async function storedUsers(page: Page): Promise<[string, Record<string, unknown>][]> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('caribou.users') ?? '[]'))
}

async function startSignIn(page: Page, origin: string, handle: string) {
  await page.addInitScript(() => localStorage.setItem('caribou.flag.bluesky', '1'))
  await page.goto(`${origin}/`)
  await page.getByRole('tab', { name: 'Bluesky' }).click()
  await page.getByLabel('Bluesky handle').fill(handle)
  await page.getByRole('tabpanel', { name: 'Bluesky' }).getByRole('button', { name: 'Sign in' }).click()
}

test.describe('Bluesky sign-in', () => {
  // Playwright's WebKit build on macOS hangs the page when it stores a
  // CryptoKey in IndexedDB, and the SDK stores its DPoP key there. Seen on a
  // local run; CI runs WebKit on Linux, so these still run there.
  test.skip(({ browserName }) => browserName === 'webkit' && process.platform === 'darwin',
    'Playwright WebKit on macOS hangs storing a CryptoKey in IndexedDB')

  test('signs in through the callback, then restores after a reload', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    const auth = await installFixtureAuth(page)
    await startSignIn(page, origin, 'alice.example.com')

    await page.waitForURL(`${origin}/home`)
    // The code was swapped once, with PKCE.
    expect(auth.tokenRequests).toHaveLength(1)
    expect(auth.tokenRequests[0]!.get('code_verifier')).toBeTruthy()
    const users = await storedUsers(page)
    expect(users).toEqual([[`${ALICE}@bsky`, expect.objectContaining({
      network: 'bluesky', did: ALICE, handle: 'alice.example.com', pds: 'https://pds.example.test',
    })]])
    // No token in Caribou's storage: the SDK keeps it in IndexedDB.
    expect(JSON.stringify(users)).not.toContain('access-')

    // After a reload the client restores the session by the stored DID and
    // calls the PDS with the DPoP-bound token.
    auth.pdsCalls.length = 0
    await page.reload()
    await expect.poll(() => auth.pdsCalls.find((c) => c.method === 'app.bsky.feed.getTimeline')).toMatchObject({
      authorization: `DPoP access-${ALICE}`, dpop: true,
    })
    expect(auth.tokenRequests).toHaveLength(1)
  })

  test('a session the server ended: the banner shows, the session, drafts and page stay', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    const auth = await installFixtureAuth(page)
    await startSignIn(page, origin, 'alice.example.com')
    await page.waitForURL(`${origin}/home`)
    await page.evaluate((key) => localStorage.setItem(`caribou.drafts.${key}`, '{"text":"kept"}'), `${ALICE}@bsky`)

    // The token is refused and the refresh is refused (the fixture's token
    // endpoint answers invalid_grant), so the SDK deletes the session.
    auth.revokedAtServer = true
    await page.reload()
    await expect(page.getByText('Your Bluesky session ended. Sign in again.')).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/home')
    const users = await storedUsers(page)
    expect(users).toEqual([[`${ALICE}@bsky`, expect.objectContaining({ did: ALICE, expired: true })]])
    expect(await page.evaluate((key) => localStorage.getItem(`caribou.drafts.${key}`), `${ALICE}@bsky`)).toBe('{"text":"kept"}')

    // Signing in again to the same account clears it.
    auth.revokedAtServer = false
    // The page is on /home already: wait for the callback first.
    await page.getByRole('button', { name: 'Sign in again' }).click()
    await page.waitForURL((u) => u.pathname === '/signin/bluesky')
    await page.waitForURL(`${origin}/home`)
    // Two code swaps (the refused refresh is the third token request).
    expect(auth.tokenRequests.filter((r) => r.get('grant_type') === 'authorization_code')).toHaveLength(2)
    await expect(page.getByText('Your Bluesky session ended.')).toHaveCount(0)
    expect((await storedUsers(page))[0]![1]).not.toHaveProperty('expired')
  })

  test('the callback page sends no-store and no-referrer', async ({ request, baseURL }) => {
    const res = await request.get(`${loopbackOrigin(baseURL)}/signin/bluesky`)
    expect(res.status()).toBe(200)
    expect(res.headers()['cache-control']).toBe('no-store')
    expect(res.headers()['referrer-policy']).toBe('no-referrer')
  })

  test('sub check: another account than the handle named is revoked and nothing is stored', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    // Bob is on the same server, so the SDK's issuer check passes; Caribou's
    // own check (the handle named Alice) must refuse.
    const auth = await installFixtureAuth(page, { sub: BOB })
    await startSignIn(page, origin, 'alice.example.com')

    await expect(page.getByRole('alert')).toContainText('another account')
    expect(new URL(page.url()).pathname).toBe('/signin/bluesky')
    expect(new URL(page.url()).hash).toBe('')
    expect(await storedUsers(page)).toEqual([])
    await expect.poll(() => auth.revoked).toContain(`access-${BOB}`)
  })

  test('sub check: a DID whose PDS trusts another authorization server fails, nothing stored', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    // Mallory's DID resolves to a PDS that is not the issuer's (spec 10).
    await installFixtureAuth(page, { sub: MALLORY })
    await startSignIn(page, origin, 'alice.example.com')

    await expect(page.getByRole('alert')).toContainText('Could not sign in')
    expect(await storedUsers(page)).toEqual([])
  })

  test('a handle that does not resolve sends nothing to the authorization server', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    const auth = await installFixtureAuth(page)
    await startSignIn(page, origin, 'nobody.example.com')
    await expect(page.getByRole('tabpanel', { name: 'Bluesky' }).getByRole('alert')).toContainText('Could not sign in')
    expect(auth.tokenRequests).toEqual([])
    expect(new URL(page.url()).pathname).toBe('/')
  })
})
