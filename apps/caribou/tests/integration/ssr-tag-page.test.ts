// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { html } from 'lit'
import { ssr } from './_ssr.js'
import '../../pages/tags/[tag].js'
import type { TagPageData } from '../../pages/tags/[tag].js'

const ACCT = { id: '1', acct: 'alice', username: 'alice', displayName: 'Alice', avatar: '', avatarStatic: '' }
const TAG_LINK = '<a href="https://example.social/tags/Caturday" class="mention hashtag" rel="tag">#<span>Caturday</span></a>'
const mkStatus = (id: string) => ({
  id, content: `<p>post ${id} ${TAG_LINK}</p>`, account: ACCT, createdAt: '2026-05-08T12:00:00Z',
  tags: [{ name: 'caturday', url: 'https://example.social/tags/caturday' }],
})

const page = (data: TagPageData) => ssr(html`<page-tags-tag .serverData=${data}></page-tags-tag>`)

describe('/tags/[tag] SSR', () => {
  it('paints the heading and the first page of cards, with no follow button', async () => {
    const out = await page({
      kind: 'ok', statuses: [mkStatus('2'), mkStatus('1')] as never, nextMaxId: '1',
      shell: { instance: 'example.social' }, tag: 'Caturday',
    })
    expect(out.replace(/<!--[\s\S]*?-->/g, '')).toContain('<h1>#Caturday</h1>')
    expect(out).toMatch(/<caribou-timeline[^>]*kind="hashtag"[^>]*tag="Caturday"/)
    expect(out.match(/<caribou-status-card\s/g) ?? []).toHaveLength(2)
    // The server has no session, so no follow button.
    expect(out).not.toContain('class="follow"')
    // The hashtag in a post keeps its real href.
    expect(out).toContain('href="https://example.social/tags/Caturday"')
    // Without JavaScript the reader can still page back.
    expect(out).toMatch(/<a href="\?max_id=1" rel="next" data-sentinel/)
    expect(out).not.toContain('No posts with')
  })

  it('says so when nobody has used the tag', async () => {
    const out = await page({
      kind: 'ok', statuses: [], nextMaxId: null, shell: { instance: 'example.social' }, tag: '日本',
    })
    expect(out).toContain('No posts with #日本 yet.')
  })

  it('paints the sign-in placeholder when the server knows no instance', async () => {
    const out = await page({ kind: 'auth-required', shell: { instance: null }, tag: 'ai' })
    expect(out).toContain('#ai needs to know which instance to query.')
    expect(out).not.toContain('<caribou-timeline')
  })
})
