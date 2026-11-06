import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { toUserKey } from '@beatzball/caribou-auth'
import { createCaribouClient } from '../create-client.js'
import { server } from './fixtures/server.js'
import { handlers } from './fixtures/handlers.js'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers(...handlers))
afterAll(() => server.close())

const userKey = toUserKey('beatzball', 'fosstodon.org')

function sessionSource() {
  return {
    get: () => ({ userKey, server: 'fosstodon.org', token: 'TOKEN-1' }),
    onUnauthorized: vi.fn(),
  }
}

function captureQuery(): { url?: URL } {
  const ref: { url?: URL } = {}
  server.use(
    http.get('https://fosstodon.org/api/v1/accounts/:id/statuses', ({ request }) => {
      ref.url = new URL(request.url)
      return HttpResponse.json([])
    }),
  )
  return ref
}

describe('CaribouClient.fetchAccountStatuses', () => {
  it('tab=posts sends exclude_replies=true (and not only_media)', async () => {
    const ref = captureQuery()
    const c = createCaribouClient(userKey, sessionSource())
    await c.fetchAccountStatuses('42', { tab: 'posts' })
    expect(ref.url?.searchParams.get('exclude_replies')).toBe('true')
    expect(ref.url?.searchParams.get('only_media')).toBeNull()
  })

  it('tab=media sends only_media=true (and not exclude_replies)', async () => {
    const ref = captureQuery()
    const c = createCaribouClient(userKey, sessionSource())
    await c.fetchAccountStatuses('42', { tab: 'media' })
    expect(ref.url?.searchParams.get('only_media')).toBe('true')
    expect(ref.url?.searchParams.get('exclude_replies')).toBeNull()
  })

  it('tab=replies sends neither flag', async () => {
    const ref = captureQuery()
    const c = createCaribouClient(userKey, sessionSource())
    await c.fetchAccountStatuses('42', { tab: 'replies' })
    expect(ref.url?.searchParams.get('only_media')).toBeNull()
    expect(ref.url?.searchParams.get('exclude_replies')).toBeNull()
  })

  it('threads the cursor through to the request as max_id', async () => {
    const ref = captureQuery()
    const c = createCaribouClient(userKey, sessionSource())
    await c.fetchAccountStatuses('42', { tab: 'posts', cursor: '110' })
    expect(ref.url?.searchParams.get('max_id')).toBe('110')
  })

  it('returns a page whose cursor is the last status id, or null when empty', async () => {
    server.use(
      http.get('https://fosstodon.org/api/v1/accounts/:id/statuses', ({ request }) =>
        new URL(request.url).searchParams.get('max_id') === '5'
          ? HttpResponse.json([])
          : HttpResponse.json([{ id: '9' }, { id: '5' }])),
    )
    const c = createCaribouClient(userKey, sessionSource())
    const page = await c.fetchAccountStatuses('42', { tab: 'posts' })
    expect(page.map((s) => s.id)).toEqual(['9', '5'])
    expect(page.nextCursor).toBe('5')
    const end = await c.fetchAccountStatuses('42', { tab: 'posts', cursor: '5' })
    expect(end.nextCursor).toBeNull()
  })
})
