import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { toUserKey } from '@beatzball/caribou-auth'
import { createCaribouClient, searchPublic } from '../create-client.js'
import { CaribouError } from '../caribou-error.js'
import { server } from './fixtures/server.js'
import { handlers } from './fixtures/handlers.js'
import { makeStatus, sampleAccount } from './fixtures/status.js'

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

const SEARCH = 'https://example.social/api/v2/search'

function answer(seen: { url: URL; auth: string | null }[]) {
  return http.get(SEARCH, ({ request }) => {
    seen.push({ url: new URL(request.url), auth: request.headers.get('authorization') })
    return HttpResponse.json({
      accounts: [{ ...sampleAccount, display_name: 'Bob' }],
      statuses: [makeStatus('9')],
      hashtags: [{ name: 'caturday', url: 'https://example.social/tags/caturday', history: [] }],
    })
  })
}

describe('CaribouClient search', () => {
  it('sends the query with the token and returns camel-cased results', async () => {
    const seen: { url: URL; auth: string | null }[] = []
    server.use(answer(seen))
    const c = createCaribouClient(userKey, sessionSource())
    const r = await c.search({ q: 'bob', resolve: true, limit: 20 })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.url.searchParams.get('q')).toBe('bob')
    expect(seen[0]!.url.searchParams.get('resolve')).toBe('true')
    expect(seen[0]!.url.searchParams.get('limit')).toBe('20')
    expect(seen[0]!.url.searchParams.has('type')).toBe(false)
    expect(seen[0]!.auth).toBe('Bearer TOKEN-1')
    expect(r.accounts[0]!.displayName).toBe('Bob')
    expect(r.statuses[0]!.id).toBe('9')
    expect(r.hashtags[0]!.name).toBe('caturday')
  })

  it('passes a type and leaves resolve out when it is false', async () => {
    const seen: { url: URL; auth: string | null }[] = []
    server.use(answer(seen))
    const c = createCaribouClient(userKey, sessionSource())
    await c.search({ q: '#cats', type: 'hashtags', resolve: false })
    expect(seen[0]!.url.searchParams.get('type')).toBe('hashtags')
    expect(seen[0]!.url.searchParams.has('resolve')).toBe(false)
  })

  it('reports a 401 to the session and throws unauthorized', async () => {
    server.use(http.get(SEARCH, () => HttpResponse.json({ error: 'no' }, { status: 401 })))
    const s = sessionSource()
    const c = createCaribouClient(userKey, s)
    await expect(c.search({ q: 'x' })).rejects.toMatchObject({ code: 'unauthorized' })
    expect(s.onUnauthorized).toHaveBeenCalledOnce()
  })
})

describe('searchPublic', () => {
  it('asks the server with no token and never resolves', async () => {
    const seen: { url: URL; auth: string | null }[] = []
    server.use(answer(seen))
    const r = await searchPublic('example.social', { q: 'bob', limit: 5 })
    expect(seen[0]!.auth).toBeNull()
    expect(seen[0]!.url.searchParams.has('resolve')).toBe(false)
    expect(seen[0]!.url.searchParams.get('limit')).toBe('5')
    expect(r.accounts[0]!.displayName).toBe('Bob')
  })

  it('throws a CaribouError on a 401', async () => {
    server.use(http.get(SEARCH, () => HttpResponse.json({ error: 'no' }, { status: 401 })))
    const err = await searchPublic('example.social', { q: 'x' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CaribouError)
    expect((err as CaribouError).code).toBe('unauthorized')
  })
})
