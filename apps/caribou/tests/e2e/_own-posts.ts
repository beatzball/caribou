// Mocks shared by own-posts.spec.ts and own-posts.mobile.spec.ts: a small
// fake Mastodon that keeps the reader's posts, so an edit or a delete shows
// in every later answer, as on a real server.
import { type Page } from './_fixtures.js'
import { ALICE, API, BOB, INSTANCE, gotoSettled, json, status } from './_moderation.js'

export { ALICE, API, BOB, INSTANCE, gotoSettled, json, status }

type Post = ReturnType<typeof status> & { edited_at?: string | null; text?: string }

export interface FakeServer {
  posts: Map<string, Post>
  history: Map<string, Post[]>
  /** The method and path of every write, in order. */
  writes: string[]
  /** Set to make the next write of this kind fail with a 500. */
  fail: { edit?: boolean; delete?: boolean }
}

const snakeToCamel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

// Page data is what the app's server sends: masto's camelCase.
export function camel(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(camel)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [snakeToCamel(k), camel(x)]))
  }
  return v
}

export function own(id: string, text: string, over: Partial<Post> = {}): Post {
  return { ...status(id, ALICE), content: `<p>${text}</p>`, ...over }
}

export async function fakeServer(page: Page, posts: Post[]): Promise<FakeServer> {
  const s: FakeServer = { posts: new Map(posts.map((p) => [p.id, p])), history: new Map(), writes: [], fail: {} }
  const list = () => [...s.posts.values()]
  await page.route(`${API}/v1/timelines/home*`, (route) => {
    const q = new URL(route.request().url()).searchParams
    return route.fulfill(json(q.has('max_id') || q.has('since_id') ? [] : list()))
  })
  await page.route(`${API}/v2/instance`, (route) => route.fulfill(json({
    domain: INSTANCE, configuration: { statuses: { max_characters: 500, max_media_attachments: 4 }, media_attachments: {} },
  })))
  // The reader's copies of server-rendered posts (their filters).
  await page.route(`${API}/v1/statuses?*`, (route) => {
    const ids = new URL(route.request().url()).searchParams.getAll('id[]')
    return route.fulfill(json(ids.flatMap((id) => s.posts.get(id) ? [{ ...s.posts.get(id), filtered: [] }] : [])))
  })
  await page.route(new RegExp(`${API.replace(/\./g, '\\.')}/v1/statuses/[^/?]+(/[a-z]+)?$`), async (route) => {
    const req = route.request()
    const [, id, sub] = /\/statuses\/([^/?]+)(?:\/([a-z]+))?$/.exec(new URL(req.url()).pathname)!
    const post = s.posts.get(id!)
    if (!post) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Record not found"}' })
    const method = req.method()
    if (method === 'GET' && sub === 'source') {
      return route.fulfill(json({ id, text: post.content.replace(/<[^>]+>/g, ''), spoiler_text: post.spoiler_text }))
    }
    if (method === 'GET' && sub === 'history') return route.fulfill(json(s.history.get(id!) ?? [post]))
    if (method === 'GET' && sub === 'context') return route.fulfill(json({ ancestors: [], descendants: [] }))
    if (method === 'GET' && !sub) return route.fulfill(json(post))
    if (method === 'PUT' && !sub) {
      s.writes.push(`PUT ${id}`)
      if (s.fail.edit) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
      const body = req.postDataJSON() as { status: string; spoiler_text: string }
      const edited: Post = {
        ...post, content: `<p>${body.status}</p>`, spoiler_text: body.spoiler_text,
        edited_at: '2026-11-01T10:00:00.000Z',
      }
      s.history.set(id!, [...(s.history.get(id!) ?? [post]), edited])
      s.posts.set(id!, edited)
      return route.fulfill(json(edited))
    }
    if (method === 'DELETE' && !sub) {
      s.writes.push(`DELETE ${id}`)
      if (s.fail.delete) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
      s.posts.delete(id!)
      return route.fulfill(json({ ...post, text: post.content.replace(/<[^>]+>/g, '') }))
    }
    return route.continue()
  })
  return s
}

/** Opens a thread with a client-side navigation, as a click on a post's time does. */
export async function openThread(page: Page, s: FakeServer, id: string) {
  const path = `/@alice@${INSTANCE}/${id}`
  await page.route((url) => url.pathname === path, (route) => {
    if (route.request().headers()['accept'] !== 'application/json') return route.continue()
    return route.fulfill(json({
      kind: 'ok', focused: camel(s.posts.get(id)), ancestors: [], descendants: [],
      shell: { instance: INSTANCE }, statusId: id, handle: `alice@${INSTANCE}`,
    }))
  })
  await page.evaluate((p) => {
    history.pushState(null, '', p)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
  await page.locator('litro-outlet > page-handle-statusid:not([hidden])').waitFor()
}
