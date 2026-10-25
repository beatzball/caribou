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

function sessionSource() {
  return {
    get: () => ({ userKey, server: 'fosstodon.org', token: 'TOKEN-1' }),
    onUnauthorized: vi.fn(),
  }
}

function relationship(id: string, patch: Record<string, unknown> = {}) {
  return {
    id, following: false, showing_reblogs: false, notifying: false, languages: [],
    followed_by: false, blocking: false, blocked_by: false, muting: false,
    muting_notifications: false, requested: false, requested_by: false,
    domain_blocking: false, endorsed: false, note: '',
    ...patch,
  }
}

describe('CaribouClient relationships', () => {
  it('fetchRelationships sends every id and returns camelCase relationships', async () => {
    let ids: string[] = []
    server.use(http.get('https://fosstodon.org/api/v1/accounts/relationships', ({ request }) => {
      ids = new URL(request.url).searchParams.getAll('id[]')
      return HttpResponse.json(ids.map((id) => relationship(id, { followed_by: true })))
    }))
    const c = createCaribouClient(userKey, sessionSource())
    const rels = await c.fetchRelationships(['1', '2'])
    expect(ids).toEqual(['1', '2'])
    expect(rels.map((r) => r.id)).toEqual(['1', '2'])
    expect(rels[0]!.followedBy).toBe(true)
  })

  it('follow posts to the account and returns the new relationship', async () => {
    const calls: string[] = []
    server.use(http.post('https://fosstodon.org/api/v1/accounts/:id/follow', ({ params }) => {
      calls.push(String(params.id))
      return HttpResponse.json(relationship(String(params.id), { following: true }))
    }))
    const c = createCaribouClient(userKey, sessionSource())
    const rel = await c.follow('42')
    expect(calls).toEqual(['42'])
    expect(rel.following).toBe(true)
  })

  it('unfollow posts to the account and returns the new relationship', async () => {
    const calls: string[] = []
    server.use(http.post('https://fosstodon.org/api/v1/accounts/:id/unfollow', ({ params }) => {
      calls.push(String(params.id))
      return HttpResponse.json(relationship(String(params.id)))
    }))
    const c = createCaribouClient(userKey, sessionSource())
    const rel = await c.unfollow('42')
    expect(calls).toEqual(['42'])
    expect(rel.following).toBe(false)
  })

  // A follow and an unfollow of the same account are different writes; a
  // shared dedup key would hand the second caller the first one's result.
  it('does not merge a follow and an unfollow of the same account', async () => {
    const calls: string[] = []
    server.use(
      http.post('https://fosstodon.org/api/v1/accounts/:id/follow', ({ params }) => {
        calls.push('follow')
        return HttpResponse.json(relationship(String(params.id), { following: true }))
      }),
      http.post('https://fosstodon.org/api/v1/accounts/:id/unfollow', ({ params }) => {
        calls.push('unfollow')
        return HttpResponse.json(relationship(String(params.id)))
      }),
    )
    const c = createCaribouClient(userKey, sessionSource())
    const [a, b] = await Promise.all([c.follow('42'), c.unfollow('42')])
    expect(calls.sort()).toEqual(['follow', 'unfollow'])
    expect(a.following).toBe(true)
    expect(b.following).toBe(false)
  })

  it('normalizes an error and reports 401 as unauthorized', async () => {
    server.use(http.post('https://fosstodon.org/api/v1/accounts/:id/follow', () =>
      HttpResponse.json({ error: 'The access token is invalid' }, { status: 401 })))
    const source = sessionSource()
    const c = createCaribouClient(userKey, source)
    await expect(c.follow('42')).rejects.toMatchObject({ code: 'unauthorized' })
    expect(source.onUnauthorized).toHaveBeenCalledOnce()
  })
})
