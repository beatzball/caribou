// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { html } from 'lit'
import { ssr } from './_ssr.js'
import '../../components/caribou-status-card.js'
import { SSR_LINK_CARD, SSR_STATUS_LINK_CARD } from '../e2e/_status-link-card-ssr.js'

const account = { id: '1', acct: 'alice', username: 'alice', displayName: 'Alice', avatar: '', avatarStatic: '' }

describe('caribou-status-link-card SSR', () => {
  it('the card prints the link card under the content, inside its own shadow root', async () => {
    const status = { id: '42', content: '<p>look</p>', createdAt: '2026-04-28T12:00:00Z', account, mediaAttachments: [], card: SSR_LINK_CARD }
    const out = await ssr(html`<caribou-status-card .status=${status}></caribou-status-card>`)
    expect(out).toMatch(/class="status-content"[\s\S]*<caribou-status-link-card[^>]*defer-hydration><template shadowroot="open"/)
    expect(out).toContain('href="https://news.example/story" target="_blank" rel="noopener noreferrer"')
    expect(out).toContain('src="https://files.example.social/card.png" alt="A chart" loading="lazy"')
  })

  it('a post with media prints no link card', async () => {
    const media = [{ id: 'm', type: 'image', previewUrl: 'https://files.example.social/m.png', meta: {} }]
    const status = { id: '42', content: '', createdAt: '2026-04-28T12:00:00Z', account, mediaAttachments: media, card: SSR_LINK_CARD }
    const out = await ssr(html`<caribou-status-card .status=${status}></caribou-status-card>`)
    expect(out).not.toContain('<caribou-status-link-card')
  })
})

describe('the server markup the e2e link card hydration spec replays', () => {
  it('matches a fresh server render', async () => {
    const out = await ssr(html`<caribou-status-link-card .card=${SSR_LINK_CARD}></caribou-status-link-card>`)
    const tag = 'caribou-status-link-card'
    const el = out.slice(out.indexOf(`<${tag}`), out.lastIndexOf(`</${tag}>`) + `</${tag}>`.length)
    expect(el.replace(/<style>[\s\S]*?<\/style>/g, '')).toBe(SSR_STATUS_LINK_CARD)
  })
})
