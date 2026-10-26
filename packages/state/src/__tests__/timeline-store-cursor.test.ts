import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserKey } from '@beatzball/caribou-auth'
import { statusCache } from '../caches.js'
import { activeClient, activeUserKey, users, type UserSession } from '../users.js'
import { createTimelineStore } from '../timeline-store.js'

// Real users → activeClient → client → store, with only `fetch` stubbed, so
// a new client in the middle of paging is the real one `activeClient` makes.
const status = (id: string) => ({ id, content: `<p>${id}</p>`, account: { id: 'a1', acct: 'alice' } })

const key = 'alice@example.social' as UserKey
const session = {
  userKey: key, server: 'example.social', token: 'T', vapidKey: '', account: null, createdAt: 1,
} as unknown as UserSession

let asked: Array<string | null> = []

beforeEach(() => {
  statusCache.value = new Map()
  asked = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const maxId = url.searchParams.get('max_id')
    asked.push(maxId)
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    let body = [status('wrong')]
    if (maxId === null) {
      body = [status('s9'), status('s5')]
      headers.link = '<https://example.social/api/v1/bookmarks?max_id=700>; rel="next"'
    }
    if (maxId === '700') body = [status('s1')]
    return new Response(JSON.stringify(body), { status: 200, headers })
  })
  users.value = new Map([[key, session]])
  activeUserKey.value = key
})

afterEach(() => {
  vi.unstubAllGlobals()
  activeUserKey.value = null
  users.value = new Map()
})

describe('createTimelineStore — bookmarks cursor', () => {
  it('keeps the next cursor when activeClient is replaced between pages', async () => {
    const store = createTimelineStore('bookmarks', { clientSource: () => activeClient.value })
    await store.load()
    const before = activeClient.value
    // What loadActiveAccount does once verifyCredentials resolves.
    users.value = new Map([[key, { ...session, account: { id: 'a1', acct: 'alice' } } as unknown as UserSession]])
    expect(activeClient.value).not.toBe(before)

    await store.loadMore()
    expect(asked).toEqual([null, '700'])
    expect(store.statusIds.value).toEqual(['s9', 's5', 's1'])
  })

  it('ends after a page with no next link, without asking again', async () => {
    const store = createTimelineStore('bookmarks', { clientSource: () => activeClient.value })
    await store.load()
    expect(store.hasMore.value).toBe(true)
    await store.loadMore()
    // So no "Older posts" link is shown for a page that does not exist.
    expect(store.hasMore.value).toBe(false)
    await store.loadMore()
    expect(asked).toEqual([null, '700'])
  })
})
