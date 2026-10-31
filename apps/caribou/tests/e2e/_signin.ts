import type { Page } from '@playwright/test'
import { COMPLETE_PAGE_CSP, completeSigninPage, type CompletedSession } from '../../server/lib/signin-complete-page.js'

// A successful sign-in, as far as a browser test can take it. The callback
// exchanges the code with the user's server, a request from this server that
// a test cannot answer. So the mocked authorize page sends the browser to the
// real callback URL, and the test answers that one request with what the
// callback returns on success: the real completion page, with its headers.
// The callback's own checks and cookies are unit-tested
// (`tests/unit/signin-routes.test.ts`).
export async function authorizeSignsIn(page: Page, origin: string, server: string, session: Omit<CompletedSession, 'vapidKey'>) {
  await page.route(`https://${server}/oauth/authorize**`, (route) => {
    const state = new URL(route.request().url()).searchParams.get('state') ?? ''
    const next = `${origin}/api/signin/callback?code=E2E-OK&state=${encodeURIComponent(state)}`
    return route.fulfill({
      status: 200, contentType: 'text/html',
      body: `<!doctype html><script>location.replace(${JSON.stringify(next)})</script>`,
    })
  })
  await page.route(`${origin}/api/signin/callback?code=E2E-OK**`, (route) => route.fulfill({
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'content-security-policy': COMPLETE_PAGE_CSP,
    },
    body: completeSigninPage({ ...session, vapidKey: '' }),
  }))
}
