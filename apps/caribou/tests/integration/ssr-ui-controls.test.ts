// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { html } from 'lit'
import { ssr } from './_ssr.js'
import { UI_CASES, serverShadowMarkup } from './_ui-controls-cases.js'
import { SSR_SUBMIT_BUTTON } from '../e2e/_ui-controls-ssr.js'

describe('shared controls on the server', () => {
  for (const c of UI_CASES) {
    it(c.name, async () => {
      const out = await ssr(c.template())
      expect(await ssr(c.template())).toBe(out)
      expect(serverShadowMarkup(out)).toBe(c.server)
    })
  }
})

describe('the server markup the e2e hydration spec replays', () => {
  it('matches a fresh server render', async () => {
    const out = await ssr(html`<caribou-button type="submit">Post</caribou-button>`)
    const el = out.slice(out.indexOf('<caribou-button'), out.lastIndexOf('</caribou-button>') + '</caribou-button>'.length)
    expect(el.replace(/<style>[\s\S]*?<\/style>/g, '')).toBe(SSR_SUBMIT_BUTTON)
  })
})
