import { expect, test } from '@playwright/test'

// An unmatched path gets the 404 page. The status must say so too: the old
// app answered 200 with a page that read "404", so a link checker, a crawler
// or a fetch() took every typo for a real page.
test('an unmatched path answers 404', async ({ request }) => {
  const res = await request.get('/no-such-page')
  expect(res.status()).toBe(404)
  expect(res.headers()['content-type']).toContain('text/html')
  const body = await res.text()
  expect(body).toContain('<h1>404 — Not Found</h1>')
  expect(body).toContain('<code>/no-such-page</code>')
})

test('a nested unmatched path answers 404', async ({ request }) => {
  const res = await request.get('/blog/no-such-post/extra')
  expect(res.status()).toBe(404)
})

test('the echoed path is escaped', async ({ request }) => {
  // Playwright encodes the URL; the server escapes whatever decodes out of it.
  const res = await request.get('/<img src=x onerror=alert(1)>')
  expect(res.status()).toBe(404)
  const body = await res.text()
  expect(body).not.toContain('<img')
})

test('a real page still answers 200', async ({ request }) => {
  expect((await request.get('/about')).status()).toBe(200)
})
