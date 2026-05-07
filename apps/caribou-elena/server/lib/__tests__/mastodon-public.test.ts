import { describe, it, expect, beforeEach, vi } from 'vitest'
import type * as MastodonPublic from '../mastodon-public.js'

describe('mastodon-public', () => {
  let mod: typeof MastodonPublic
  beforeEach(async () => {
    vi.resetModules()
    mod = await import('../mastodon-public.js')
  })

  it('builds public timeline URL with local=true for kind=local', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    await mod.fetchPublicTimeline({ instance: 'example.social', kind: 'local' })
    const url = String(fetchSpy.mock.calls[0]?.[0])
    expect(url).toContain('https://example.social/api/v1/timelines/public?local=true')
  })

  it('omits local=true for kind=public', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    await mod.fetchPublicTimeline({ instance: 'example.social', kind: 'public' })
    const url = String(fetchSpy.mock.calls[0]?.[0])
    expect(url).toContain('/api/v1/timelines/public?')
    expect(url).not.toContain('local=true')
  })

  it('threads max_id', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    await mod.fetchPublicTimeline({ instance: 'example.social', kind: 'local', maxId: '110' })
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('max_id=110')
  })

  it('encodes statusId in fetchStatus', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    await mod.fetchStatus('110/?evil', { instance: 'example.social' })
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('/api/v1/statuses/110%2F%3Fevil')
  })

  it('camelizes snake_case fields from the upstream response', async () => {
    // Mastodon's REST API replies in snake_case (`created_at`, `display_name`,
    // `avatar_static`); the components consume the masto.js camelCase shape.
    // Without conversion, `display.createdAt` reads `undefined` and the
    // status card's timestamp link renders as "undefined NaN, NaN".
    const upstream = JSON.stringify({
      id: '42',
      created_at: '2026-04-28T12:00:00Z',
      content: '<p>hi</p>',
      account: {
        id: '7',
        acct: 'a',
        username: 'a',
        display_name: 'A',
        avatar_static: 'https://x/a.png',
        avatar: 'https://x/a.png',
      },
      media_attachments: [{ id: 'm1', preview_url: 'https://x/p.png' }],
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(upstream, { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    const got = await mod.fetchStatus('42', { instance: 'example.social' }) as unknown as Record<string, unknown>
    expect(got.createdAt).toBe('2026-04-28T12:00:00Z')
    expect((got.account as Record<string, unknown>).displayName).toBe('A')
    expect((got.account as Record<string, unknown>).avatarStatic).toBe('https://x/a.png')
    const media = (got.mediaAttachments as Array<Record<string, unknown>>)[0]!
    expect(media.previewUrl).toBe('https://x/p.png')
    expect((got as Record<string, unknown>).created_at).toBeUndefined()
  })

  it('fetchAccountStatuses applies tab dispatch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
    await mod.fetchAccountStatuses('42', { instance: 'example.social', tab: 'posts' })
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('exclude_replies=true')
    await mod.fetchAccountStatuses('42', { instance: 'example.social', tab: 'media' })
    expect(String(fetchSpy.mock.calls[1]?.[0])).toContain('only_media=true')
    await mod.fetchAccountStatuses('42', { instance: 'example.social', tab: 'replies' })
    expect(String(fetchSpy.mock.calls[2]?.[0])).not.toContain('only_media=true')
    expect(String(fetchSpy.mock.calls[2]?.[0])).not.toContain('exclude_replies=true')
  })
})
