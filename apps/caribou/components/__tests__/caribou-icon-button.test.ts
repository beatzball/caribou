import { afterEach, describe, expect, it, vi } from 'vitest'
import '../caribou-icon-button.js'
import type { CaribouIconButton } from '../caribou-icon-button.js'

async function mount(attrs: Record<string, string>): Promise<CaribouIconButton> {
  const el = document.createElement('caribou-icon-button')
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

function inner(el: CaribouIconButton): HTMLButtonElement {
  return el.shadowRoot!.querySelector('button')!
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('caribou-icon-button', () => {
  it('uses the label as the accessible name, with no tooltip that repeats it', async () => {
    const el = await mount({ icon: 'star', label: 'Favourite' })
    const b = inner(el)
    expect(b.type).toBe('button')
    expect(b.getAttribute('aria-label')).toBe('Favourite')
    expect(b.hasAttribute('title')).toBe(false)
    expect(b.getAttribute('part')).toBe('button')
    const icon = b.querySelector('caribou-icon')!
    expect(icon.getAttribute('part')).toBe('icon')
    expect(icon.getAttribute('aria-hidden')).toBe('true')
  })

  it('warns in dev when the label is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const el = await mount({ icon: 'star' })
    expect(inner(el).hasAttribute('aria-label')).toBe(false)
    expect(warn).toHaveBeenCalledWith('<caribou-icon-button icon="star">: a label is required.')
    el.count = '2'
    await el.updateComplete
    expect(warn).toHaveBeenCalledOnce()
  })

  it('has no aria-pressed unless it is a toggle', async () => {
    const el = await mount({ icon: 'star', label: 'Favourite' })
    expect(inner(el).hasAttribute('aria-pressed')).toBe(false)
  })

  it('maps pressed to aria-pressed, off as well as on', async () => {
    const el = await mount({ icon: 'star', label: 'Favourite', pressed: 'false' })
    expect(el.pressed).toBe(false)
    expect(inner(el).getAttribute('aria-pressed')).toBe('false')
    el.setAttribute('pressed', '')
    await el.updateComplete
    expect(inner(el).getAttribute('aria-pressed')).toBe('true')
    el.pressed = false
    await el.updateComplete
    expect(inner(el).getAttribute('aria-pressed')).toBe('false')
    el.removeAttribute('pressed')
    await el.updateComplete
    expect(inner(el).hasAttribute('aria-pressed')).toBe(false)
  })

  it('shows the count beside the icon', async () => {
    const el = await mount({ icon: 'star', label: 'Favourite', count: '12' })
    const count = el.shadowRoot!.querySelector('[part="count"]')!
    expect(count.textContent).toBe('12')
    expect(count.previousElementSibling!.localName).toBe('caribou-icon')
  })

  it('disabled: the inner button is disabled and the host reports no click', async () => {
    const el = await mount({ icon: 'star', label: 'Favourite', disabled: '' })
    expect(inner(el).disabled).toBe(true)
    const onClick = vi.fn()
    el.addEventListener('click', onClick)
    el.click()
    expect(onClick).not.toHaveBeenCalled()
    el.disabled = false
    await el.updateComplete
    inner(el).click()
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('soft-disabled: stays a focusable button with aria-disabled, and the host reports no click', async () => {
    const el = await mount({ icon: 'repeat2', label: 'Boost', 'soft-disabled': '' })
    const b = inner(el)
    expect(b.disabled).toBe(false)
    expect(b.getAttribute('aria-disabled')).toBe('true')
    const onClick = vi.fn()
    el.addEventListener('click', onClick)
    b.click()
    el.click()
    expect(onClick).not.toHaveBeenCalled()
    el.softDisabled = false
    await el.updateComplete
    expect(b.hasAttribute('aria-disabled')).toBe(false)
    b.click()
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('hint is the tooltip; the label stays the name', async () => {
    const el = await mount({ icon: 'repeat2', label: 'Boost', hint: 'Sign in to boost' })
    expect(inner(el).getAttribute('aria-label')).toBe('Boost')
    expect(inner(el).title).toBe('Sign in to boost')
    el.hint = ''
    await el.updateComplete
    expect(inner(el).hasAttribute('title')).toBe(false)
  })

  it('links the description from inside its own shadow root', async () => {
    const el = await mount({ icon: 'star', label: 'Favourite', description: '3 favourites' })
    const id = inner(el).getAttribute('aria-describedby')!
    expect(el.shadowRoot!.getElementById(id)!.textContent).toBe('3 favourites')
    el.description = ''
    await el.updateComplete
    expect(inner(el).hasAttribute('aria-describedby')).toBe(false)
  })

  it('ghost: marks the button, and fills the icon only while pressed', async () => {
    const el = await mount({ icon: 'star', label: 'Favourite', variant: 'ghost', pressed: 'false' })
    const icon = () => el.shadowRoot!.querySelector('caribou-icon')!
    expect(inner(el).dataset.variant).toBe('ghost')
    expect(icon().hasAttribute('filled')).toBe(false)
    el.pressed = true
    await el.updateComplete
    expect(icon().hasAttribute('filled')).toBe(true)
    // The bordered default shows "on" with its fill colour instead.
    el.variant = 'default'
    await el.updateComplete
    expect(inner(el).hasAttribute('data-variant')).toBe(false)
    expect(icon().hasAttribute('filled')).toBe(false)
  })

  it('delegates focus to the inner button', async () => {
    const el = await mount({ icon: 'star', label: 'Favourite' })
    // happy-dom ignores delegatesFocus; the e2e spec checks the real Tab order.
    expect((el.constructor as typeof CaribouIconButton).shadowRootOptions.delegatesFocus).toBe(true)
  })
})
