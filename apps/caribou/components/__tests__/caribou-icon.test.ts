import { afterEach, describe, expect, it, vi } from 'vitest'
import '../caribou-icon.js'
import type { CaribouIcon } from '../caribou-icon.js'

async function mount(name: string): Promise<CaribouIcon> {
  const el = document.createElement('caribou-icon')
  el.name = name
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('caribou-icon', () => {
  it('renders the named icon, hidden from assistive tech, sized by font-size', async () => {
    const el = await mount('star')
    const svg = el.shadowRoot!.querySelector('svg')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('width')).toBe('1em')
    expect(el.getAttribute('aria-hidden')).toBe('true')
  })

  it('renders nothing for an unknown name, and warns in dev', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const el = await mount('nope')
    expect(el.shadowRoot!.querySelector('svg')).toBeNull()
    expect(warn).toHaveBeenCalledWith('<caribou-icon>: no icon named "nope".')
  })

  it('does not treat an inherited Object key as an icon', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const el = await mount('toString')
    expect(el.shadowRoot!.childElementCount).toBe(0)
  })
})
