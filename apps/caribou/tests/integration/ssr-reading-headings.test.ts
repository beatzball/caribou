// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { html } from 'lit'
import { ssr } from './_ssr.js'
import '../../pages/home.js'
import '../../pages/bookmarks.js'
import '../../pages/local.js'
import '../../pages/public.js'

const shell = { instance: null }

describe('rule 3: auth-required reading routes have one h1 before hydration', () => {
  it.each(['home', 'bookmarks', 'local', 'public'])('%s keeps the placeholder as its only page heading', async (route) => {
    const data = { kind: 'auth-required', shell }
    const template = route === 'home' ? html`<page-home .serverData=${data}></page-home>`
      : route === 'bookmarks' ? html`<page-bookmarks .serverData=${data}></page-bookmarks>`
      : route === 'local' ? html`<page-local .serverData=${data}></page-local>`
      : html`<page-public .serverData=${data}></page-public>`
    const rendered = await ssr(template)
    expect(rendered.match(/<h1(?:\s|>)/g)).toHaveLength(1)
    expect(rendered).toContain('<h1>Sign in to continue</h1>')
    expect(rendered).not.toContain('<h1 class="reading-heading">')
  })
})
