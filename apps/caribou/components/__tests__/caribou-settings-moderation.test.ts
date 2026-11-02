import { afterEach, describe, expect, it } from 'vitest'
import '../caribou-settings-moderation.js'

afterEach(() => { document.body.replaceChildren() })

describe('<caribou-settings-moderation>', () => {
  it('links to /settings/moderation', async () => {
    const el = document.createElement('caribou-settings-moderation')
    document.body.appendChild(el)
    await el.updateComplete
    const a = el.shadowRoot!.querySelector('a')!
    expect(a.getAttribute('href')).toBe('/settings/moderation')
    expect(a.textContent).toBe('Filters, mutes and blocks')
  })
})
