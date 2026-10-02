// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { html } from 'lit'
import { statusCache } from '@beatzball/caribou-state'
import { ssr } from './_ssr.js'
import '../../components/caribou-timeline.js'

const ACCT = { id: '1', acct: 'alice', username: 'alice', displayName: 'Alice', avatar: '', avatarStatic: '' }
const mkStatus = (id: string) => ({
  id, content: `<p>post ${id}</p>`, account: ACCT, createdAt: '2026-05-08T12:00:00Z',
})

describe('caribou-timeline SSR', () => {
  it('renders every card from .initial, inside the timeline shadow root', async () => {
    const initial = { statuses: [mkStatus('3'), mkStatus('2'), mkStatus('1')], nextMaxId: '1' }
    const out = await ssr(html`<caribou-timeline kind="local" .initial=${initial}></caribou-timeline>`)

    expect(out).toMatch(/<caribou-timeline[^>]*kind="local"[^>]*><template shadowroot="open" shadowrootmode="open">/)
    const cards = out.match(/<caribou-status-card\s/g) ?? []
    expect(cards).toHaveLength(3)
    expect(out.match(/<li>/g) ?? []).toHaveLength(3)
    for (const id of ['3', '2', '1']) {
      expect(out).toContain(`data-status-id="${id}"`)
      expect(out).toContain(`<p>post ${id}</p>`)
    }
    // Order is the server's order.
    expect(out.indexOf('post 3')).toBeLessThan(out.indexOf('post 2'))
    expect(out.indexOf('post 2')).toBeLessThan(out.indexOf('post 1'))
    expect(out).not.toContain('No posts yet')
    expect(out).not.toContain('Loading your timeline')
    // The data rides in the page's JSON once; it is not repeated as attributes.
    expect(out).not.toMatch(/\s(initial|status)="/)
  })

  it('renders the no-JS pagination link as a query-only href', async () => {
    const initial = { statuses: [mkStatus('7'), mkStatus('5')], nextMaxId: '5' }
    const out = await ssr(html`<caribou-timeline kind="public" .initial=${initial}></caribou-timeline>`)
    expect(out).toMatch(/<a href="\?max_id=5" rel="next" data-sentinel\s*>Older posts →<\/a>/)
  })

  it('renders the empty notice for an empty first page', async () => {
    const out = await ssr(html`<caribou-timeline kind="local" .initial=${{ statuses: [], nextMaxId: null }}></caribou-timeline>`)
    expect(out).toContain('No posts yet.')
    expect(out).not.toContain('<ul>')
    expect(out).not.toContain('rel="next"')
  })

  it('does not write to the process-wide status cache', async () => {
    const before = statusCache.value
    await ssr(html`<caribou-timeline kind="local" .initial=${{ statuses: [mkStatus('9')], nextMaxId: '9' }}></caribou-timeline>`)
    expect(statusCache.value).toBe(before)
    expect(statusCache.value.size).toBe(0)
  })
})
