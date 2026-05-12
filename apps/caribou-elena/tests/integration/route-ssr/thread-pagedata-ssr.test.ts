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

const ACCT = { id: '1', acct: 'u', username: 'u', displayName: 'U', avatar: '', avatarStatic: '' }
const A1 = { id: 'a1', content: '<p>ancestor</p>', account: ACCT, createdAt: '2026-05-11T06:59:00Z', inReplyToId: null }
const F = { id: 'f', content: '<p>focused</p>', account: ACCT, createdAt: '2026-05-11T07:00:00Z', inReplyToId: null }
const D1 = { id: 'd1', content: '<p>desc1</p>', account: ACCT, createdAt: '2026-05-11T07:01:00Z', inReplyToId: 'f' }
const D2 = { id: 'd2', content: '<p>desc2 deep</p>', account: ACCT, createdAt: '2026-05-11T07:02:00Z', inReplyToId: 'd1' }

describe('thread pageData — SSR list rendering', () => {
  it('returns populatedListHtml with variants + depth attributes', async () => {
    vi.doMock('../../../server/lib/mastodon-public.js', () => ({
      fetchStatus: async () => F,
      fetchThreadContext: async () => ({ ancestors: [A1], descendants: [D1, D2] }),
    }))
    vi.doMock('../../../server/lib/instance-cookie.js', () => ({
      getInstance: async () => 'fosstodon.org',
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
        getRequestURL: () => new URL('http://localhost:3000/@u@example.test/f'),
        getRouterParams: () => ({ handle: 'u@example.test', statusId: 'f' }),
      }
    })

    const { pageData } = await import('../../../pages/@[handle]/[statusId].js')

    const event = {
      url: '/@u@example.test/f',
    } as unknown as Parameters<typeof pageData.fetcher>[0]

    const data = await pageData.fetcher(event)
    expect(data.kind).toBe('ok')
    if (data.kind !== 'ok') throw new Error('expected ok')

    // Cards present in order: ancestor → focused → descendants.
    expect(data.populatedListHtml.indexOf('data-key="a1"')).toBeLessThan(data.populatedListHtml.indexOf('data-key="f"'))
    expect(data.populatedListHtml.indexOf('data-key="f"')).toBeLessThan(data.populatedListHtml.indexOf('data-key="d1"'))

    // Variants are reflected on the cards.
    expect(data.populatedListHtml).toContain('variant="ancestor"')
    expect(data.populatedListHtml).toContain('variant="focused"')
    expect(data.populatedListHtml).toContain('variant="descendant"')

    // Descendants carry data-depth on their <li>.
    expect(data.populatedListHtml).toMatch(/<li data-key="d1"[^>]*data-depth=/)
    expect(data.populatedListHtml).toMatch(/<li data-key="d2"[^>]*data-depth=/)
  })
})
