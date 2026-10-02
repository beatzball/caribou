// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { html } from 'lit'
import { ssr } from './_ssr.js'
import '../../components/caribou-status-card.js'

const STATUS = {
  id: '42',
  content: '<p>hello <a href="https://example.social/tags/caribou" class="mention hashtag" rel="tag">#<span>caribou</span></a></p>',
  account: { id: '1', acct: 'alice', username: 'alice', displayName: 'Alice',
             avatar: 'https://example.social/a.png', avatarStatic: 'https://example.social/a-static.png' },
  createdAt: '2026-04-28T12:00:00Z',
}

describe('caribou-status-card SSR', () => {
  it('renders the whole card into a declarative shadow root from a .status binding', async () => {
    const out = await ssr(html`<caribou-status-card .status=${STATUS}></caribou-status-card>`)
    expect(out).toContain('<template shadowroot="open" shadowrootmode="open">')
    expect(out).toContain('data-variant="timeline"')
    expect(out).toContain('src="https://example.social/a-static.png"')
    expect(out).toContain('href="/@alice/42"')
    expect(out).toMatch(/<strong><!--lit-part-->Alice/)
    // The object never becomes an attribute.
    expect(out).not.toMatch(/<caribou-status-card[^>]*\sstatus=/)
  })

  it('prints the pre-sanitized content as given (the server has no DOMPurify)', async () => {
    const out = await ssr(html`<caribou-status-card .status=${STATUS}></caribou-status-card>`)
    expect(out).toContain(STATUS.content)
  })

  it('prints an absolute timestamp, never a clock-relative one', async () => {
    const recent = { ...STATUS, createdAt: new Date().toISOString() }
    const out = await ssr(html`<caribou-status-card .status=${recent}></caribou-status-card>`)
    const label = new Date(recent.createdAt).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
    expect(out).toContain(`<time datetime="${recent.createdAt}"><!--lit-part-->${label}<!--/lit-part--></time>`)
    expect(out).not.toContain('just now')
  })

  it('reflects variant and renders the boost attribution row', async () => {
    const boost = {
      id: 'wrapper', content: '', createdAt: '2026-04-28T13:00:00Z',
      account: { id: '2', acct: 'bob', username: 'bob', displayName: 'Bob', avatar: '', avatarStatic: '' },
      reblog: STATUS,
    }
    const out = await ssr(html`<caribou-status-card variant="focused" .status=${boost}></caribou-status-card>`)
    expect(out).toContain('data-variant="focused"')
    expect(out).toContain('class="boost-attribution"')
    expect(out).toMatch(/Bob<!--\/lit-part--> boosted/)
    expect(out).toContain('href="/@alice/42"')
  })
})
