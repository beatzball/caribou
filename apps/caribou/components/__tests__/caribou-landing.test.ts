import { afterEach, describe, expect, it } from 'vitest'
import '../caribou-landing.js'
import type { CaribouLanding } from '../caribou-landing.js'

async function mount(): Promise<CaribouLanding> {
  const el = document.createElement('caribou-landing') as CaribouLanding
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('caribou-landing', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('renders the heading and the intro inside <main>', async () => {
    const el = await mount()
    const main = el.shadowRoot!.querySelector('main')!
    expect(main.querySelector('h1')?.textContent).toBe('Caribou')
    expect(main.querySelector('p')?.textContent?.trim()).toBe('A Mastodon client. Enter your instance to sign in.')
  })

  it('renders the error banner above the instance picker', async () => {
    const el = await mount()
    const tags = [...el.shadowRoot!.querySelectorAll('main > *')].map((c) => c.localName)
    expect(tags).toEqual(['h1', 'p', 'caribou-error-banner', 'caribou-instance-picker'])
  })
})
