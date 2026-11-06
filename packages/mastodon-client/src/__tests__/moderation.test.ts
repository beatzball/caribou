import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { toUserKey } from '@beatzball/caribou-auth'
import { createCaribouClient } from '../create-client.js'
import { server } from './fixtures/server.js'
import { handlers } from './fixtures/handlers.js'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers(...handlers))
afterAll(() => server.close())

const userKey = toUserKey('beatzball', 'fosstodon.org')
const API = 'https://fosstodon.org/api'

function sessionSource() {
  return {
    get: () => ({ userKey, server: 'fosstodon.org', token: 'TOKEN-1' }),
    onUnauthorized: vi.fn(),
  }
}

const relationship = (id: string, patch: Record<string, unknown> = {}) => ({
  id, following: false, followed_by: false, blocking: false, muting: false,
  muting_notifications: false, requested: false, ...patch,
})

const account = (id: string) => ({ id, acct: `user${id}`, username: `user${id}`, display_name: '' })

describe('CaribouClient mute and block', () => {
  it('mute posts with notifications on and returns the relationship', async () => {
    let body: unknown = null
    server.use(http.post(`${API}/v1/accounts/:id/mute`, async ({ request, params }) => {
      body = await request.json()
      return HttpResponse.json(relationship(String(params.id), { muting: true, muting_notifications: true }))
    }))
    const rel = await createCaribouClient(userKey, sessionSource()).mute('7')
    expect(rel.muting).toBe(true)
    expect(rel.mutingNotifications).toBe(true)
    expect(body).toEqual({ notifications: true })
  })

  it.each([
    ['unmute', 'unmute', { muting: false }],
    ['block', 'block', { blocking: true }],
    ['unblock', 'unblock', { blocking: false }],
  ] as const)('%s posts to the account', async (method, path, patch) => {
    const calls: string[] = []
    server.use(http.post(`${API}/v1/accounts/:id/${path}`, ({ params }) => {
      calls.push(String(params.id))
      return HttpResponse.json(relationship(String(params.id), patch))
    }))
    const c = createCaribouClient(userKey, sessionSource())
    const rel = await c[method]('7')
    expect(calls).toEqual(['7'])
    expect(rel.id).toBe('7')
  })

  it('two mutes of one account are two requests, not one shared result', async () => {
    let hits = 0
    server.use(http.post(`${API}/v1/accounts/:id/mute`, ({ params }) => {
      hits += 1
      return HttpResponse.json(relationship(String(params.id), { muting: true }))
    }))
    const c = createCaribouClient(userKey, sessionSource())
    await Promise.all([c.mute('7'), c.mute('7')])
    expect(hits).toBe(2)
  })
})

describe('CaribouClient moderation lists', () => {
  it.each(['mutes', 'blocks'] as const)('%s pages by the Link header cursor', async (kind) => {
    const seen: Array<string | null> = []
    server.use(http.get(`${API}/v1/${kind}`, ({ request }) => {
      const maxId = new URL(request.url).searchParams.get('max_id')
      seen.push(maxId)
      if (maxId === null) {
        return HttpResponse.json([account('9'), account('5')], {
          headers: { link: `<${API}/v1/${kind}?max_id=300>; rel="next", <${API}/v1/${kind}?min_id=400>; rel="prev"` },
        })
      }
      return HttpResponse.json([account('1')])
    }))
    const c = createCaribouClient(userKey, sessionSource())
    const fetch = kind === 'mutes' ? c.fetchMutes : c.fetchBlocks
    const first = await fetch()
    expect(first.map((a) => a.id)).toEqual(['9', '5'])
    expect(first.nextCursor).toBe('300')
    const second = await fetch({ cursor: '300' })
    expect(second.map((a) => a.id)).toEqual(['1'])
    expect(second.nextCursor).toBeNull()
    expect(seen).toEqual([null, '300'])
  })

  it('fetchFilters reads filters v2 in camelCase', async () => {
    server.use(http.get(`${API}/v2/filters`, () => HttpResponse.json([{
      id: 'f1', title: 'Spoilers', context: ['home', 'public'], filter_action: 'warn',
      expires_at: null, keywords: [{ id: 'k1', keyword: 'finale', whole_word: true }], statuses: [],
    }])))
    const [f] = await createCaribouClient(userKey, sessionSource()).fetchFilters()
    expect(f!.title).toBe('Spoilers')
    expect(f!.filterAction).toBe('warn')
    expect(f!.keywords[0]!.wholeWord).toBe(true)
  })

  it('fetchFilters on a server without filters v2 rejects with not_found', async () => {
    server.use(http.get(`${API}/v2/filters`, () => HttpResponse.json({ error: 'Not found' }, { status: 404 })))
    await expect(createCaribouClient(userKey, sessionSource()).fetchFilters())
      .rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('CaribouClient fetchStatuses', () => {
  it('asks for every id in one request and returns camelCase statuses', async () => {
    let ids: string[] = []
    let auth: string | null = null
    server.use(http.get(`${API}/v1/statuses`, ({ request }) => {
      ids = new URL(request.url).searchParams.getAll('id[]')
      auth = request.headers.get('authorization')
      return HttpResponse.json(ids.map((id) => ({
        id, content: '', spoiler_text: '', filtered: [{ filter: { id: 'f', title: 'T', context: ['home'], filter_action: 'hide' } }],
      })))
    }))
    const statuses = await createCaribouClient(userKey, sessionSource()).fetchStatuses(['1', '2'])
    expect(ids).toEqual(['1', '2'])
    expect(auth).toBe('Bearer TOKEN-1')
    expect(statuses.map((s) => s.id)).toEqual(['1', '2'])
    expect(statuses[0]!.filtered![0]!.filter.filterAction).toBe('hide')
  })

  it('rejects with not_found on an older server', async () => {
    server.use(http.get(`${API}/v1/statuses`, () => HttpResponse.json({ error: 'Not found' }, { status: 404 })))
    await expect(createCaribouClient(userKey, sessionSource()).fetchStatuses(['1']))
      .rejects.toMatchObject({ code: 'not_found' })
  })
})
