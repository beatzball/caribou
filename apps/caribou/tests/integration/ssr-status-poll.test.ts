// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { html } from 'lit'
import { ssr } from './_ssr.js'
import '../../components/caribou-status-card.js'

const account = { id: '1', acct: 'alice', username: 'alice', displayName: 'Alice', avatar: '', avatarStatic: '' }
const poll = {
  id: 'p1', expiresAt: '2099-01-01T00:00:00.000Z', expired: false, multiple: false, votesCount: 4, votersCount: 4,
  options: [{ title: 'Tea <3', votesCount: 3, emojis: [] }, { title: 'Coffee', votesCount: 1, emojis: [] }], emojis: [],
}

describe('caribou-status-poll SSR', () => {
  it('the card prints the poll\'s results under the content: no choices, no clock', async () => {
    const status = { id: '42', content: '<p>which?</p>', createdAt: '2026-04-28T12:00:00Z', account, poll }
    const out = await ssr(html`<caribou-status-card .status=${status}></caribou-status-card>`)
    expect(out).toMatch(/class="status-content"[\s\S]*<caribou-status-poll[^>]*defer-hydration><template shadowroot="open"/)
    expect(out).toContain('data-state="results"')
    expect(out).toContain('--share: 75%')
    expect(out).toContain('Tea &lt;3')
    expect(out).toContain('4 people')
    expect(out).toContain('datetime="2099-01-01T00:00:00.000Z"')
    expect(out).not.toContain('left<')
    expect(out).not.toContain('type="radio"')
    expect(out).not.toContain('Refresh')
  })

  it('a poll behind a content warning is not printed', async () => {
    const status = { id: '42', content: '<p>which?</p>', spoilerText: 'cw', createdAt: '2026-04-28T12:00:00Z', account, poll }
    const out = await ssr(html`<caribou-status-card .status=${status}></caribou-status-card>`)
    expect(out).not.toContain('<caribou-status-poll')
  })
})
