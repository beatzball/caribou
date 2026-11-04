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

const poll = {
  id: 'p1', expires_at: '2026-11-05T00:00:00.000Z', expired: false, multiple: true,
  votes_count: 3, voters_count: 2, voted: true, own_votes: [0, 2],
  options: [{ title: 'a', votes_count: 2 }, { title: 'b', votes_count: 0 }, { title: 'c', votes_count: 1 }],
  emojis: [],
}

describe('CaribouClient polls', () => {
  it('votePoll POSTs the choices to /polls/:id/votes and returns the poll', async () => {
    let seen: { id: string; body: unknown } | undefined
    server.use(http.post('https://fosstodon.org/api/v1/polls/:id/votes', async ({ request, params }) => {
      seen = { id: String(params.id), body: await request.json() }
      return HttpResponse.json(poll)
    }))
    const c = createCaribouClient(userKey, sessionSource())
    const p = await c.votePoll('p1', [0, 2])
    expect(seen).toEqual({ id: 'p1', body: { choices: [0, 2] } })
    expect(p.ownVotes).toEqual([0, 2])
    expect(p.votersCount).toBe(2)
  })

  it('two votes are two requests, never merged', async () => {
    let hits = 0
    server.use(http.post('https://fosstodon.org/api/v1/polls/:id/votes', () => {
      hits += 1
      return HttpResponse.json(poll)
    }))
    const c = createCaribouClient(userKey, sessionSource())
    await Promise.all([c.votePoll('p1', [0]), c.votePoll('p1', [0])])
    expect(hits).toBe(2)
  })

  it('fetchPoll GETs /polls/:id', async () => {
    server.use(http.get('https://fosstodon.org/api/v1/polls/:id', ({ params }) =>
      HttpResponse.json({ ...poll, id: String(params.id) })))
    const c = createCaribouClient(userKey, sessionSource())
    const p = await c.fetchPoll('p9')
    expect(p.id).toBe('p9')
    expect(p.options[0]!.votesCount).toBe(2)
  })

  it('a refused vote rejects with a CaribouError', async () => {
    server.use(http.post('https://fosstodon.org/api/v1/polls/:id/votes', () =>
      HttpResponse.json({ error: 'You have already voted on this poll' }, { status: 422 })))
    const c = createCaribouClient(userKey, sessionSource())
    await expect(c.votePoll('p1', [0])).rejects.toMatchObject({ code: expect.any(String) })
  })

  it('createStatus sends a poll, with no media', async () => {
    let body: Record<string, unknown> | undefined
    server.use(http.post('https://fosstodon.org/api/v1/statuses', async ({ request }) => {
      body = await request.json() as Record<string, unknown>
      return HttpResponse.json(makeStatus('n1'))
    }))
    const c = createCaribouClient(userKey, sessionSource())
    await c.createStatus({
      status: 'which?', visibility: 'public',
      poll: { options: ['a', 'b'], expiresIn: 86400, multiple: true, hideTotals: false },
    })
    expect(body).toMatchObject({
      status: 'which?',
      poll: { options: ['a', 'b'], expires_in: 86400, multiple: true, hide_totals: false },
    })
    expect(body).not.toHaveProperty('media_ids')
  })
})
