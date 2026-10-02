import { afterEach, describe, expect, it } from 'vitest'
import '../caribou-app-shell.js'
import type { CaribouAppShell } from '../caribou-app-shell.js'
import type { CaribouRightRail } from '../caribou-right-rail.js'

async function mount(instance = ''): Promise<CaribouAppShell> {
  const el = document.createElement('caribou-app-shell') as CaribouAppShell
  if (instance) el.instance = instance
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('caribou-app-shell', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('renders the nav rail, a main with the page slot, and the right rail', async () => {
    const el = await mount()
    expect(el.shadowRoot!.querySelector('caribou-nav-rail')).toBeTruthy()
    expect(el.shadowRoot!.querySelector('main slot')).toBeTruthy()
    expect(el.shadowRoot!.querySelector('caribou-right-rail')).toBeTruthy()
  })

  it('forwards instance to the right rail', async () => {
    const el = await mount('example.social')
    const rail = el.shadowRoot!.querySelector('caribou-right-rail') as CaribouRightRail
    expect(rail.instance).toBe('example.social')
  })

  it('forwards a later instance change to the right rail', async () => {
    const el = await mount()
    el.instance = 'example.social'
    await el.updateComplete
    const rail = el.shadowRoot!.querySelector('caribou-right-rail') as CaribouRightRail
    expect(rail.instance).toBe('example.social')
  })

  it('reflects instance to an attribute', async () => {
    const el = await mount('example.social')
    expect(el.getAttribute('instance')).toBe('example.social')
  })

  it('keeps page content in light DOM and projects it into <main>', async () => {
    const el = await mount()
    const page = document.createElement('article')
    el.appendChild(page)
    expect(el.querySelector('article')).toBe(page)
    expect(el.shadowRoot!.querySelector('article')).toBeNull()
    // One unnamed slot, so every light-DOM child lands in <main>.
    expect(el.shadowRoot!.querySelectorAll('slot').length).toBe(1)
    expect(el.shadowRoot!.querySelector('slot')!.hasAttribute('name')).toBe(false)
  })
})
