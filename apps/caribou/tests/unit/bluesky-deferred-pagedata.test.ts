// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as H3 from 'h3'
import * as fx from '../../../../packages/bluesky-client/src/__fixtures__/ssr-appview.js'

// #187: a rate limit on any AppView call, label definitions included,
// defers the page. It is never turned into "no definitions".

vi.mock('../../server/lib/resolve-instance.js', () => ({ resolveInstanceForRoute: vi.fn(async () => ({ instance: null })) }))
vi.mock('../../server/lib/instance-cookie.js', () => ({ getInstance: vi.fn(async () => null) }))
vi.mock('../../server/lib/storage.js', () => ({ getStorage: () => ({ getItem: async () => null }) }))
vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof H3>('h3')
  return {
    ...actual,
    getRouterParams: (event: { context?: { params?: Record<string, string> } }) => event.context?.params ?? {},
    getQuery: () => ({}),
    setResponseStatus: vi.fn(),
  }
})

const { pageData: profilePage } = await import('../../pages/@[handle].js')
const { pageData: threadPage } = await import('../../pages/@[handle]/[statusId].js')
const bsky = await import('../../server/lib/bluesky-public.js')

let seq = 0
let limited = new Set<string>()

beforeEach(() => {
  process.env.BLUESKY_SSR = '1'
  process.env.BLUESKY_PUBLIC_APPVIEW = `http://deferred-${++seq}.test`
  limited = new Set()
  bsky._testOnlyResetBackoff()
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input)
    const method = url.pathname.replace('/xrpc/', '')
    if (limited.has(method)) return new Response('{}', { status: 429, headers: { 'retry-after': '5' } })
    const { status, body } = fx.appviewAnswer(method, url.searchParams)
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.BLUESKY_SSR
  delete process.env.BLUESKY_PUBLIC_APPVIEW
})

type Event = Parameters<typeof profilePage.fetcher>[0]
const event = (params: Record<string, string>) => ({ context: { params } }) as unknown as Event

describe('a 429 on the label definitions defers the page', () => {
  it('a thread whose own call succeeded', async () => {
    limited.add('app.bsky.labeler.getServices')
    const data = await threadPage.fetcher(event({ handle: 'alice.example.com', statusId: '3kalicefocus' }))
    expect(data).toMatchObject({ kind: 'deferred', handle: '', statusId: '' })
    expect(JSON.stringify(data)).not.toContain('alice')
  })

  it('a hidden profile', async () => {
    limited.add('app.bsky.labeler.getServices')
    const data = await profilePage.fetcher(event({ handle: 'hana.example.com' }))
    expect(data).toMatchObject({ kind: 'deferred', handle: '' })
  })

  it('a visible profile', async () => {
    limited.add('app.bsky.labeler.getServices')
    expect(await profilePage.fetcher(event({ handle: 'alice.example.com' }))).toMatchObject({ kind: 'deferred' })
  })

  it('control: a label definitions failure that is not a rate limit still renders, covered (fail closed)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(input)
      const method = url.pathname.replace('/xrpc/', '')
      if (method === 'app.bsky.labeler.getServices') return new Response('{}', { status: 503 })
      const { status, body } = fx.appviewAnswer(method, url.searchParams)
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    }))
    const data = await threadPage.fetcher(event({ handle: 'did:plc:alice', statusId: '3kalicecustom' })) as { kind: string; focused?: { bluesky: { moderation: { contexts: { contentView: { reasons: { name: string }[] } } } } } }
    expect(data.kind).toBe('ok')
    expect(data.focused!.bluesky.moderation.contexts.contentView.reasons[0]!.name).toBe('Content warning (labeler unavailable)')
  })
})
