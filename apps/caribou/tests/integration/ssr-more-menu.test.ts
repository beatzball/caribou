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
    // Each attribute on its own, so a harmless reorder in a template does
    // not fail this.
    const tag = (name: string, has: string) => out.match(new RegExp(`<${name}\\s[^>]*${has}[^>]*>`))?.[0] ?? ''
    const menu = tag('caribou-menu', 'class="more"')
    for (const attr of ['icon="ellipsis"', 'label="More"']) expect(menu).toContain(attr)
    const trigger = tag('button', 'class="trigger"')
    for (const attr of ['type="button"', 'popovertarget="panel"']) expect(trigger).toContain(attr)
    const panel = tag('div', 'id="panel"')
    expect(panel).toMatch(/\spopover[\s>]/)
    // Rendered "false", it would stay wrong on a menu opened without JS.
    expect(out).not.toContain('aria-expanded')
    expect(out.match(/<form action="\/api\/signout" method="post"/g)).toHaveLength(2)
  })
})
