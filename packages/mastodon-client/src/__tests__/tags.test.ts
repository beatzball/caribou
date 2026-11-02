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

function sessionSource() {
  return {
    get: () => ({ userKey, server: 'example.social', token: 'TOKEN-1' }),
    onUnauthorized: vi.fn(),
  }
}

const tag = (name: string, following: boolean) => ({
  id: '5', name, url: `https://example.social/tags/${name}`, history: [], following,
})

describe('CaribouClient tags', () => {
  it('fetchTag reads the tag and whether the reader follows it', async () => {
    server.use(http.get('https://example.social/api/v1/tags/:name', ({ params }) =>
      HttpResponse.json(tag(String(params.name), true))))
    const c = createCaribouClient(userKey, sessionSource())
    const t = await c.fetchTag('caturday')
    expect(t.name).toBe('caturday')
    expect(t.following).toBe(true)
  })

  it('encodes a non-ASCII tag name in the path', async () => {
    const paths: string[] = []
    server.use(http.get('https://example.social/api/v1/tags/:name', ({ request, params }) => {
      paths.push(new URL(request.url).pathname)
      return HttpResponse.json(tag(String(params.name), false))
    }))
    const c = createCaribouClient(userKey, sessionSource())
    await c.fetchTag('café')
    expect(paths).toEqual([`/api/v1/tags/${encodeURIComponent('café')}`])
  })

  it('followTag and unfollowTag post to the tag', async () => {
    const calls: string[] = []
    server.use(
      http.post('https://example.social/api/v1/tags/:name/follow', ({ params }) => {
        calls.push(`follow ${String(params.name)}`)
        return HttpResponse.json(tag(String(params.name), true))
      }),
      http.post('https://example.social/api/v1/tags/:name/unfollow', ({ params }) => {
        calls.push(`unfollow ${String(params.name)}`)
        return HttpResponse.json(tag(String(params.name), false))
      }),
    )
    const c = createCaribouClient(userKey, sessionSource())
    expect((await c.followTag('ai')).following).toBe(true)
    expect((await c.unfollowTag('ai')).following).toBe(false)
    expect(calls).toEqual(['follow ai', 'unfollow ai'])
  })

  it('reads a hashtag timeline with the name encoded once', async () => {
    const paths: string[] = []
    server.use(http.get('https://example.social/api/v1/timelines/tag/:name', ({ request }) => {
      paths.push(new URL(request.url).pathname)
      return HttpResponse.json([])
    }))
    const c = createCaribouClient(userKey, sessionSource())
    await c.fetchTimeline({ type: 'hashtag', tag: '日本' })
    expect(paths).toEqual([`/api/v1/timelines/tag/${encodeURIComponent('日本')}`])
  })
})
