import { afterEach, describe, expect, it } from 'vitest'
import { activeUserKey } from '@beatzball/caribou-state'
import '../caribou-right-rail.js'
import type { CaribouRightRail } from '../caribou-right-rail.js'

async function mount(instance = ''): Promise<CaribouRightRail> {
  const el = document.createElement('caribou-right-rail') as CaribouRightRail
  el.instance = instance
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('caribou-right-rail', () => {
  afterEach(() => {
    document.body.replaceChildren()
    activeUserKey.value = null
  })

  it('links to privacy and about', async () => {
    const el = await mount()
    const hrefs = [...el.shadowRoot!.querySelectorAll('litro-link')].map((l) => l.getAttribute('href'))
    expect(hrefs).toEqual(['/privacy', '/about'])
  })

  it('renders no session block without an instance', async () => {
    const el = await mount()
    expect(el.shadowRoot!.querySelector('.session')).toBeNull()
  })

  it('renders both session variants when an instance is set', async () => {
    const el = await mount('example.social')
    expect(el.shadowRoot!.querySelector('.signed-in')?.textContent).toContain('example.social')
    expect(el.shadowRoot!.querySelector('.browsing')?.textContent).toContain('example.social')
    expect(el.shadowRoot!.querySelector('form[action="/api/signout"]')).not.toBeNull()
  })

  it('marks the host signed-out while there is no active user', async () => {
    const el = await mount('example.social')
    expect(el.hasAttribute('signed-out')).toBe(true)
    activeUserKey.value = 'alice@example.social'
    expect(el.hasAttribute('signed-out')).toBe(false)
  })

  it('reflects instance to an attribute', async () => {
    const el = await mount('example.social')
    expect(el.getAttribute('instance')).toBe('example.social')
  })
})
