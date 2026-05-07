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

describe('CaribouClient.lookupAccount', () => {
  it('resolves a known handle to an Account', async () => {
    const c = createCaribouClient(userKey, sessionSource())
    const a = await c.lookupAccount('beatzball')
    expect(a.username).toBe('beatzball')
  })

  it('throws not_found on unknown handle', async () => {
    const c = createCaribouClient(userKey, sessionSource())
    await expect(c.lookupAccount('ghost')).rejects.toMatchObject({ code: 'not_found' })
  })
})
