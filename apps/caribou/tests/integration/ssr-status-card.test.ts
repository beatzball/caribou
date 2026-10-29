// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { html } from 'lit'
import { ssr } from './_ssr.js'
import '../../components/caribou-status-card.js'
import { SSR_CW_STATUS, SSR_CW_STATUS_CARD, SSR_STATUS, SSR_STATUS_CARD, withoutTime } from '../e2e/_status-card-ssr.js'

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
    expect(out).toMatch(/<a href="\/@bob"[^>]*><!--lit-part-->Bob<!--\/lit-part--><\/a> boosted/)
    expect(out).toContain('href="/@alice/42"')
  })

  it('prints the action bar in its signed-out state, with counts and pressed state from the status', async () => {
    const s = { ...STATUS, visibility: 'public', favourited: true, favouritesCount: 5, reblogsCount: 0, repliesCount: 2, bookmarked: false }
    const out = await ssr(html`<caribou-status-card .status=${s}></caribou-status-card>`)
    // Each action is a soft-disabled ghost icon button; its own shadow root
    // is in the server HTML, with the hint as the tooltip.
    expect(out).toMatch(/<caribou-icon-button[^>]*class="favourite"[^>]*label="Unfavourite"[^>]*pressed="true"[^>]*hint="Sign in to favourite"[^>]*soft-disabled/)
    expect(out).toMatch(/<caribou-icon-button[^>]*class="boost"[^>]*label="Boost"[^>]*pressed="false"/)
    expect(out).toMatch(/<caribou-icon-button[^>]*class="reply"[^>]*label="Reply"/)
    expect(out).toMatch(/<caribou-icon-button[^>]*class="bookmark"[^>]*label="Bookmark"/)
    expect(out).toMatch(/<button[^>]*aria-label="Unfavourite" title="Sign in to favourite"\s*aria-pressed="true"\s*aria-disabled="true"/)
    expect(out.match(/<caribou-icon-button\s/g)).toHaveLength(4)
    expect(out).toContain('<span class="count" part="count"><!--lit-part-->5<!--/lit-part--></span>')
    expect(out).toContain('<span class="count" part="count"><!--lit-part-->2<!--/lit-part--></span>')
  })
})

describe('caribou-status-card SSR content warning', () => {
  it('prints the warning collapsed: escaped text, a Show more button, an empty region, no media', async () => {
    const out = await ssr(html`<caribou-status-card .status=${SSR_CW_STATUS}></caribou-status-card>`)
    expect(out).toContain('<p class="spoiler"><!--lit-part-->Spoilers &amp; &lt;b&gt;plot&lt;/b&gt;<!--/lit-part--></p>')
    expect(out).toMatch(/<button type="button" class="cw-toggle" aria-controls="status-body"\s*aria-expanded="false"\s*><!--lit-part-->Show more/)
    expect(out).toMatch(/<div class="status-body" id="status-body" hidden>/)
    expect(out).not.toContain('the butler did it')
    expect(out).not.toContain('caribou-status-media')
    expect(out).not.toContain('files.example.social')
  })

  it('a post without a warning prints no toggle', async () => {
    const out = await ssr(html`<caribou-status-card .status=${STATUS}></caribou-status-card>`)
    expect(out).not.toContain('class="cw-toggle"')
    expect(out).toMatch(/<div class="status-body" id="status-body" >/)
  })
})

describe('the server markup the e2e card hydration spec replays', () => {
  const cut = (out: string) => withoutTime(out
    .slice(out.indexOf('<caribou-status-card'), out.lastIndexOf('</caribou-status-card>') + '</caribou-status-card>'.length)
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/[ \t]+$/gm, ''))

  it('matches a fresh server render', async () => {
    expect(cut(await ssr(html`<caribou-status-card .status=${SSR_STATUS}></caribou-status-card>`))).toBe(SSR_STATUS_CARD)
  })

  it('matches a fresh server render of the post with a content warning', async () => {
    expect(cut(await ssr(html`<caribou-status-card .status=${SSR_CW_STATUS}></caribou-status-card>`))).toBe(SSR_CW_STATUS_CARD)
  })
})
