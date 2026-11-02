import { expect, test, type BrowserContext, type Page, type Route } from './_fixtures.js'

// The loading screen of the forward from `/` to the reader's timeline
// (issue 142). `/` shows it before it leaves, the timeline goes on with it,
// and it goes when that timeline shows its first posts (or an error, the
// empty notice or a placeholder). It keeps focus off the page under it, goes
// at once when the reader leaves, and never stays past its time limit.

const INSTANCE = 'example.social'
const USER_KEY = `alice@${INSTANCE}`
const LIMIT_MS = 10_000

const ACCOUNT = {
  id: 'a1', username: 'alice', acct: 'alice', display_name: 'Alice Example',
  avatar: '', avatar_static: '', url: `https://${INSTANCE}/@alice`, header: '', header_static: '',
  note: '', followers_count: 0, following_count: 0, statuses_count: 1, locked: false, bot: false,
  discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}
const STATUS = {
  id: '1', uri: `https://${INSTANCE}/@alice/1`, url: `https://${INSTANCE}/@alice/1`,
  created_at: '2024-01-01T00:00:00.000Z', account: ACCOUNT, content: '<p>first post</p>',
  visibility: 'public', sensitive: false, spoiler_text: '', media_attachments: [], mentions: [],
  tags: [], emojis: [], reblogs_count: 0, favourites_count: 0, replies_count: 0,
  favourited: false, reblogged: false, bookmarked: false, language: 'en',
}

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
  return errors
}

