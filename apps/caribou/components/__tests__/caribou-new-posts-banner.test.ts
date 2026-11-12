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

  it('has no apply action while the count is zero', async () => {
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

  // An unregistered <caribou-button> would still match the selectors above
  // and still pass a click on to the banner. The banner must register it.
  it('registers <caribou-button> itself', async () => {
    const el = await mount(1)
    expect(customElements.get('caribou-button')).toBeDefined()
    const button = el.shadowRoot!.querySelector('caribou-button')!
    expect(button.shadowRoot?.querySelector('button')).not.toBeNull()
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


describe('background availability announcements (README rule 1)', () => {
  it('keeps one initially empty polite region and changes only its message', async () => {
    const el = await mount()
    const region = el.shadowRoot!.querySelector('[role="status"]')!
    expect(region).not.toBeNull()
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.getAttribute('aria-atomic')).toBe('true')
    expect(region.textContent).toBe('')
    const reader = document.createElement('button')
    document.body.append(reader)
    reader.focus()
    const mutations: MutationRecord[] = []
    const observer = new MutationObserver((records) => mutations.push(...records))
    observer.observe(region, { childList: true, characterData: true, subtree: true })
    for (const [count, many, message] of [
      [1, false, '1 new post available.'],
      [3, false, '3 new posts available.'],
      [3, true, 'Many new posts available.'],
      [4, true, 'Many new posts available.'],
      [0, false, ''],
    ] as const) {
      el.count = count
      el.many = many
      await el.updateComplete
      expect(el.shadowRoot!.querySelector('[role="status"]')).toBe(region)
      expect(region.textContent).toBe(message)
      expect(document.activeElement).toBe(reader)
      await Promise.resolve()
      mutations.length = 0
      el.requestUpdate()
      await el.updateComplete
      await Promise.resolve()
      expect(mutations).toHaveLength(0)
    }
    observer.disconnect()
    expect(region.querySelector('caribou-button')).toBeNull()
  })
})
