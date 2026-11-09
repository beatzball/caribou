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

  it('pages by the last id: nextCursor is its id, and null on an empty page', async () => {
    server.use(http.get(url, ({ request }) => {
      const maxId = new URL(request.url).searchParams.get('max_id')
      return HttpResponse.json(maxId === '1'
        ? []
        : [makeNotification('2', 'mention'), makeNotification('1', 'follow')])
    }))
    const c = createCaribouClient(userKey, sessionSource())
    const first = await c.fetchNotifications()
    expect(first.nextCursor).toBe('1')
    const end = await c.fetchNotifications({ cursor: first.nextCursor! })
    expect(end).toHaveLength(0)
    expect(end.nextCursor).toBeNull()
  })

  it('sends cursor as max_id', async () => {
    let params: URLSearchParams | null = null
    server.use(http.get(url, ({ request }) => {
      params = new URL(request.url).searchParams
      return HttpResponse.json([])
    }))
    const c = createCaribouClient(userKey, sessionSource())
    await c.fetchNotifications({ cursor: '9' })
    expect((params as unknown as URLSearchParams).get('max_id')).toBe('9')
    server.use(http.get('https://fosstodon.org/api/v2/notifications', ({ request }) => {
      params = new URL(request.url).searchParams
      return HttpResponse.json({ accounts: [], statuses: [], notification_groups: [] })
    }))
    await c.fetchGroupedNotifications({ cursor: '8' })
    expect((params as unknown as URLSearchParams).get('max_id')).toBe('8')
  })

  it('sends types[], since_id, min_id, max_id and limit', async () => {
    let params: URLSearchParams | null = null
    server.use(http.get(url, ({ request }) => {
      params = new URL(request.url).searchParams
      return HttpResponse.json([])
    }))
    const c = createCaribouClient(userKey, sessionSource())
    await c.fetchNotifications({ types: ['mention'], sinceId: '5', minId: '6', maxId: '9', limit: 40 })
    const p = params as unknown as URLSearchParams
    expect(p.getAll('types[]')).toEqual(['mention'])
    expect(p.get('since_id')).toBe('5')
    expect(p.get('min_id')).toBe('6')
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

const v2url = 'https://fosstodon.org/api/v2/notifications'

describe('CaribouClient.fetchGroupedNotifications', () => {
  it('GETs /api/v2/notifications, asks to group favourites, boosts and follows, and returns the page camel-cased', async () => {
    let params: URLSearchParams | null = null
    server.use(http.get(v2url, ({ request }) => {
      params = new URL(request.url).searchParams
      return HttpResponse.json({
        accounts: [sampleAccount],
        statuses: [makeStatus('s1')],
        notification_groups: [{
          group_key: 'favourite-s1-1', notifications_count: 14, type: 'favourite',
          most_recent_notification_id: '20', page_min_id: '7', page_max_id: '20',
          sample_account_ids: [sampleAccount.id], status_id: 's1',
        }],
      })
    }))
    const c = createCaribouClient(userKey, sessionSource())
    const page = await c.fetchGroupedNotifications({ types: ['mention'], minId: '1', maxId: '9', limit: 40 })
    const p = params as unknown as URLSearchParams
    expect(p.getAll('grouped_types[]')).toEqual(['favourite', 'reblog', 'follow'])
    expect(p.getAll('types[]')).toEqual(['mention'])
    expect(p.get('min_id')).toBe('1')
    expect(p.get('max_id')).toBe('9')
    expect(p.get('limit')).toBe('40')
    expect(page.notificationGroups).toEqual([{
      groupKey: 'favourite-s1-1', notificationsCount: 14, type: 'favourite',
      mostRecentNotificationId: '20', pageMinId: '7', pageMaxId: '20',
      sampleAccountIds: [sampleAccount.id], statusId: 's1',
    }])
    expect(page.accounts[0]!.id).toBe(sampleAccount.id)
    expect(page.statuses[0]!.id).toBe('s1')
    // The oldest id the page covers names the next one.
    expect(page.nextCursor).toBe('7')
  })

  it('gives a grouped page with no groups a null cursor', async () => {
    server.use(http.get(v2url, () => HttpResponse.json({ accounts: [], statuses: [], notification_groups: [] })))
    const c = createCaribouClient(userKey, sessionSource())
    expect((await c.fetchGroupedNotifications()).nextCursor).toBeNull()
  })

  it('reports an older server, which has no such endpoint, as not_found', async () => {
    server.use(http.get(v2url, () => HttpResponse.json({ error: 'Not found' }, { status: 404 })))
    const c = createCaribouClient(userKey, sessionSource())
    await expect(c.fetchGroupedNotifications()).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('CaribouClient.fetchNotificationGroupAccounts', () => {
  it('GETs every account of a group, with the key encoded in the path', async () => {
    let path = ''
    server.use(http.get('https://fosstodon.org/api/v2/notifications/:key/accounts', ({ request }) => {
      path = new URL(request.url).pathname
      return HttpResponse.json([sampleAccount])
    }))
    const c = createCaribouClient(userKey, sessionSource())
    const accounts = await c.fetchNotificationGroupAccounts('favourite-1/2 3')
    expect(path).toBe('/api/v2/notifications/favourite-1%2F2%203/accounts')
    expect(accounts.map((a) => a.id)).toEqual([sampleAccount.id])
  })
})

describe('the HTTP status on an error', () => {
  it('is kept, so a caller can tell a missing endpoint (501) from a failure', async () => {
    server.use(http.get(v2url, () => HttpResponse.json({ error: 'x' }, { status: 501 })))
    const c = createCaribouClient(userKey, sessionSource())
    await expect(c.fetchGroupedNotifications()).rejects.toMatchObject({ code: 'server_error', status: 501 })
  })
})
