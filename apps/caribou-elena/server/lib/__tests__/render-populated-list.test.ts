import { describe, it, expect, beforeAll } from 'vitest'
import { JSDOM } from 'jsdom'

function mkStatus(id: string, content = `<p>${id}</p>`): import('masto').mastodon.v1.Status {
  return {
    id,
    content,
    account: { id: '1', acct: 'u', username: 'u', displayName: 'U', avatar: '', avatarStatic: '' },
    createdAt: '2026-05-11T07:00:00Z',
    inReplyToId: null,
  } as unknown as import('masto').mastodon.v1.Status
}

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

describe('renderPopulatedListMount — empty', () => {
  it('emits a mount with an empty <ul> when items is empty', async () => {
    const { renderPopulatedListMount } = await import('../render-populated-list.js')
    const html = await renderPopulatedListMount({ items: [], serverNowMs: 1700000000000 })
    expect(html).toContain('<caribou-list-mount>')
    expect(html).toContain('<template shadowrootmode="open">')
    expect(html).toContain('<ul')
    expect(html).toContain('</ul>')
    expect(html).not.toContain('<li')
  })
})

describe('renderPopulatedListMount — N timeline items', () => {
  it('emits one <li data-key> per item in declared order', async () => {
    const { renderPopulatedListMount } = await import('../render-populated-list.js')
    const items = [
      { status: mkStatus('a'), variant: 'timeline' as const },
      { status: mkStatus('b'), variant: 'timeline' as const },
      { status: mkStatus('c'), variant: 'timeline' as const },
    ]
    const html = await renderPopulatedListMount({ items, serverNowMs: 1700000000000 })
    expect(html).toContain('<li data-key="a">')
    expect(html).toContain('<li data-key="b">')
    expect(html).toContain('<li data-key="c">')
    expect(html.indexOf('data-key="a"')).toBeLessThan(html.indexOf('data-key="b"'))
    expect(html.indexOf('data-key="b"')).toBeLessThan(html.indexOf('data-key="c"'))
  })

  it('reflects variant + data-rendered-at on every card host', async () => {
    const { renderPopulatedListMount } = await import('../render-populated-list.js')
    const items = [
      { status: mkStatus('a'), variant: 'timeline' as const },
      { status: mkStatus('b'), variant: 'timeline' as const },
    ]
    const html = await renderPopulatedListMount({ items, serverNowMs: 1700000000000 })
    // variant appears on both the host element and the inner <article>,
    // so with 2 items we expect 4 total matches.
    const matches = html.match(/variant="timeline"/g) ?? []
    expect(matches.length).toBe(4)
    const rendered = html.match(/data-rendered-at="1700000000000"/g) ?? []
    expect(rendered.length).toBe(2)
  })

  it('embeds each card via a DSD template', async () => {
    const { renderPopulatedListMount } = await import('../render-populated-list.js')
    const items = [{ status: mkStatus('a'), variant: 'timeline' as const }]
    const html = await renderPopulatedListMount({ items, serverNowMs: 1700000000000 })
    // One mount DSD + one card DSD = two shadowrootmode="open" templates.
    const matches = html.match(/<template shadowrootmode="open">/g) ?? []
    expect(matches.length).toBe(2)
  })
})
