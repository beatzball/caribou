import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { toUserKey } from '@beatzball/caribou-auth'
import { createCaribouClient } from '../create-client.js'
import { server } from './fixtures/server.js'
import { handlers } from './fixtures/handlers.js'
import { makeStatus, sampleAccount } from './fixtures/status.js'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers(...handlers))
afterAll(() => server.close())

const userKey = toUserKey('alice', 'fosstodon.org')

function sessionSource() {
  return {
    get: () => ({ userKey, server: 'fosstodon.org', token: 'TOKEN-1' }),
    onUnauthorized: vi.fn(),
  }
}

const url = 'https://fosstodon.org/api/v1/notifications'

function makeNotification(id: string, type: string) {
  return {
    id, type, created_at: '2024-01-01T00:00:00.000Z', account: sampleAccount,
    group_key: `ungrouped-${id}`,
    ...(type === 'follow' ? {} : { status: makeStatus(`s${id}`) }),
  }
}

describe('CaribouClient.fetchNotifications', () => {
  it('GETs /notifications with no filter and returns camel-cased notifications', async () => {
    let query = ''
    server.use(http.get(url, ({ request }) => {
      query = new URL(request.url).search
      return HttpResponse.json([makeNotification('2', 'mention'), makeNotification('1', 'follow')])
    }))
    const c = createCaribouClient(userKey, sessionSource())
    const ns = await c.fetchNotifications()
    expect(query).toBe('')
    expect(ns.map((n) => n.type)).toEqual(['mention', 'follow'])
    expect(ns[0]!.createdAt).toBe('2024-01-01T00:00:00.000Z')
    expect(ns[0]!.status?.id).toBe('s2')
  })

  it('sends types[], since_id, max_id and limit', async () => {
    let params: URLSearchParams | null = null
    server.use(http.get(url, ({ request }) => {
      params = new URL(request.url).searchParams
      return HttpResponse.json([])
    }))
    const c = createCaribouClient(userKey, sessionSource())
    await c.fetchNotifications({ types: ['mention'], sinceId: '5', maxId: '9', limit: 40 })
    const p = params as unknown as URLSearchParams
    expect(p.getAll('types[]')).toEqual(['mention'])
    expect(p.get('since_id')).toBe('5')
    expect(p.get('max_id')).toBe('9')
    expect(p.get('limit')).toBe('40')
  })

  it('treats an empty types list as no filter', async () => {
    let query = 'unset'
    server.use(http.get(url, ({ request }) => {
      query = new URL(request.url).search
      return HttpResponse.json([])
    }))
    const c = createCaribouClient(userKey, sessionSource())
    await c.fetchNotifications({ types: [] })
    expect(query).toBe('')
  })

  it('reports a 401 as unauthorized', async () => {
    server.use(http.get(url, () => HttpResponse.json({ error: 'x' }, { status: 401 })))
    const source = sessionSource()
    const c = createCaribouClient(userKey, source)
    await expect(c.fetchNotifications()).rejects.toMatchObject({ code: 'unauthorized' })
    expect(source.onUnauthorized).toHaveBeenCalledOnce()
  })
})
