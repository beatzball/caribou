import { afterEach, describe, expect, it } from 'vitest'
import '../caribou-auth-required.js'
import type { CaribouAuthRequired } from '../caribou-auth-required.js'

async function mount(label = ''): Promise<CaribouAuthRequired> {
  const el = document.createElement('caribou-auth-required') as CaribouAuthRequired
  el.label = label
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('caribou-auth-required', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('renders the sign-in call to action with the label', async () => {
    const el = await mount('/home shows your personal timeline.')
    const text = el.shadowRoot!.textContent ?? ''
    expect(text).toContain('Sign in to continue')
    expect(text).toContain('/home shows your personal timeline.')
    expect(text).toContain('to view it.')
  })

  it('links to / through <litro-link>', async () => {
    const el = await mount()
    const link = el.shadowRoot!.querySelector('litro-link[href="/"]')
    expect(link).not.toBeNull()
    expect(link!.textContent).toContain('Sign in')
  })

  it('reflects label to an attribute', async () => {
    const el = await mount('/home shows your personal timeline.')
    expect(el.getAttribute('label')).toBe('/home shows your personal timeline.')
  })
})
