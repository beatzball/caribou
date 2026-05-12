import { describe, it, expect, beforeAll, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import type * as H3 from 'h3'

beforeAll(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  ;(globalThis as unknown as { window: typeof dom.window }).window = dom.window
  ;(globalThis as unknown as { document: Document }).document =
    dom.window.document as unknown as Document
  ;(globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement =
    dom.window.HTMLElement as unknown as typeof HTMLElement
  ;(globalThis as unknown as { customElements: CustomElementRegistry }).customElements =
    dom.window.customElements as unknown as CustomElementRegistry
})

beforeAll(async () => {
  await import('../../../pages/components/caribou-status-card.js')
})

const FIXTURE_ACCOUNT = {
  id: '42',
  acct: 'u@example.test',
  username: 'u',
  displayName: 'U',
  avatar: '',
  avatarStatic: '',
}

const FIXTURE_STATUSES = [
  {
    id: 'a',
    content: '<p>first</p>',
    account: FIXTURE_ACCOUNT,
    createdAt: '2026-05-11T07:00:00Z',
    inReplyToId: null,
  },
  {
    id: 'b',
    content: '<p>second</p>',
    account: FIXTURE_ACCOUNT,
    createdAt: '2026-05-11T07:01:00Z',
    inReplyToId: null,
  },
  {
    id: 'c',
    content: '<p>third</p>',
    account: FIXTURE_ACCOUNT,
    createdAt: '2026-05-11T07:02:00Z',
    inReplyToId: null,
  },
]

describe('/@[handle] pageData — SSR list rendering', () => {
  it('returns populatedListHtml containing one <li data-key> per status', async () => {
    vi.doMock('../../../server/lib/mastodon-public.js', () => ({
      fetchAccountByHandle: async () => FIXTURE_ACCOUNT,
      fetchAccountStatuses: async () => FIXTURE_STATUSES,
    }))
    vi.doMock('../../../server/lib/resolve-instance.js', () => ({
      resolveInstanceForRoute: async () => ({ instance: 'example.test' }),
    }))
    vi.doMock('../../../server/lib/storage.js', () => ({
      getStorage: () => ({} as unknown),
    }))
    vi.doMock('../../../server/lib/server-now.js', () => ({
      getServerNowMs: () => 1_000_000,
    }))

    vi.doMock('h3', async () => {
      const actual = await vi.importActual<typeof H3>('h3')
      return {
        ...actual,
        getRequestURL: () => new URL('http://localhost:3000/@u@example.test'),
        getRouterParams: () => ({ handle: 'u@example.test' }),
        getQuery: () => ({}),
      }
    })

    const { pageData } = await import('../../../pages/@[handle].js')

    const event = {
      context: { params: { handle: 'u@example.test' } },
      url: '/@u@example.test',
    } as unknown as Parameters<typeof pageData.fetcher>[0]

    const data = await pageData.fetcher(event)
    expect(data.kind).toBe('ok')
    if (data.kind !== 'ok') throw new Error('expected ok')

    expect(data.populatedListHtml).toContain('<li data-key="a">')
    expect(data.populatedListHtml).toContain('<li data-key="b">')
    expect(data.populatedListHtml).toContain('<li data-key="c">')
    expect(data.populatedListHtml).toContain('<caribou-list-mount>')
    expect(data.populatedListHtml).toMatch(/<template shadowrootmode="open">/)
    expect(typeof data.serverNowMs).toBe('number')
  })
})
