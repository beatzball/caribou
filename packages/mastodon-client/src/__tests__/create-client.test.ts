import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { toUserKey } from '@beatzball/caribou-auth'
import { createCaribouClient } from '../create-client.js'
import { server } from './fixtures/server.js'
import { handlers, setNextStatuses } from './fixtures/handlers.js'
import { makeStatus } from './fixtures/status.js'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers(...handlers)
  setNextStatuses([makeStatus('s1'), makeStatus('s2')])
})
afterAll(() => server.close())

const userKey = toUserKey('beatzball', 'fosstodon.org')

function sessionSource() {
  return {
    get: () => ({ userKey, server: 'fosstodon.org', token: 'TOKEN-1' }),
    onUnauthorized: vi.fn(),
  }
}

describe('createCaribouClient', () => {
  it('fetchTimeline("home") returns statuses from the user’s instance', async () => {
    const sess = sessionSource()
    const client = createCaribouClient(userKey, sess)
    const statuses = await client.fetchTimeline('home')
    expect(statuses.map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('in-flight dedup: two concurrent fetchTimeline calls hit network once', async () => {
    const sess = sessionSource()
    const client = createCaribouClient(userKey, sess)
    let hits = 0
    server.use(
      http.get('https://fosstodon.org/api/v1/timelines/home', () => {
        hits += 1
        return HttpResponse.json([makeStatus('dedup1')])
      }),
    )
    const [a, b] = await Promise.all([client.fetchTimeline('home'), client.fetchTimeline('home')])
    expect(a).toBe(b)
    expect(hits).toBe(1)
  })

  it('maps 401 to CaribouError(unauthorized) AND calls onUnauthorized', async () => {
    const sess = sessionSource()
    const client = createCaribouClient(userKey, sess)
    server.use(
      http.get('https://fosstodon.org/api/v1/timelines/home', () =>
        HttpResponse.json({ error: 'unauthorized' }, { status: 401 }),
      ),
    )
    await expect(client.fetchTimeline('home')).rejects.toMatchObject({
      name: 'CaribouError', code: 'unauthorized',
    })
    expect(sess.onUnauthorized).toHaveBeenCalledOnce()
  })

  it('supports since_id for polling', async () => {
    const sess = sessionSource()
    const client = createCaribouClient(userKey, sess)
    server.use(
      http.get('https://fosstodon.org/api/v1/timelines/home', ({ request }) => {
        const sinceId = new URL(request.url).searchParams.get('since_id')
        if (sinceId === 's2') return HttpResponse.json([makeStatus('s3')])
        return HttpResponse.json([])
      }),
    )
    const newer = await client.fetchTimeline('home', { sinceId: 's2' })
    expect(newer.map((s) => s.id)).toEqual(['s3'])
  })

  it('fetchTimeline("local") fetches public timeline with local=true', async () => {
    const sess = sessionSource()
    const client = createCaribouClient(userKey, sess)
    server.use(
      http.get('https://fosstodon.org/api/v1/timelines/public', ({ request }) => {
        const local = new URL(request.url).searchParams.get('local')
        if (local === 'true') return HttpResponse.json([makeStatus('local-1')])
        return HttpResponse.json([])
      }),
    )
    const statuses = await client.fetchTimeline('local')
    expect(statuses.map((s) => s.id)).toEqual(['local-1'])
  })

  it('fetchTimeline("public") fetches public timeline', async () => {
    const sess = sessionSource()
    const client = createCaribouClient(userKey, sess)
    server.use(
      http.get('https://fosstodon.org/api/v1/timelines/public', () =>
        HttpResponse.json([makeStatus('pub-1')]),
      ),
    )
    const statuses = await client.fetchTimeline('public')
    expect(statuses.map((s) => s.id)).toEqual(['pub-1'])
  })

  it('fetchTimeline("bookmarks") fetches bookmarks', async () => {
    const sess = sessionSource()
    const client = createCaribouClient(userKey, sess)
    server.use(
      http.get('https://fosstodon.org/api/v1/bookmarks', () =>
        HttpResponse.json([makeStatus('bm-1')]),
      ),
    )
    const statuses = await client.fetchTimeline('bookmarks')
    expect(statuses.map((s) => s.id)).toEqual(['bm-1'])
  })

  it('fetchTimeline("bookmarks") pages with the Link header cursor, not the status id', async () => {
    const sess = sessionSource()
    const client = createCaribouClient(userKey, sess)
    const seen: Array<string | null> = []
    server.use(
      http.get('https://fosstodon.org/api/v1/bookmarks', ({ request }) => {
        const maxId = new URL(request.url).searchParams.get('max_id')
        seen.push(maxId)
        if (maxId === null) {
          return HttpResponse.json([makeStatus('s9'), makeStatus('s5')], {
            headers: {
              link: '<https://fosstodon.org/api/v1/bookmarks?max_id=700>; rel="next", '
                + '<https://fosstodon.org/api/v1/bookmarks?min_id=800>; rel="prev"',
            },
          })
        }
        if (maxId === '700') return HttpResponse.json([makeStatus('s1')])
        return HttpResponse.json([makeStatus('wrong')])
      }),
    )
    const first = await client.fetchTimeline('bookmarks')
    expect(first.map((s) => s.id)).toEqual(['s9', 's5'])
    // The store passes the last status id; the client sends the cursor.
    const second = await client.fetchTimeline('bookmarks', { maxId: 's5' })
    expect(second.map((s) => s.id)).toEqual(['s1'])
    // That page had no next link: the bookmarks end, with no request.
    const third = await client.fetchTimeline('bookmarks', { maxId: 's1' })
    expect(third).toEqual([])
    expect(seen).toEqual([null, '700'])
  })

  it('fetchTimeline("bookmarks") does not poll with a status id', async () => {
    const sess = sessionSource()
    const client = createCaribouClient(userKey, sess)
    let hits = 0
    server.use(
      http.get('https://fosstodon.org/api/v1/bookmarks', () => {
        hits += 1
        return HttpResponse.json([makeStatus('bm-1')])
      }),
    )
    expect(await client.fetchTimeline('bookmarks', { sinceId: 'bm-1' })).toEqual([])
    expect(hits).toBe(0)
  })

  it('fetchTimeline({ type: "hashtag", tag }) fetches tag timeline', async () => {
    const sess = sessionSource()
    const client = createCaribouClient(userKey, sess)
    server.use(
      http.get('https://fosstodon.org/api/v1/timelines/tag/caribou', () =>
        HttpResponse.json([makeStatus('tag-1')]),
      ),
    )
    const statuses = await client.fetchTimeline({ type: 'hashtag', tag: 'caribou' })
    expect(statuses.map((s) => s.id)).toEqual(['tag-1'])
  })

  it('fetchTimeline({ type: "list", id }) fetches list timeline', async () => {
    const sess = sessionSource()
    const client = createCaribouClient(userKey, sess)
    server.use(
      http.get('https://fosstodon.org/api/v1/timelines/list/42', () =>
        HttpResponse.json([makeStatus('list-1')]),
      ),
    )
    const statuses = await client.fetchTimeline({ type: 'list', id: '42' })
    expect(statuses.map((s) => s.id)).toEqual(['list-1'])
  })

  it('throws unauthorized when session.get() returns null', async () => {
    const onUnauthorized = vi.fn()
    const sess = { get: () => null, onUnauthorized }
    const client = createCaribouClient(userKey, sess)
    await expect(client.fetchTimeline('home')).rejects.toMatchObject({
      name: 'CaribouError', code: 'unauthorized',
    })
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })
})
