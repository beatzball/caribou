import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { toUserKey } from '@beatzball/caribou-auth'
import { createCaribouClient } from '../create-client.js'
import { server } from './fixtures/server.js'
import { handlers } from './fixtures/handlers.js'
import { makeStatus } from './fixtures/status.js'

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

const base = 'https://fosstodon.org/api/v1/statuses/:id'

describe('CaribouClient status actions', () => {
  const flags = [
    ['favourite', { favourited: true, favourites_count: 1 }, 'favourited'],
    ['unfavourite', { favourited: false }, 'favourited'],
    ['unreblog', { reblogged: false }, 'reblogged'],
    ['bookmark', { bookmarked: true }, 'bookmarked'],
    ['unbookmark', { bookmarked: false }, 'bookmarked'],
  ] as const

  for (const [method, patch, field] of flags) {
    it(`${method} POSTs to /statuses/:id/${method} and returns the status`, async () => {
      const calls: string[] = []
      server.use(http.post(`${base}/${method}`, ({ params, request }) => {
        calls.push(`${request.method} ${String(params.id)}`)
        return HttpResponse.json({ ...makeStatus(String(params.id)), ...patch })
      }))
      const c = createCaribouClient(userKey, sessionSource())
      const s = await c[method]('110')
      expect(calls).toEqual(['POST 110'])
      expect(s.id).toBe('110')
      expect(s[field]).toBe(Object.values(patch)[0])
    })
  }

  it('reblog returns the boosted post, not the wrapper', async () => {
    server.use(http.post(`${base}/reblog`, ({ params }) => HttpResponse.json({
      ...makeStatus('900'),
      reblog: { ...makeStatus(String(params.id)), reblogged: true, reblogs_count: 1 },
    })))
    const c = createCaribouClient(userKey, sessionSource())
    const s = await c.reblog('110')
    expect(s.id).toBe('110')
    expect(s.reblogged).toBe(true)
    expect(s.reblogsCount).toBe(1)
  })

  it('does not merge two writes in flight for the same status', async () => {
    let hits = 0
    server.use(
      http.post(`${base}/favourite`, ({ params }) => {
        hits += 1
        return HttpResponse.json({ ...makeStatus(String(params.id)), favourited: true })
      }),
      http.post(`${base}/unfavourite`, ({ params }) => {
        hits += 1
        return HttpResponse.json({ ...makeStatus(String(params.id)), favourited: false })
      }),
    )
    const c = createCaribouClient(userKey, sessionSource())
    const [a, b, d] = await Promise.all([c.favourite('110'), c.favourite('110'), c.unfavourite('110')])
    expect(hits).toBe(3)
    expect(a.favourited).toBe(true)
    expect(b.favourited).toBe(true)
    expect(d.favourited).toBe(false)
  })

  it('normalizes a server error and reports 401 as unauthorized', async () => {
    server.use(http.post(`${base}/favourite`, () =>
      HttpResponse.json({ error: 'The access token is invalid' }, { status: 401 })))
    const src = sessionSource()
    const c = createCaribouClient(userKey, src)
    await expect(c.favourite('110')).rejects.toMatchObject({ code: 'unauthorized' })
    expect(src.onUnauthorized).toHaveBeenCalledOnce()
  })

  it('rejects with a CaribouError on 500', async () => {
    server.use(http.post(`${base}/bookmark`, () =>
      HttpResponse.json({ error: 'boom' }, { status: 500 })))
    const c = createCaribouClient(userKey, sessionSource())
    await expect(c.bookmark('110')).rejects.toMatchObject({ name: 'CaribouError' })
  })
})
