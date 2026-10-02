// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { html, type TemplateResult } from 'lit'
import { ssr } from './_ssr.js'
import '@beatzball/litro/runtime/LitroLink.js'
import '../../components/caribou-auth-required.js'
import '../../pages/about.js'
import '../../pages/privacy.js'

const DSD_OPENER = /<template shadowroot="open" shadowrootmode="open">/

/**
 * Strip every declarative-shadow-root `<template>…</template>` block, counting
 * nested `<template>` opens so the scan does not stop at the first inner
 * `</template>` and leave shadow content masquerading as light DOM. Returns
 * the input with all shadow subtrees removed, leaving only true light DOM.
 */
function stripDSDTemplates(input: string): string {
  let result = input
  while (true) {
    const m = DSD_OPENER.exec(result)
    if (!m) return result
    const start = m.index
    let depth = 1
    let scan = start + m[0].length
    while (depth > 0 && scan < result.length) {
      const nextOpen = result.indexOf('<template', scan)
      const nextClose = result.indexOf('</template>', scan)
      if (nextClose === -1) return result // Malformed input; bail.
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++
        scan = nextOpen + '<template'.length
      } else {
        depth--
        scan = nextClose + '</template>'.length
      }
    }
    result = result.slice(0, start) + result.slice(scan)
  }
}

/** The light-DOM children of the one `<caribou-app-shell>` in `out`. */
function shellLightChildren(out: string): string {
  const m = out.match(/<caribou-app-shell\b[^>]*>([\s\S]*)<\/caribou-app-shell>/)
  expect(m, 'output should contain <caribou-app-shell>').not.toBeNull()
  return stripDSDTemplates(m![1]!)
}

const data = { shell: { instance: 'example.social' } }

const PAGES: Array<{ route: string; heading: string; template: () => TemplateResult; bare: () => TemplateResult }> = [
  { route: '/about', heading: 'About',
    template: () => html`<page-about .serverData=${data}></page-about>`,
    bare: () => html`<page-about></page-about>` },
  { route: '/privacy', heading: 'Privacy',
    template: () => html`<page-privacy .serverData=${data}></page-privacy>`,
    bare: () => html`<page-privacy></page-privacy>` },
]

describe.each(PAGES)('SSR slot composition: $route', ({ heading, template, bare }) => {
  it('emits a declarative shadow root', async () => {
    expect(await ssr(template())).toMatch(DSD_OPENER)
  })

  it('places the page body inside <caribou-app-shell> as a light-DOM child', async () => {
    const light = shellLightChildren(await ssr(template()))
    expect(light).toContain('<article>')
    expect(light).toContain(`<h1>${heading}</h1>`)
  })

  it('has no <slot> outside a shadow root', async () => {
    const out = await ssr(template())
    expect(shellLightChildren(out)).not.toMatch(/<slot[\s>]/)
    expect(stripDSDTemplates(out)).not.toMatch(/<slot[\s>]/)
  })

  it('hands the instance from the page data to the right rail', async () => {
    const out = await ssr(template())
    expect(out).toMatch(/<caribou-app-shell\s+instance="example\.social"/)
    expect(out).toMatch(/Signed in to <strong><!--lit-part-->example\.social/)
  })

  it('renders the anonymous shell when there is no page data', async () => {
    const out = await ssr(bare())
    expect(shellLightChildren(out)).toContain(`<h1>${heading}</h1>`)
    expect(out).not.toContain('Signed in to')
  })

  it('server-renders a real <a href> for every internal link in the shell', async () => {
    const out = await ssr(template())
    for (const href of ['/home', '/local', '/public', '/@me']) {
      expect(out, `nav anchor ${href}`).toContain(`<a href="${href}"`)
    }
    // `<litro-link>` keeps its anchor in its own shadow root; without it the
    // link would be unclickable text when JavaScript is off.
    for (const href of ['/privacy', '/about']) {
      expect(out, `litro-link anchor ${href}`).toMatch(new RegExp(`<a\\s+href="${href}"`))
    }
  })
})

describe('SSR slot composition: <caribou-auth-required> in the shell', () => {
  const template = () => html`
    <caribou-app-shell>
      <caribou-auth-required label="/home shows your personal timeline."></caribou-auth-required>
    </caribou-app-shell>`

  it('places <caribou-auth-required> inside the shell as a light-DOM child', async () => {
    expect(shellLightChildren(await ssr(template()))).toContain('<caribou-auth-required')
  })

  it('server-renders the call to action and a real anchor to /', async () => {
    const out = await ssr(template())
    expect(out).toContain('Sign in to continue')
    expect(out).toContain('/home shows your personal timeline.')
    expect(out).toMatch(/<a\s+href="\/"/)
  })
})
