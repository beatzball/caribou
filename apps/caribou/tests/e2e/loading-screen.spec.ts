import { expect, test, type BrowserContext, type Page, type Route } from './_fixtures.js'

// The loading screen of `/` → `/home` (issue 142). `/` shows it before it
// leaves, `/home` goes on with it, and it goes when the home timeline shows
// its first posts (or an error, or the empty notice). It never stays past
// its time limit.

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

async function signIn(page: Page, context: BrowserContext) {
  await context.addCookies([{
    name: 'caribou.instance', value: INSTANCE, domain: 'localhost', path: '/',
    httpOnly: true, secure: false, sameSite: 'Lax',
  }])
  await page.addInitScript(({ userKey, instance }) => {
    if (localStorage.getItem('__caribou_test_seeded')) return
    localStorage.setItem('__caribou_test_seeded', '1')
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(userKey))
    localStorage.setItem('caribou.users',
      JSON.stringify([[userKey, { userKey, token: 'TOK', server: instance, vapidKey: 'VK' }]]))
  }, { userKey: USER_KEY, instance: INSTANCE })
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

const splash = (page: Page) => page.locator('#caribou-splash')

test('shows from / through a slow /home, and goes when the posts show', async ({ page, context }) => {
  const errors = collectErrors(page)
  await signIn(page, context)
  const timeline = await holdHomeTimeline(page)
  // The `/home` document is slow. `/` reports what it shows meanwhile (a
  // page.evaluate would wait for the pending navigation).
  let releaseHome!: () => void
  const homeHeld = new Promise<void>((r) => { releaseHome = r })
  let homeAsked!: () => void
  const askedHome = new Promise<void>((r) => { homeAsked = r })
  await page.route((u) => u.pathname === '/home', async (route) => {
    homeAsked()
    await homeHeld
    await route.continue()
  })
  const probes: string[] = []
  page.on('console', (m) => { if (m.text().startsWith('PROBE ')) probes.push(m.text().slice(6)) })
  await page.addInitScript(() => {
    if (location.pathname !== '/') return
    setInterval(() => {
      const s = document.getElementById('caribou-splash')
      console.warn('PROBE ' + JSON.stringify({
        status: s?.querySelector('[role="status"]')?.textContent ?? null,
        logo: s?.querySelector('img')?.getAttribute('src') ?? null,
      }))
    }, 100)
  })
  await page.goto('/', { waitUntil: 'commit' })
  await askedHome
  await expect.poll(() => probes.length).toBeGreaterThan(2)
  expect(new Set(probes)).toEqual(new Set([JSON.stringify({ status: 'Loading…', logo: '/logo.png' })]))

  releaseHome()
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

test('goes for the empty notice', async ({ page, context }) => {
  await signIn(page, context)
  const timeline = await holdHomeTimeline(page)
  await page.goto('/')
  await page.waitForURL('**/home')
  await timeline.requested
  await expect(splash(page)).toBeVisible()
  await timeline.release([])
  await expect(page.getByText('No posts yet.')).toBeVisible()
  await expect(splash(page)).toHaveCount(0)
})

test('never stays: it goes at the time limit when the timeline never comes', async ({ page, context }) => {
  await signIn(page, context)
  const timeline = await holdHomeTimeline(page)
  const start = Date.now()
  await page.goto('/')
  await page.waitForURL('**/home')
  await timeline.requested
  await expect(splash(page)).toBeVisible()
  // The way out shows after 3 s.
  await expect(splash(page).getByRole('link', { name: 'Open your home timeline' })).toBeVisible({ timeout: 5000 })
  await expect(splash(page).getByRole('link', { name: 'Sign in' })).toBeVisible()
  await expect(splash(page)).toHaveCount(0, { timeout: LIMIT_MS + 2000 })
  expect(Date.now() - start).toBeGreaterThan(LIMIT_MS - 1000)
  await expect(page.getByText('Loading your timeline…')).toBeVisible()
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
      sessionStorage.setItem('caribou.splash', String(Date.now()))
    }
  })
  await page.goto('/home')
  await expect(page.locator('caribou-auth-required')).toBeVisible()
  await expect(splash(page)).toHaveCount(0)
})

test('with reduced motion the ring stands still and the screen goes with no fade', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await signIn(page, context)
  const timeline = await holdHomeTimeline(page)
  await page.goto('/')
  await page.waitForURL('**/home')
  await timeline.requested
  await expect(splash(page)).toBeVisible()
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
  const timeline = await holdHomeTimeline(page)
  await page.goto('/')
  await page.waitForURL('**/home')
  await timeline.requested
  const offset = () => splash(page).evaluate((el) =>
    Number.parseFloat(getComputedStyle(el.querySelector('.cs-bar')!).strokeDashoffset))
  const first = await offset()
  await expect.poll(offset).toBeLessThan(first)
})

test('follows the light theme', async ({ page, context }) => {
  await signIn(page, context)
  const timeline = await holdHomeTimeline(page)
  await page.goto('/')
  await page.waitForURL('**/home')
  await timeline.requested
  await expect(splash(page)).toHaveCSS('background-color', 'rgb(13, 13, 18)')
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await expect(splash(page)).toHaveCSS('background-color', 'rgb(250, 250, 250)')
  await expect(splash(page).getByRole('status')).toHaveCSS('color', 'rgb(63, 63, 70)')
})
