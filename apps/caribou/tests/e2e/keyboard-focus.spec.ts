import { test, expect } from './_fixtures.js'
import { deepFocus, phoneFocus, seed, settled, status } from './_keyboard-focus.js'

for (const theme of ['dark', 'light']) {
  for (const network of ['mastodon', 'bluesky']) {
    test(`rule 1: phone keyboard focus clears navigation (${theme}, ${network})`, async ({ page, browserName }) => {
      await phoneFocus(page, browserName, theme, network)
    })
  }
  for (const signedIn of [false, true]) {
    test(`rule 2: Skip bypasses rail on direct and SPA visits (${theme}, signed in ${signedIn})`, async ({ page, browserName }) => {
      if (signedIn) await seed(page, theme)
      await page.route('**/api/v1/timelines/home*', (route) => route.fulfill({ json: [status('1')] }))
      await settled(page)
      if (!signedIn) await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      for (const route of ['/home', '/settings', '/home']) {
        if (new URL(page.url()).pathname !== route) {
          await page.locator('caribou-nav-rail').getByRole('link', { name: route === '/home' ? 'Home' : 'Settings', exact: true }).click()
          await expect(page).toHaveURL(new RegExp(`${route}$`))
          await page.locator(`litro-outlet > page-${route.slice(1)}:not([hidden])`).waitFor({ state: 'visible' })
          await expect(page.locator('litro-outlet > *')).toHaveCount(1)
        }
        await page.getByRole('link', { name: 'Skip to content' }).focus()
        await page.keyboard.press('Enter')
        expect(await deepFocus(page)).toMatchObject({ tag: 'main', connected: true, visible: true })
        await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab')
        expect(await page.locator('caribou-nav-rail').evaluate((rail) => rail.shadowRoot?.activeElement !== null)).toBe(false)
      }
      await settled(page, '/settings')
      if (!signedIn) await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme)
      await page.getByRole('link', { name: 'Skip to content' }).focus()
      await page.keyboard.press('Enter')
      expect(await deepFocus(page)).toMatchObject({ tag: 'main' })
    })
  }
  test(`rule 3: applying focused new posts selects the list, preserving other focus (${theme})`, async ({ page }) => {
    await seed(page, theme)
    let fresh = '2'
    await page.route('**/api/v1/timelines/home*', (route) => {
      const u = new URL(route.request().url())
      return route.fulfill({ json: u.searchParams.has('max_id') ? [] : [status(u.searchParams.has('since_id') ? fresh : '1')] })
    })
    await settled(page)
    await expect(page.locator('caribou-status-card')).toHaveCount(1)
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    const apply = page.getByRole('button', { name: '1 new post', exact: true })
    await apply.focus()
    await page.keyboard.press('Enter')
    await expect(apply).toHaveCount(0)
    await expect(page.locator('caribou-timeline ul')).toBeFocused()
    expect(await deepFocus(page)).toMatchObject({ connected: true, visible: true })
    fresh = '3'
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await expect(apply).toBeVisible()
    const home = page.locator('caribou-nav-rail').getByRole('link', { name: 'Home', exact: true })
    await home.focus()
    await apply.evaluate((el) => (el as HTMLElement).click())
    await expect(apply).toHaveCount(0)
    await expect(home).toBeFocused()
  })
  test(`rule 5: toast dismissal returns to work or the next toast (${theme})`, async ({ page, browserName }) => {
    await seed(page, theme)
    await settled(page, '/settings')
    const work = page.getByRole('radio', { name: 'Light', exact: true })
    // Moving between fields in one nested root must retain the latest work target.
    await page.getByRole('radio', { name: 'Dark', exact: true }).focus()
    await work.focus()
    const send = (message: string) => page.evaluate((message) => window.dispatchEvent(new CustomEvent('caribou:toast', {
      detail: { kind: 'error', message },
    })), message)
    await send('first')
    await send('middle')
    await send('last')
    const toaster = page.locator('caribou-toaster')
    await toaster.getByRole('button', { name: 'Dismiss', exact: true }).nth(1).focus()
    await page.keyboard.press('Enter')
    await expect(toaster.getByRole('alert').filter({ hasText: 'last' }).getByRole('button', { name: 'Dismiss' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(toaster.getByRole('button', { name: 'Dismiss' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(work).toBeFocused()
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab')
    expect((await deepFocus(page)).tag).not.toBe('body')
    await work.focus()
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('caribou:toast', { detail: { kind: 'info', message: 'timeout' } })))
    await toaster.getByRole('button', { name: 'Dismiss' }).focus()
    await expect(toaster.getByRole('button', { name: 'Dismiss' })).toHaveCount(0, { timeout: 7000 })
    await expect(work).toBeFocused()
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('caribou:toast', { detail: {
        kind: 'error', message: 'action', action: { label: 'Choose destination', run: () => {
          const shell = document.querySelector('litro-outlet > *')!.shadowRoot!.querySelector('caribou-app-shell')!
          const destination = shell.shadowRoot!.querySelector('caribou-nav-rail')!.shadowRoot!.querySelector<HTMLAnchorElement>('a')!
          destination.focus()
        } },
      } }))
    })
    await toaster.getByRole('button', { name: 'Choose destination' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('caribou-nav-rail').getByRole('link', { name: 'Home', exact: true })).toBeFocused()
  })
}

// The real browser SDK runs against the existing fixture identity/PDS.
// Images and pending uploads exercise the same Remove controls as Mastodon.
for (const theme of ['dark', 'light']) {
  for (const network of ['mastodon', 'bluesky'] as const) {
    test(`rule 4: uploaded and pending ${network} attachments recover focus (${theme})`, async ({ page, browserName, baseURL }) => {
      test.skip(network === 'bluesky' && browserName === 'webkit' && process.platform === 'darwin',
        'The existing macOS WebKit fixture cannot store the SDK CryptoKey in IndexedDB')
      let key = 'alice@example.social'
      if (network === 'mastodon') {
        await seed(page, theme)
        await page.route('**/api/v1/timelines/home*', (route) => route.fulfill({ json: [] }))
        await settled(page)
      } else {
        const { ALICE, installFixtureAuth, loopbackOrigin, waitForSignedInHome } = await import('./_bluesky-auth.js')
        await installFixtureAuth(page)
        const origin = loopbackOrigin(baseURL)
        await page.goto(origin)
        await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
        await page.getByRole('tab', { name: 'Bluesky' }).click()
        await page.getByLabel('Bluesky handle').fill('alice.example.com')
        await page.getByRole('tabpanel', { name: 'Bluesky' }).getByRole('button', { name: 'Sign in' }).click()
        await waitForSignedInHome(page, origin)
        key = `${ALICE}@bsky`
        await page.evaluate(({ key, theme }) => {
          localStorage.setItem(`caribou.prefs.${key}`, JSON.stringify({ theme }))
        }, { key, theme })
        await settled(page, `${origin}/home`)
      }
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.route('**/api/v2/media', () => { /* keep uploads pending */ })
      await page.route('**/xrpc/com.atproto.repo.uploadBlob', (route) => route.request().method() === 'OPTIONS'
        ? route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
        : undefined)
      for (const state of ['uploaded', 'pending']) {
        for (const [count, at, next] of [[3, 0, 1], [3, 1, 2], [3, 2, 1], [1, 0, null]] as const) {
          await page.evaluate(({ key, count, state, network }) => {
            const media = Array.from({ length: count }, (_, i) => ({ id: `m${i}`, type: 'image', url: '', previewUrl: null, description: '', name: `image${i}.png` }))
            const draft = { text: '', spoilerText: '', cw: false, visibility: 'public', inReplyToId: null,
              media: state === 'uploaded' && network === 'mastodon' ? media : [], idempotencyKey: crypto.randomUUID(),
              ...(network === 'bluesky' ? { bluesky: { images: state === 'uploaded' ? media.map((m) => ({
                id: m.id, blob: { $type: 'blob', ref: { $link: 'bafkreigh2akiscaildcg6lyl3ytmpongfcf7wsa5nx7htcw4d7a5u5vyqi' }, mimeType: 'image/png', size: 68 },
                mime: 'image/png', size: 68, alt: '', aspectRatio: null, name: m.name,
              })) : [], reply: null, quote: null, labels: [], rkey: '3kexample00001' } } : {}),
            }
            localStorage.setItem(`caribou.drafts.${key}`, JSON.stringify({ new: draft }))
          }, { key, count, state, network })
          await page.keyboard.press('n')
          const dialog = page.getByRole('dialog', { name: 'New post' })
          await expect(dialog).toBeVisible()
          if (state === 'pending') {
            const buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
            await dialog.locator('input[type="file"]').setInputFiles(Array.from({ length: count }, (_, i) => ({ name: `image${i}.png`, mimeType: 'image/png', buffer })))
          }
          const removes = dialog.locator('[data-action="remove-media"] button')
          await expect(removes).toHaveCount(count)
          // Keep the intended survivor's native node to verify identity too.
          const survivor = next === null ? dialog.locator('[data-action="add-media"] button') : removes.nth(next)
          const target = await survivor.elementHandle()
          await removes.nth(at).focus()
          await page.keyboard.press('Enter')
          await expect(removes).toHaveCount(count - 1)
          await expect.poll(() => target!.evaluate((el) => el.isConnected && el.getRootNode() instanceof ShadowRoot
            && (el.getRootNode() as ShadowRoot).activeElement === el)).toBe(true)
          expect(await deepFocus(page)).toMatchObject({ tag: 'button', connected: true, visible: true })
          if (count > 1) {
            const editor = dialog.getByRole('textbox', { name: 'Post text' })
            await editor.focus()
            await removes.first().evaluate((el) => (el as HTMLElement).click())
            await expect(removes).toHaveCount(count - 2)
            await expect(editor).toBeFocused()
          }
          await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
          await expect(dialog).toBeHidden()
        }
      }
    })
  }
}
