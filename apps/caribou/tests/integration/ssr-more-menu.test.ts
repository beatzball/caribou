// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { html } from 'lit'
import { ssr } from './_ssr.js'
import '../../components/caribou-nav-rail.js'

// The More menu must open with JavaScript off, so its popover wiring has to
// be in the server HTML, and nothing the client sets later may be in it.
describe('SSR: the nav rail\'s More menu', () => {
  it('renders a native popover trigger and panel', async () => {
    const out = (await ssr(html`<caribou-nav-rail></caribou-nav-rail>`)).replace(/<style>[\s\S]*?<\/style>/g, '')
    expect(out).toMatch(/<caribou-menu\s+class="more" icon="ellipsis" label="More"/)
    expect(out).toMatch(/<button type="button" class="trigger" part="trigger" popovertarget="panel"/)
    expect(out).toMatch(/<div\s+id="panel" class="panel" part="panel" popover/)
    // Rendered "false", it would stay wrong on a menu opened without JS.
    expect(out).not.toContain('aria-expanded')
    expect(out.match(/<form action="\/api\/signout" method="post"/g)).toHaveLength(2)
  })
})
