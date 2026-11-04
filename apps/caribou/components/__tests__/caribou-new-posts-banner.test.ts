import { beforeEach, describe, expect, it } from 'vitest'
import '../caribou-new-posts-banner.js'
import type { CaribouNewPostsBanner } from '../caribou-new-posts-banner.js'

async function mount(count?: number): Promise<CaribouNewPostsBanner> {
  const el = document.createElement('caribou-new-posts-banner') as CaribouNewPostsBanner
  if (count !== undefined) el.count = count
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('<caribou-new-posts-banner>', () => {
  beforeEach(() => { document.body.replaceChildren() })

  it('renders nothing while the count is zero', async () => {
    const el = await mount()
    expect(el.shadowRoot!.querySelector('caribou-button')).toBeNull()
  })

  it('is a primary <caribou-button>, not a hand-styled native button', async () => {
    const el = await mount(2)
    const button = el.shadowRoot!.querySelector('caribou-button[data-action="apply-new-posts"]')
    expect(button).not.toBeNull()
    expect(button!.getAttribute('variant')).toBe('primary')
    expect(el.shadowRoot!.querySelector('button')).toBeNull()
  })

  it.each([[1, '1 new post'], [2, '2 new posts'], [40, '40 new posts']] as const)
    ('count=%i reads "%s"', async (count, label) => {
    const el = await mount(count)
    const button = el.shadowRoot!.querySelector('caribou-button')!
    expect(button.textContent!.trim().replace(/\s+/g, ' ')).toBe(label)
    expect(button.getAttribute('type')).toBeNull()
  })

  it('fires a bubbling, composed apply-new-posts event on click', async () => {
    const el = await mount(3)
    const seen: Event[] = []
    document.body.addEventListener('apply-new-posts', (e) => seen.push(e))
    el.shadowRoot!.querySelector<HTMLElement>('caribou-button')!.click()
    expect(seen).toHaveLength(1)
    expect(seen[0]!.composed).toBe(true)
  })

  it('does not mirror count to an attribute', async () => {
    const el = await mount(3)
    expect(el.hasAttribute('count')).toBe(false)
  })
})
