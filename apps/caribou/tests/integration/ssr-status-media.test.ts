// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { html } from 'lit'
import { ssr } from './_ssr.js'
import '../../components/caribou-status-card.js'
import { SSR_MEDIA, SSR_STATUS_MEDIA } from '../e2e/_status-media-ssr.js'

const account = { id: '1', acct: 'alice', username: 'alice', displayName: 'Alice', avatar: '', avatarStatic: '' }

describe('caribou-status-media SSR', () => {
  it('the card prints its media under the content, inside its own shadow root', async () => {
    const status = { id: '42', content: '<p>look</p>', createdAt: '2026-04-28T12:00:00Z', account, mediaAttachments: SSR_MEDIA }
    const out = await ssr(html`<caribou-status-card .status=${status}></caribou-status-card>`)
    expect(out).toMatch(/class="status-content"[\s\S]*<caribou-status-media[^>]*defer-hydration><template shadowroot="open"/)
    expect(out).toContain('src="https://files.example.social/m1-small.png" alt="A red fox in the snow" loading="lazy"')
    expect(out).toContain('style="--ar: 1.3333333333333333"')
  })

  it('a sensitive post prints empty boxes and the reveal button, never the files', async () => {
    const status = { id: '42', content: '', createdAt: '2026-04-28T12:00:00Z', account, sensitive: true, mediaAttachments: SSR_MEDIA }
    const out = await ssr(html`<caribou-status-card .status=${status}></caribou-status-card>`)
    expect(out).toContain('Show sensitive media')
    expect(out).not.toContain('files.example.social')
  })
})

describe('the server markup the e2e media hydration spec replays', () => {
  it('matches a fresh server render', async () => {
    const out = await ssr(html`<caribou-status-media .media=${SSR_MEDIA}></caribou-status-media>`)
    const el = out.slice(out.indexOf('<caribou-status-media'), out.lastIndexOf('</caribou-status-media>') + '</caribou-status-media>'.length)
    expect(el.replace(/<style>[\s\S]*?<\/style>/g, '')).toBe(SSR_STATUS_MEDIA)
  })
})
