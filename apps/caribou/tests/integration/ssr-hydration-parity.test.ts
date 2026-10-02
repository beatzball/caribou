// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { html, type TemplateResult } from 'lit'
import { ssr } from './_ssr.js'
import '../../components/caribou-app-shell.js'
import '../../components/caribou-auth-required.js'
import '../../components/caribou-landing.js'

// Lit hydrates by walking the server HTML against the first client render, so
// the server output must be a pure function of the element's inputs: no
// request state, no clock, nothing that only a browser knows. These tests pin
// the server half of that contract; the component tests pin the client half
// (first render before `firstUpdated`), and `tests/e2e/hydration.spec.ts`
// checks the two against each other in a real browser.

const DSD_OPEN = '<template shadowroot="open" shadowrootmode="open">'

// Selectors such as `a[aria-current="page"]` and `[role="alert"]` appear in the
// inlined stylesheets; drop those before asserting on markup.
async function ssrMarkup(template: TemplateResult): Promise<string> {
  return (await ssr(template)).replace(/<style>[\s\S]*?<\/style>/g, '')
}

const CASES: Array<{ name: string; template: () => TemplateResult }> = [
  { name: 'caribou-app-shell with instance',
    template: () => html`<caribou-app-shell instance="example.social"></caribou-app-shell>` },
  { name: 'caribou-app-shell anonymous',
    template: () => html`<caribou-app-shell></caribou-app-shell>` },
  { name: 'caribou-nav-rail current=/local',
    template: () => html`<caribou-nav-rail current="/local"></caribou-nav-rail>` },
  { name: 'caribou-right-rail with instance',
    template: () => html`<caribou-right-rail instance="example.social"></caribou-right-rail>` },
  { name: 'caribou-auth-required with label',
    template: () => html`<caribou-auth-required label="/home shows your personal timeline."></caribou-auth-required>` },
  { name: 'caribou-landing',
    template: () => html`<caribou-landing></caribou-landing>` },
]

describe('hydration parity — the server render is stable and self-styled', () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const first = await ssr(c.template())
      const second = await ssr(c.template())
      expect(second).toBe(first)
      expect(first).toContain(DSD_OPEN)
      // Styles ship inside the declarative shadow root, so the first paint is
      // styled before any script runs.
      expect(first).toMatch(/<template shadowroot="open" shadowrootmode="open"><style>/)
    })
  }
})

describe('hydration parity — the server renders no client-only state', () => {
  it('nav rail marks no item when `current` is not set', async () => {
    const out = await ssrMarkup(html`<caribou-nav-rail></caribou-nav-rail>`)
    expect(out).not.toContain('aria-current')
  })

  it('nav rail marks the item named by `current`', async () => {
    const out = await ssrMarkup(html`<caribou-nav-rail current="/local"></caribou-nav-rail>`)
    expect(out.match(/aria-current="page"/g)?.length).toBe(1)
    expect(out).toMatch(/<a href="\/local" aria-current="page"/)
  })

  it('rails render the signed-in chrome: no [signed-out] on the server', async () => {
    const out = await ssrMarkup(html`<caribou-app-shell instance="example.social"></caribou-app-shell>`)
    expect(out).not.toContain('signed-out=')
    expect(out).not.toMatch(/<caribou-(nav|right)-rail[^>]*\ssigned-out/)
  })

  it('error banner renders empty', async () => {
    const out = await ssrMarkup(html`<caribou-error-banner></caribou-error-banner>`)
    expect(out).toContain(DSD_OPEN)
    expect(out).not.toContain('role="alert"')
  })

  it('instance picker renders the idle form', async () => {
    const out = await ssrMarkup(html`<caribou-instance-picker></caribou-instance-picker>`)
    expect(out).toContain('<label for="server">Your Mastodon instance</label>')
    expect(out).toMatch(/<input id="server" name="server" type="text"/)
    expect(out).toContain('Sign in')
    expect(out).not.toContain('Connecting')
    expect(out).not.toMatch(/<button[^>]*\sdisabled/)
    expect(out).not.toContain('role="alert"')
  })
})
