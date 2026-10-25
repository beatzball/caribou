import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { toUserKey } from '@beatzball/caribou-auth'
import { createCaribouClient, MediaProcessingTimeout } from '../create-client.js'
import { server } from './fixtures/server.js'
import { handlers } from './fixtures/handlers.js'
import { makeStatus } from './fixtures/status.js'

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

function media(id: string, url: string | null) {
  return {
    id, type: 'image', url, preview_url: url, remote_url: null,
    description: null, blurhash: null, meta: null,
  }
}

describe('CaribouClient.createStatus', () => {
  it('posts the status with an Idempotency-Key header', async () => {
    let seen: { key: string | null; body: Record<string, unknown> } | undefined
    server.use(
      http.post('https://fosstodon.org/api/v1/statuses', async ({ request }) => {
        seen = {
          key: request.headers.get('idempotency-key'),
          body: await request.json() as Record<string, unknown>,
        }
        return HttpResponse.json(makeStatus('new-1'))
      }),
    )
    const c = createCaribouClient(userKey, sessionSource())
    const s = await c.createStatus(
      { status: 'hello', visibility: 'unlisted', inReplyToId: '110', spoilerText: 'cw' },
      { idempotencyKey: 'key-1' },
    )
    expect(s.id).toBe('new-1')
    expect(seen?.key).toBe('key-1')
    expect(seen?.body).toMatchObject({
      status: 'hello', visibility: 'unlisted', in_reply_to_id: '110', spoiler_text: 'cw',
    })
    expect(seen?.body).not.toHaveProperty('media_ids')
  })

  it('does not merge two concurrent posts with the same text', async () => {
    let hits = 0
    server.use(
      http.post('https://fosstodon.org/api/v1/statuses', () => {
        hits += 1
        return HttpResponse.json(makeStatus(`n${hits}`))
      }),
    )
    const c = createCaribouClient(userKey, sessionSource())
    await Promise.all([
      c.createStatus({ status: 'same', visibility: 'public' }),
      c.createStatus({ status: 'same', visibility: 'public' }),
    ])
    expect(hits).toBe(2)
  })

  it('sends media_ids when given', async () => {
    let body: Record<string, unknown> | undefined
    server.use(
      http.post('https://fosstodon.org/api/v1/statuses', async ({ request }) => {
        body = await request.json() as Record<string, unknown>
        return HttpResponse.json(makeStatus('m'))
      }),
    )
    const c = createCaribouClient(userKey, sessionSource())
    await c.createStatus({ status: '', visibility: 'public', mediaIds: ['m1', 'm2'] })
    expect(body?.media_ids).toEqual(['m1', 'm2'])
  })

  it('maps a 422 to a CaribouError with the server message', async () => {
    server.use(
      http.post('https://fosstodon.org/api/v1/statuses', () =>
        HttpResponse.json({ error: 'Validation failed: Text can’t be blank' }, { status: 422 })),
    )
    const c = createCaribouClient(userKey, sessionSource())
    await expect(c.createStatus({ status: '', visibility: 'public' }))
      .rejects.toMatchObject({ name: 'CaribouError', message: expect.stringMatching(/blank/) })
  })
})

describe('CaribouClient.uploadMedia', () => {
  it('returns at once when the server has already processed the file', async () => {
    server.use(
      http.post('https://fosstodon.org/api/v2/media', () =>
        HttpResponse.json(media('m1', 'https://fosstodon.org/m1.png'))),
    )
    const c = createCaribouClient(userKey, sessionSource())
    const m = await c.uploadMedia(new Blob(['x'], { type: 'image/png' }), { description: 'alt' })
    expect(m.url).toBe('https://fosstodon.org/m1.png')
  })

  it('polls fetchMedia after a 202 until the url is set', async () => {
    let polls = 0
    server.use(
      http.post('https://fosstodon.org/api/v2/media', () =>
        HttpResponse.json(media('m2', null), { status: 202 })),
      http.get('https://fosstodon.org/api/v1/media/m2', () => {
        polls += 1
        return polls < 3
          ? HttpResponse.json(media('m2', null), { status: 206 })
          : HttpResponse.json(media('m2', 'https://fosstodon.org/m2.png'))
      }),
    )
    const c = createCaribouClient(userKey, sessionSource())
    const m = await c.uploadMedia(new Blob(['x']), { pollIntervalMs: 1 })
    expect(polls).toBe(3)
    expect(m.url).toBe('https://fosstodon.org/m2.png')
  })

  it('gives up when processing outlasts the timeout', async () => {
    server.use(
      http.post('https://fosstodon.org/api/v2/media', () =>
        HttpResponse.json(media('m3', null), { status: 202 })),
      http.get('https://fosstodon.org/api/v1/media/m3', () =>
        HttpResponse.json(media('m3', null), { status: 206 })),
    )
    const c = createCaribouClient(userKey, sessionSource())
    await expect(c.uploadMedia(new Blob(['x']), { pollIntervalMs: 1, timeoutMs: 10 }))
      .rejects.toMatchObject({ code: 'server_error', mediaId: 'm3' })
  })

  it('waitForMedia resumes after a timeout without uploading again', async () => {
    let uploads = 0
    let polls = 0
    server.use(
      http.post('https://fosstodon.org/api/v2/media', () => {
        uploads += 1
        return HttpResponse.json(media('m4', null), { status: 202 })
      }),
      http.get('https://fosstodon.org/api/v1/media/m4', () => {
        polls += 1
        return polls < 4
          ? HttpResponse.json(media('m4', null), { status: 206 })
          : HttpResponse.json(media('m4', 'https://fosstodon.org/m4.png'))
      }),
    )
    const c = createCaribouClient(userKey, sessionSource())
    const err = await c.uploadMedia(new Blob(['x']), { pollIntervalMs: 1, timeoutMs: 1 })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MediaProcessingTimeout)
    const m = await c.waitForMedia((err as MediaProcessingTimeout).mediaId, { pollIntervalMs: 1 })
    expect(m.url).toBe('https://fosstodon.org/m4.png')
    expect(uploads).toBe(1)
  })
})

describe('CaribouClient.updateMedia / fetchInstance', () => {
  it('updateMedia sends the description', async () => {
    let body: Record<string, unknown> | undefined
    server.use(
      http.put('https://fosstodon.org/api/v1/media/m1', async ({ request }) => {
        body = await request.json() as Record<string, unknown>
        return HttpResponse.json({ ...media('m1', 'u'), description: 'a cat' })
      }),
    )
    const c = createCaribouClient(userKey, sessionSource())
    const m = await c.updateMedia('m1', { description: 'a cat' })
    expect(body).toEqual({ description: 'a cat' })
    expect(m.description).toBe('a cat')
  })

  it('fetchInstance returns the v2 instance', async () => {
    server.use(
      http.get('https://fosstodon.org/api/v2/instance', () => HttpResponse.json({
        domain: 'fosstodon.org',
        configuration: { statuses: { max_characters: 1000 }, media_attachments: {} },
      })),
    )
    const c = createCaribouClient(userKey, sessionSource())
    const i = await c.fetchInstance()
    expect(i.configuration.statuses.maxCharacters).toBe(1000)
  })
})
