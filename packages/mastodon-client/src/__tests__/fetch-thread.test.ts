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

describe('CaribouClient.fetchThread', () => {
  it('returns { ancestors, descendants } for a known status id', async () => {
    const c = createCaribouClient(userKey, sessionSource())
    const ctx = await c.fetchThread('110')
    expect(ctx.ancestors).toEqual([])
    expect(ctx.descendants).toEqual([])
  })

  it('throws not_found on 404', async () => {
    const c = createCaribouClient(userKey, sessionSource())
    await expect(c.fetchThread('999')).rejects.toMatchObject({ code: 'not_found' })
  })
})
