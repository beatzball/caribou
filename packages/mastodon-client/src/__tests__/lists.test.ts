import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { toUserKey } from '@beatzball/caribou-auth'
import { createCaribouClient } from '../create-client.js'
import { server } from './fixtures/server.js'
import { handlers } from './fixtures/handlers.js'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers(...handlers))
afterAll(() => server.close())

const userKey = toUserKey('alice', 'example.social')
const API = 'https://example.social/api'

function sessionSource() {
  return {
    get: () => ({ userKey, server: 'example.social', token: 'TOKEN-1' }),
    onUnauthorized: vi.fn(),
  }
}

const list = (id: string, title: string, patch: Record<string, unknown> = {}) =>
  ({ id, title, replies_policy: 'list', exclusive: false, ...patch })
const account = (id: string) => ({ id, acct: `user${id}`, username: `user${id}`, display_name: '' })

describe('CaribouClient lists', () => {
  it('fetchLists reads the reader\'s lists', async () => {
    server.use(http.get(`${API}/v1/lists`, () => HttpResponse.json([list('1', 'Friends'), list('2', 'News')])))
    const lists = await createCaribouClient(userKey, sessionSource()).fetchLists()
    expect(lists.map((l) => l.title)).toEqual(['Friends', 'News'])
    expect(lists[0]!.repliesPolicy).toBe('list')
  })

  it('fetchList reads one list', async () => {
    server.use(http.get(`${API}/v1/lists/:id`, ({ params }) => HttpResponse.json(list(String(params.id), 'Friends'))))
    const l = await createCaribouClient(userKey, sessionSource()).fetchList('7')
    expect(l).toMatchObject({ id: '7', title: 'Friends' })
  })

  it('createList posts the title, the replies policy and exclusive', async () => {
    let body: unknown = null
    server.use(http.post(`${API}/v1/lists`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json(list('9', 'Cats', { replies_policy: 'none', exclusive: true }))
    }))
    const l = await createCaribouClient(userKey, sessionSource())
      .createList({ title: 'Cats', repliesPolicy: 'none', exclusive: true })
    expect(body).toEqual({ title: 'Cats', replies_policy: 'none', exclusive: true })
    expect(l).toMatchObject({ id: '9', repliesPolicy: 'none', exclusive: true })
  })

  it('createList leaves out what the caller did not set', async () => {
    let body: unknown = null
    server.use(http.post(`${API}/v1/lists`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json(list('9', 'Cats'))
    }))
    await createCaribouClient(userKey, sessionSource()).createList({ title: 'Cats' })
    expect(body).toEqual({ title: 'Cats' })
  })

  it('updateList puts the new fields; deleteList deletes', async () => {
    const calls: string[] = []
    let body: unknown = null
    server.use(
      http.put(`${API}/v1/lists/:id`, async ({ request, params }) => {
        calls.push(`put ${String(params.id)}`)
        body = await request.json()
        return HttpResponse.json(list(String(params.id), 'Renamed', { replies_policy: 'followed' }))
      }),
      http.delete(`${API}/v1/lists/:id`, ({ params }) => {
        calls.push(`delete ${String(params.id)}`)
        return HttpResponse.json({})
      }),
    )
    const c = createCaribouClient(userKey, sessionSource())
    const l = await c.updateList('3', { title: 'Renamed', repliesPolicy: 'followed' })
    expect(l.title).toBe('Renamed')
    expect(body).toEqual({ title: 'Renamed', replies_policy: 'followed' })
    await c.deleteList('3')
    expect(calls).toEqual(['put 3', 'delete 3'])
  })

  it('fetchListAccounts follows the Link header to the end', async () => {
    const seen: Array<string | null> = []
    server.use(http.get(`${API}/v1/lists/:id/accounts`, ({ request }) => {
      const maxId = new URL(request.url).searchParams.get('max_id')
      seen.push(maxId)
      if (maxId === null) {
        return HttpResponse.json([account('9'), account('5')], {
          headers: { link: `<${API}/v1/lists/3/accounts?max_id=300>; rel="next"` },
        })
      }
      return HttpResponse.json([account('2')])
    }))
    const accounts = await createCaribouClient(userKey, sessionSource()).fetchListAccounts('3')
    expect(accounts.map((a) => a.id)).toEqual(['9', '5', '2'])
    expect(seen).toEqual([null, '300'])
  })

  it('addListAccounts and removeListAccounts send the account ids', async () => {
    const calls: Array<{ method: string; ids: unknown }> = []
    const record = async ({ request }: { request: Request }) => {
      const url = new URL(request.url)
      // A DELETE carries its ids in the query; masto sends a POST's in the body.
      const ids = request.method === 'DELETE' && url.searchParams.getAll('account_ids[]').length > 0
        ? url.searchParams.getAll('account_ids[]')
        : ((await request.json()) as { account_ids: unknown }).account_ids
      calls.push({ method: request.method, ids })
      return HttpResponse.json({})
    }
    server.use(
      http.post(`${API}/v1/lists/:id/accounts`, record),
      http.delete(`${API}/v1/lists/:id/accounts`, record),
    )
    const c = createCaribouClient(userKey, sessionSource())
    await c.addListAccounts('3', ['7'])
    await c.removeListAccounts('3', ['7'])
    expect(calls).toEqual([{ method: 'POST', ids: ['7'] }, { method: 'DELETE', ids: ['7'] }])
  })

  it('fetchAccountLists reads the reader\'s lists that hold an account', async () => {
    const paths: string[] = []
    server.use(http.get(`${API}/v1/accounts/:id/lists`, ({ request }) => {
      paths.push(new URL(request.url).pathname)
      return HttpResponse.json([list('1', 'Friends')])
    }))
    const lists = await createCaribouClient(userKey, sessionSource()).fetchAccountLists('7')
    expect(lists.map((l) => l.id)).toEqual(['1'])
    expect(paths).toEqual(['/api/v1/accounts/7/lists'])
  })

  it('reads a list timeline', async () => {
    const paths: string[] = []
    server.use(http.get(`${API}/v1/timelines/list/:id`, ({ request }) => {
      paths.push(new URL(request.url).pathname)
      return HttpResponse.json([])
    }))
    await createCaribouClient(userKey, sessionSource()).fetchTimeline({ type: 'list', id: '3' })
    expect(paths).toEqual(['/api/v1/timelines/list/3'])
  })

  it('a 404 on a list is not_found', async () => {
    server.use(http.get(`${API}/v1/lists/:id`, () => HttpResponse.json({ error: 'Record not found' }, { status: 404 })))
    await expect(createCaribouClient(userKey, sessionSource()).fetchList('7'))
      .rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('CaribouClient lists: ids in the path', () => {
  it('encodes a list id and an account id, so neither can leave its path segment', async () => {
    const paths: string[] = []
    server.use(
      http.get(`${API}/v1/lists/:id`, ({ request }) => {
        paths.push(new URL(request.url).pathname)
        return HttpResponse.json(list('x', 'X'))
      }),
      http.get(`${API}/v1/accounts/:id/lists`, ({ request }) => {
        paths.push(new URL(request.url).pathname)
        return HttpResponse.json([])
      }),
    )
    const c = createCaribouClient(userKey, sessionSource())
    await c.fetchList('a/b')
    await c.fetchAccountLists('7?x')
    expect(paths).toEqual(['/api/v1/lists/a%2Fb', '/api/v1/accounts/7%3Fx/lists'])
  })
})
