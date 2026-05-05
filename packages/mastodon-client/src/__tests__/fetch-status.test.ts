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

describe('CaribouClient.fetchStatus', () => {
  it('returns the status payload for a valid id', async () => {
    const c = createCaribouClient(userKey, sessionSource())
    const s = await c.fetchStatus('110')
    expect(s.id).toBe('110')
  })

  it('throws not_found on 404', async () => {
    const c = createCaribouClient(userKey, sessionSource())
    await expect(c.fetchStatus('999')).rejects.toMatchObject({ code: 'not_found' })
  })
})
