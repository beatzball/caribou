import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(async () => {
  await import('../caribou-right-rail.js')
})

describe('<caribou-right-rail>', () => {
  it('renders about card + privacy/about links', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-right-rail')
    document.body.appendChild(el)
    await Promise.resolve()
    expect(el.shadowRoot!.textContent).toContain('Caribou')
    expect(el.shadowRoot!.querySelector('a[href="/privacy"]')).toBeTruthy()
    expect(el.shadowRoot!.querySelector('a[href="/about"]')).toBeTruthy()
  })

  it('renders signed-in indicator when instance prop is set', async () => {
    const el = document.createElement('caribou-right-rail') as HTMLElement & { instance: string }
    document.body.appendChild(el)
    el.instance = 'mastodon.social'
    await Promise.resolve()
    expect(el.shadowRoot!.textContent).toContain('Signed in to')
    expect(el.shadowRoot!.textContent).toContain('mastodon.social')
    const signOut = el.shadowRoot!.querySelector('form[action="/api/signout"]')
    expect(signOut).toBeTruthy()
    expect(signOut?.getAttribute('method')).toBe('post')
  })

  it('omits signed-in indicator when instance is unset', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-right-rail')
    document.body.appendChild(el)
    await Promise.resolve()
    expect(el.shadowRoot!.textContent).not.toContain('Signed in to')
  })

  it('renders three disabled slots with aria-disabled and Coming soon tooltip', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-right-rail')
    document.body.appendChild(el)
    await Promise.resolve()
    const disabled = el.shadowRoot!.querySelectorAll('[aria-disabled="true"]')
    expect(disabled.length).toBeGreaterThanOrEqual(3)
    for (const d of disabled) expect(d.getAttribute('title')).toBe('Coming soon')
  })
})
