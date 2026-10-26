import { afterEach, describe, expect, it } from 'vitest'
import '../caribou-menu.js'
import { CaribouMenu } from '../caribou-menu.js'

// happy-dom cannot show a popover, so these cover the script fallback and
// the markup the browser's own popover reads. The native path runs in
// tests/e2e/more-menu*.spec.ts.

async function mount(): Promise<CaribouMenu> {
  const el = document.createElement('caribou-menu')
  el.setAttribute('icon', 'ellipsis')
  el.setAttribute('label', 'More')
  el.innerHTML = `<a href="/public">Public</a>
    <form action="/api/signout" method="post"><button type="submit">Sign out</button></form>`
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const trigger = (el: CaribouMenu) => el.shadowRoot!.querySelector<HTMLButtonElement>('.trigger')!
const panel = (el: CaribouMenu) => el.shadowRoot!.querySelector<HTMLElement>('.panel')!

afterEach(() => {
  document.body.replaceChildren()
})

describe('caribou-menu', () => {
  it('ties a native trigger to a native popover panel', async () => {
    const el = await mount()
    const b = trigger(el)
    expect(b.type).toBe('button')
    expect(b.getAttribute('popovertarget')).toBe('panel')
    expect(b.getAttribute('aria-controls')).toBe('panel')
    expect(b.textContent).toBe('More')
    expect(b.querySelector('caribou-icon')!.getAttribute('name')).toBe('ellipsis')
    expect(panel(el).id).toBe('panel')
    expect(panel(el).hasAttribute('popover')).toBe(true)
    expect(panel(el).querySelector('slot')).not.toBeNull()
  })

  // That the server renders none is in tests/integration/ssr-more-menu.test.ts.
  it('sets aria-expanded to false after the first update', async () => {
    const el = await mount()
    expect(trigger(el).getAttribute('aria-expanded')).toBe('false')
  })

  it('without the Popover API, the trigger opens and closes the panel', async () => {
    expect(CaribouMenu.popoverSupported).toBe(false)
    const el = await mount()
    trigger(el).click()
    expect(el.open).toBe(true)
    expect(panel(el).hasAttribute('data-open')).toBe(true)
    expect(trigger(el).getAttribute('aria-expanded')).toBe('true')
    trigger(el).click()
    expect(el.open).toBe(false)
    expect(panel(el).hasAttribute('data-open')).toBe(false)
    expect(trigger(el).getAttribute('aria-expanded')).toBe('false')
  })

  it('focuses the first item on open', async () => {
    const el = await mount()
    el.show()
    expect(document.activeElement).toBe(el.querySelector('a'))
  })

  it('Escape closes it', async () => {
    const el = await mount()
    el.show()
    el.querySelector('a')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(el.open).toBe(false)
  })

  it('a press outside closes it; a press inside does not', async () => {
    const el = await mount()
    el.show()
    el.querySelector('a')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }))
    expect(el.open).toBe(true)
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }))
    expect(el.open).toBe(false)
  })

  it('choosing an item closes it and leaves the click to the item', async () => {
    const el = await mount()
    el.show()
    let seen: MouseEvent | undefined
    // Stop the test document from following the link, after the menu ran.
    document.addEventListener('click', (e) => { seen = e; e.preventDefault() }, { once: true })
    el.querySelector('a')!.click()
    expect(el.open).toBe(false)
    expect(seen).toBeDefined()
  })

  it('closes when focus leaves it, not when focus moves inside it', async () => {
    const el = await mount()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    el.show()
    const [link, submit] = el.querySelectorAll<HTMLElement>('a, button')
    link!.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true, relatedTarget: submit! }))
    expect(el.open).toBe(true)
    link!.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true, relatedTarget: el }))
    expect(el.open).toBe(true)
    link!.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true, relatedTarget: null }))
    expect(el.open).toBe(true)
    submit!.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true, relatedTarget: outside }))
    expect(el.open).toBe(false)
  })

  it('stops listening outside once removed', async () => {
    const el = await mount()
    el.show()
    el.remove()
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }))
    expect(el.open).toBe(true)
  })
})