async function signIn(page: Page, context: BrowserContext, prefs?: Record<string, unknown>) {
  await context.addCookies([{
    name: 'caribou.instance', value: INSTANCE, domain: 'localhost', path: '/',
    httpOnly: true, secure: false, sameSite: 'Lax',
  }])
  await page.addInitScript(({ userKey, instance, prefs }) => {
    if (localStorage.getItem('__caribou_test_seeded')) return
    localStorage.setItem('__caribou_test_seeded', '1')
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(userKey))
    localStorage.setItem('caribou.users',
      JSON.stringify([[userKey, { userKey, token: 'TOK', server: instance, vapidKey: 'VK' }]]))
    if (prefs) localStorage.setItem(`caribou.prefs.${userKey}`, JSON.stringify(prefs))
  }, { userKey: USER_KEY, instance: INSTANCE, prefs: prefs ?? null })
  await page.route(new RegExp(`https://${INSTANCE.replace('.', '\\.')}/api/`), (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
}

// Holds the home timeline's first page until `release` answers it.
async function holdHomeTimeline(page: Page) {
  let held: Route | null = null
  let asked!: () => void
  const requested = new Promise<void>((r) => { asked = r })
  await page.route(/\/api\/v1\/timelines\/home/, (route) => { held = route; asked() })
  return {
    requested,
    release: (body: unknown[] = [STATUS]) =>
      held!.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
  }
}

// Holds the document of `path` until `release`. Meanwhile `/` reports what
// it shows through the console (a page.evaluate would wait for the pending
// navigation).
async function holdDocument(page: Page, path: string) {
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  let asked!: () => void
  const requested = new Promise<void>((r) => { asked = r })
  await page.route((u) => u.pathname === path, async (route) => {
    asked()
    await held
    await route.continue()
  })
  const probes: string[] = []
  page.on('console', (m) => { if (m.text().startsWith('PROBE ')) probes.push(m.text().slice(6)) })
  await page.addInitScript(() => {
    if (location.pathname !== '/') return
    setInterval(() => {
      const s = document.getElementById('caribou-splash')
      console.warn('PROBE ' + JSON.stringify({
        target: s?.dataset.target ?? null,
        status: s?.querySelector('[role="status"]')?.textContent ?? null,
        logo: s?.querySelector('img')?.getAttribute('src') ?? null,
        background: s ? getComputedStyle(s).backgroundColor : null,
        painted: performance.getEntriesByType('paint').length > 0,
        // The rest of `/` is hidden text: none of it is parsed as markup.
        parsed: document.querySelector('link[rel="manifest"], litro-outlet, page-index') !== null,
      }))
    }, 100)
  })
  return { requested, release, probes }
}

const splash = (page: Page) => page.locator('#caribou-splash')

async function forwardToHome(page: Page) {
  const timeline = await holdHomeTimeline(page)
  await page.goto('/')
  await page.waitForURL('**/home')
  await timeline.requested
  await expect(splash(page)).toBeVisible()
  return timeline
}

test('shows and paints on / through a slow /home, and goes when the posts show', async ({ page, context }) => {
  const errors = collectErrors(page)
  await signIn(page, context)
  const timeline = await holdHomeTimeline(page)
  const home = await holdDocument(page, '/home')
  await page.goto('/', { waitUntil: 'commit' })
  await home.requested
  await expect.poll(() => home.probes.filter((p) => JSON.parse(p).status === 'Loading…').length).toBeGreaterThan(2)
  for (const p of home.probes.slice(-3)) {
    expect(JSON.parse(p)).toEqual({
      target: '/home', status: 'Loading…', logo: '/logo.png', background: 'rgb(13, 13, 18)', painted: true, parsed: false,
    })
  }

  home.release()
  await page.waitForURL('**/home')
  // `/home` goes on with the same screen while its timeline loads.
  await timeline.requested
  await expect(splash(page)).toBeVisible()
  await expect(splash(page).getByRole('status')).toHaveText('Loading…')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(splash(page)).toBeVisible()

  await timeline.release()
  await expect(page.locator('caribou-status-card').first()).toBeVisible()
  await expect(splash(page)).toHaveCount(0)
  // The screen is outside the server-rendered page: hydration is clean.
  expect(errors).toEqual([])
})

test('a light-theme reader gets a light screen on / and on the timeline', async ({ page, context }) => {
  await signIn(page, context, { theme: 'light' })
  const timeline = await holdHomeTimeline(page)
  const home = await holdDocument(page, '/home')
  await page.goto('/', { waitUntil: 'commit' })
  await home.requested
  await expect.poll(() => home.probes.length).toBeGreaterThan(2)
  expect(new Set(home.probes.map((p) => JSON.parse(p).background))).toEqual(new Set(['rgb(250, 250, 250)']))
  home.release()
  await page.waitForURL('**/home')
  await timeline.requested
  await expect(splash(page)).toHaveCSS('background-color', 'rgb(250, 250, 250)')
  await expect(splash(page).getByRole('status')).toHaveCSS('color', 'rgb(63, 63, 70)')
})

test('goes for the empty notice', async ({ page, context }) => {
  await signIn(page, context)
  const timeline = await forwardToHome(page)
  await timeline.release([])
  await expect(page.getByText('No posts yet.')).toBeVisible()
  await expect(splash(page)).toHaveCount(0)
})

test('forwards to the default timeline with the screen, and it goes there', async ({ page, context }) => {
  await signIn(page, context, { defaultTimeline: 'public' })
  // Which target the screen was shown for, on each document.
  await page.addInitScript(() => {
    new MutationObserver(() => {
      const s = document.getElementById('caribou-splash')
      const seen = `${location.pathname}>${s?.dataset.target}`
      if (s && !(sessionStorage.getItem('__saw') ?? '').includes(seen)) {
        sessionStorage.setItem('__saw', (sessionStorage.getItem('__saw') ?? '') + seen + ' ')
      }
    }).observe(document, { childList: true, subtree: true })
  })
  await page.goto('/')
  await page.waitForURL('**/public')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(splash(page)).toHaveCount(0)
  const saw = await page.evaluate(() => sessionStorage.getItem('__saw') ?? '')
  expect(saw).toContain('/>/public')
  expect(saw).toContain('/public>/public')
})

test('keeps keyboard focus off the page under it, and its links are reachable', async ({ page, context, browserName }) => {
  // Safari moves to links only with Option+Tab.
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
  await signIn(page, context)
  await forwardToHome(page)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  const where = () => page.evaluate(() => {
    const a = document.activeElement
    if (!a || a === document.body) return 'none'
    return a.closest('#caribou-splash') ? `splash:${a.tagName}:${a.textContent}` : `page:${a.tagName}`
  })
  // The way out shows after 3 s; then Tab moves between its links only.
  await expect(splash(page).getByRole('link', { name: 'Sign in' })).toBeVisible({ timeout: 5000 })
  const seen: string[] = []
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press(tab)
    seen.push(await where())
  }
  expect(seen.filter((w) => w.startsWith('page:'))).toEqual([])
  expect(seen).toContain('splash:A:Open your timeline')
  expect(seen).toContain('splash:A:Sign in')
})

test('focus goes to the page once the posts show', async ({ page, context }) => {
  await signIn(page, context)
  const timeline = await forwardToHome(page)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await timeline.release()
  await expect(splash(page)).toHaveCount(0)
  expect(await page.evaluate(() => document.body.inert)).toBe(false)
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('LITRO-OUTLET')
})

