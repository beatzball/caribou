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

describe('CaribouClient edit and delete', () => {
  it('fetchStatusSource GETs /statuses/:id/source', async () => {
    let seen = ''
    server.use(http.get(`${base}/source`, ({ params }) => {
      seen = String(params.id)
      return HttpResponse.json({ id: '110', text: 'plain text', spoiler_text: 'cw' })
    }))
    const c = createCaribouClient(userKey, sessionSource())
    const src = await c.fetchStatusSource('110')
    expect(seen).toBe('110')
    expect(src).toEqual({ id: '110', text: 'plain text', spoilerText: 'cw' })
  })

  it('editStatus PUTs the text, spoiler, sensitive, language and media ids', async () => {
    let body: Record<string, unknown> | undefined
    let method = ''
    server.use(http.put(base, async ({ request, params }) => {
      method = request.method
      body = await request.json() as Record<string, unknown>
      return HttpResponse.json({ ...makeStatus(String(params.id)), edited_at: '2026-11-01T00:00:00.000Z' })
    }))
    const c = createCaribouClient(userKey, sessionSource())
    const s = await c.editStatus('110', {
      status: 'fixed', spoilerText: 'cw', sensitive: true, language: 'en', mediaIds: ['m1'],
    })
    expect(method).toBe('PUT')
    expect(body).toEqual({
      status: 'fixed', spoiler_text: 'cw', sensitive: true, language: 'en', media_ids: ['m1'],
    })
    expect(s.editedAt).toBe('2026-11-01T00:00:00.000Z')
  })

  it('editStatus sends an empty media list so a post without media stays without', async () => {
    let body: Record<string, unknown> | undefined
    server.use(http.put(base, async ({ request, params }) => {
      body = await request.json() as Record<string, unknown>
      return HttpResponse.json(makeStatus(String(params.id)))
    }))
    const c = createCaribouClient(userKey, sessionSource())
    await c.editStatus('110', { status: 'only text', spoilerText: '', mediaIds: [] })
    expect(body).toMatchObject({ status: 'only text', spoiler_text: '' })
    expect(body).not.toHaveProperty('media_ids')
  })

  it('deleteStatus DELETEs /statuses/:id and returns the source text', async () => {
    let method = ''
    server.use(http.delete(base, ({ request, params }) => {
      method = request.method
      return HttpResponse.json({ ...makeStatus(String(params.id)), text: 'my words' })
    }))
    const c = createCaribouClient(userKey, sessionSource())
    const s = await c.deleteStatus('110')
    expect(method).toBe('DELETE')
    expect(s.text).toBe('my words')
  })

  it('fetchStatusHistory GETs /statuses/:id/history', async () => {
    server.use(http.get(`${base}/history`, () => HttpResponse.json([
      { content: '<p>one</p>', spoiler_text: '', sensitive: false, created_at: '2026-10-01T00:00:00.000Z',
        account: makeStatus('x').account, media_attachments: [], emojis: [] },
      { content: '<p>two</p>', spoiler_text: '', sensitive: false, created_at: '2026-10-02T00:00:00.000Z',
        account: makeStatus('x').account, media_attachments: [], emojis: [] },
    ])))
    const c = createCaribouClient(userKey, sessionSource())
    const h = await c.fetchStatusHistory('110')
    expect(h.map((v) => v.content)).toEqual(['<p>one</p>', '<p>two</p>'])
    expect(h[1]!.createdAt).toBe('2026-10-02T00:00:00.000Z')
  })

  it('a failed delete rejects with a CaribouError', async () => {
    server.use(http.delete(base, () => HttpResponse.json({ error: 'Record not found' }, { status: 404 })))
    const c = createCaribouClient(userKey, sessionSource())
    await expect(c.deleteStatus('110')).rejects.toMatchObject({ code: 'not_found' })
  })
})
