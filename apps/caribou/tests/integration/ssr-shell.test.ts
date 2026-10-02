// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { html } from 'lit'
import { ssr } from './_ssr.js'
import '../../components/caribou-app-shell.js'

describe('caribou-app-shell SSR', () => {
  it('emits a declarative shadow root with both rails and a slot for the page', async () => {
    const out = await ssr(html`<caribou-app-shell instance="example.social"><p>page body</p></caribou-app-shell>`)
    expect(out).toContain('<template shadowroot="open" shadowrootmode="open">')
    expect(out).toContain('<caribou-nav-rail')
    expect(out).toContain('<caribou-right-rail')
    expect(out).toContain('<main><slot></slot></main>')
    expect(out).toContain('<p>page body</p>')
  })

  it('passes the instance down to the right rail', async () => {
    const out = await ssr(html`<caribou-app-shell instance="example.social"></caribou-app-shell>`)
    expect(out).toMatch(/Signed in to <strong><!--lit-part-->example\.social/)
  })

  it('server-renders real anchors for the nav rail', async () => {
    const out = await ssr(html`<caribou-app-shell></caribou-app-shell>`)
    for (const href of ['/home', '/local', '/public', '/@me']) {
      expect(out).toContain(`<a href="${href}"`)
    }
  })
})