test('leaving the timeline while it loads removes the screen at once', async ({ page, context }) => {
  await signIn(page, context)
  await forwardToHome(page)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  // A router move, as a link does.
  await page.evaluate(() => {
    history.pushState(null, '', '/about')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(splash(page)).toHaveCount(0, { timeout: 1000 })
  await expect(page.locator('page-about')).toBeVisible()
  expect(await page.evaluate(() => document.body.inert)).toBe(false)
})

test('Back from a client-side forward removes the screen at once', async ({ page, context }) => {
  await signIn(page, context)
  const timeline = await holdHomeTimeline(page)
  await page.goto('/about')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.evaluate(() => {
    history.pushState(null, '', '/privacy')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await page.locator('page-privacy').waitFor()
  // A link to `/`: `/` is replaced with `/home`.
  await page.evaluate(() => {
    history.pushState(null, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect.poll(() => new URL(page.url()).pathname).toBe('/home')
  await timeline.requested
  await expect(splash(page)).toBeVisible()
  await page.goBack()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/privacy')
  await expect(splash(page)).toHaveCount(0, { timeout: 1000 })
  await expect(page.locator('page-privacy')).toBeVisible()
})

test('never stays: it goes at the time limit when the timeline never comes', async ({ page, context }) => {
  await signIn(page, context)
  const start = Date.now()
  await forwardToHome(page)
  // The way out shows after 3 s.
  await expect(splash(page).getByRole('link', { name: 'Open your timeline' })).toBeVisible({ timeout: 5000 })
  await expect(splash(page).getByRole('link', { name: 'Open your timeline' })).toHaveAttribute('href', '/home')
  await expect(splash(page).getByRole('link', { name: 'Sign in' })).toBeVisible()
  await expect(splash(page)).toHaveCount(0, { timeout: LIMIT_MS + 2000 })
  expect(Date.now() - start).toBeGreaterThan(LIMIT_MS - 1000)
  await expect(page.getByText('Loading your timeline…')).toBeVisible()
  expect(await page.evaluate(() => document.body.inert)).toBe(false)
})

test('a client-side navigation to / shows it too, until the posts show', async ({ page, context }) => {
  await signIn(page, context)
  const timeline = await holdHomeTimeline(page)
  await page.goto('/about')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.evaluate(() => {
    history.pushState(null, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect.poll(() => new URL(page.url()).pathname).toBe('/home')
  await timeline.requested
  await expect(splash(page)).toBeVisible()
  await timeline.release()
  await expect(page.locator('caribou-status-card').first()).toBeVisible()
  await expect(splash(page)).toHaveCount(0)
})

test('a plain load of /home shows no loading screen', async ({ page, context }) => {
  await signIn(page, context)
  const timeline = await holdHomeTimeline(page)
  await page.goto('/home')
  await timeline.requested
  await expect(page.getByText('Loading your timeline…')).toBeVisible()
  await expect(splash(page)).toHaveCount(0)
})

test('signed out, /home shows the placeholder and no screen stays', async ({ page }) => {
  // A forward that started in this tab, then the account went.
  await page.addInitScript(() => {
    if (location.pathname === '/home' && !sessionStorage.getItem('__seeded')) {
      sessionStorage.setItem('__seeded', '1')
      sessionStorage.setItem('caribou.splash', JSON.stringify({ t: Date.now(), to: '/home' }))
    }
  })
  await page.goto('/home')
  await expect(page.locator('caribou-auth-required')).toBeVisible()
  await expect(splash(page)).toHaveCount(0)
})

test('with reduced motion the ring stands still and the screen goes with no fade', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await signIn(page, context)
  const timeline = await forwardToHome(page)
  const motion = await splash(page).evaluate((el) => ({
    ring: getComputedStyle(el.querySelector('.cs-bar')!).animationName,
    fade: getComputedStyle(el).transitionDuration,
  }))
  expect(motion).toEqual({ ring: 'none', fade: '0s' })
  // Gone in the same update as the posts: no fade is left to watch. (With
  // motion, the screen is still fading at this point.)
  await timeline.release()
  await page.locator('caribou-status-card').first().waitFor()
  expect(await splash(page).count()).toBe(0)
})

test('the ring creeps without reduced motion', async ({ page, context }) => {
  await signIn(page, context)
  await forwardToHome(page)
  const offset = () => splash(page).evaluate((el) =>
    Number.parseFloat(getComputedStyle(el.querySelector('.cs-bar')!).strokeDashoffset))
  const first = await offset()
  await expect.poll(offset).toBeLessThan(first)
})
