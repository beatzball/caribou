// Mocks shared by lists.spec.ts and lists.mobile.spec.ts.
import { expect, type Page } from './_fixtures.js'
import { ALICE, API, INSTANCE, json } from './_moderation.js'

export interface ListRow { id: string; title: string; replies_policy: string; exclusive: boolean }

export const list = (id: string, title: string): ListRow =>
  ({ id, title, replies_policy: 'list', exclusive: false })

/**
 * A small list server: GET/POST /lists, GET/PUT/DELETE /lists/:id, and the
 * members of each list. `writes` records every write in order.
 */
export async function serveLists(page: Page, start: ListRow[], members: Record<string, unknown[]> = {}) {
  let lists = [...start]
  const writes: string[] = []
  let nextId = 100
  await page.route((url) => url.host === INSTANCE && /^\/api\/v1\/lists(\/|$)/.test(url.pathname), async (route) => {
    const req = route.request()
    const parts = new URL(req.url()).pathname.split('/').slice(4)
    const [id, sub] = parts
    const method = req.method()
    if (!id) {
      if (method === 'GET') return route.fulfill(json(lists))
      const body = req.postDataJSON() as Partial<ListRow>
      const made = { ...list(String(nextId++), body.title ?? ''), ...body }
      lists = [...lists, made]
      writes.push(`create ${made.title}`)
      return route.fulfill(json(made))
    }
    const found = lists.find((l) => l.id === id)
    if (!found) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Record not found"}' })
    if (sub === 'accounts') {
      if (method === 'GET') return route.fulfill(json(members[id] ?? []))
      const ids = (req.postDataJSON() as { account_ids: string[] }).account_ids
      writes.push(`${method === 'POST' ? 'add' : 'remove'} ${ids.join(',')} ${id}`)
      if (method === 'DELETE') members[id] = (members[id] ?? []).filter((a) => !ids.includes((a as { id: string }).id))
      return route.fulfill(json({}))
    }
    if (method === 'GET') return route.fulfill(json(found))
    if (method === 'PUT') {
      const body = req.postDataJSON() as Partial<ListRow>
      const saved = { ...found, ...body }
      lists = lists.map((l) => (l.id === id ? saved : l))
      writes.push(`update ${id} ${saved.title}`)
      return route.fulfill(json(saved))
    }
    if (method === 'DELETE') {
      lists = lists.filter((l) => l.id !== id)
      writes.push(`delete ${id}`)
      return route.fulfill(json({}))
    }
    return route.fallback()
  })
  return { writes, lists: () => lists }
}

/** Bob's profile, reached by a client-side move (see moderation.spec.ts). */
export async function openBob(page: Page) {
  const BOB_CAMEL = {
    id: 'b1', username: 'bob', acct: 'bob', displayName: 'BOB', avatar: `https://${INSTANCE}/a.png`,
    avatarStatic: `https://${INSTANCE}/a.png`, url: `https://${INSTANCE}/@bob`, header: '', headerStatic: '',
    note: '', followersCount: 0, followingCount: 0, statusesCount: 0, locked: false, bot: false,
    discoverable: true, createdAt: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
  }
  await page.route(`${API}/v1/accounts/lookup*`, (route) => route.fulfill(json(ALICE)))
  await page.route(`${API}/v1/accounts/a1/statuses*`, (route) => route.fulfill(json([])))
  await page.route((url) => url.pathname === `/@bob@${INSTANCE}`, (route) => {
    if (!/application\/json/.test(route.request().headers()['accept'] ?? '')) return route.continue()
    return route.fulfill(json({
      kind: 'ok', account: BOB_CAMEL, statuses: [], nextCursor: null, tab: 'posts',
      shell: { instance: INSTANCE }, handle: `bob@${INSTANCE}`,
    }))
  })
  await page.goto('/@me')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
  await page.evaluate((path) => {
    history.pushState(null, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, `/@bob@${INSTANCE}`)
  await expect(page.locator('caribou-profile-header .handle', { hasText: '@bob' })).toBeVisible()
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}
