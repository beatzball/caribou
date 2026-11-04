import { afterEach, describe, expect, it, vi } from 'vitest'
import { html, render } from 'lit'
import '../caribou-tabs.js'
import type { CaribouTabs } from '../caribou-tabs.js'

async function mount(label: string, fill = false): Promise<CaribouTabs> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  render(html`<caribou-tabs label=${label} ?fill=${fill}>
    <a href="/x?tab=a" aria-current="page">A</a>
    <a href="/x?tab=b">B</a>
  </caribou-tabs>`, root)
  const el = root.querySelector('caribou-tabs') as CaribouTabs
  await el.updateComplete
  return el
}

describe('<caribou-tabs>', () => {
  afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

  it('is a navigation landmark named by `label`', async () => {
    const el = await mount('Result type')
    const nav = el.shadowRoot!.querySelector('nav')!
    expect(nav.getAttribute('aria-label')).toBe('Result type')
    expect(nav.getAttribute('part')).toBe('nav')
  })

  // The links stay the caller's: its click handlers, `aria-current` and
  // test selectors reach them in its own root.
  it('slots the caller\'s links rather than drawing its own', async () => {
    const el = await mount('Profile')
    const slot = el.shadowRoot!.querySelector('nav > slot') as HTMLSlotElement
    expect(slot).not.toBeNull()
    expect(el.shadowRoot!.querySelectorAll('a').length).toBe(0)
    const links = slot.assignedElements().filter((n) => n.localName === 'a')
    expect(links.map((a) => a.textContent)).toEqual(['A', 'B'])
  })

  it('reflects `fill`, which shares the width between the tabs', async () => {
    expect((await mount('Profile')).hasAttribute('fill')).toBe(false)
    const el = await mount('Result type', true)
    expect(el.fill).toBe(true)
    expect(el.hasAttribute('fill')).toBe(true)
  })

  it('warns in development when the label is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const el = document.createElement('caribou-tabs') as CaribouTabs
    document.body.appendChild(el)
    await el.updateComplete
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('label'))
    expect(el.shadowRoot!.querySelector('nav')!.hasAttribute('aria-label')).toBe(false)
  })
})
