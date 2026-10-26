// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { html } from 'lit'
import { ssr } from './_ssr.js'
import '../../components/caribou-app-shell.js'

describe('compose SSR', () => {
  it('the dialog renders nothing on the server', async () => {
    const out = await ssr(html`<caribou-compose-dialog></caribou-compose-dialog>`)
    expect(out).not.toContain('<dialog')
    expect(out).not.toContain('<textarea')
  })

  it('the shell mounts one dialog, and the New post button ships hidden', async () => {
    const out = await ssr(html`<caribou-app-shell></caribou-app-shell>`)
    expect(out.match(/<caribou-compose-dialog/g)).toHaveLength(1)
    expect(out).toMatch(/<caribou-button[^>]*class="compose-btn"/)
    // The label is hidden at narrow widths, so the server's button carries the name.
    expect(out).toMatch(/<button[^>]*aria-label="New post"/)
    // Shown only once the client sets [can-compose] on the rail.
    expect(out).not.toMatch(/<caribou-nav-rail[^>]*can-compose/)
  })
})
