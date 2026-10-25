// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ssr } from './_ssr.js'
import { UI_CASES, serverShadowMarkup } from './_ui-controls-cases.js'

describe('shared controls on the server', () => {
  for (const c of UI_CASES) {
    it(c.name, async () => {
      const out = await ssr(c.template())
      expect(await ssr(c.template())).toBe(out)
      expect(serverShadowMarkup(out)).toBe(c.server)
    })
  }
})
