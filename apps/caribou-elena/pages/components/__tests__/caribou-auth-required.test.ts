import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(async () => { await import('../caribou-auth-required.js') })

describe('caribou-auth-required', () => {
  it('renders sign-in CTA copy and link to /', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-auth-required') as HTMLElement & { label: string }
    el.label = '/home shows your personal timeline.'
    document.body.appendChild(el)
    await Promise.resolve()
    expect(el.textContent).toContain('Sign in to continue')
    expect(el.textContent).toContain('/home shows your personal timeline.')
    const link = el.querySelector<HTMLAnchorElement>('a[href="/"]')
    expect(link).not.toBeNull()
    expect(link!.textContent).toContain('Sign in')
  })

  it('uses light DOM (no shadowRoot)', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-auth-required')
    document.body.appendChild(el)
    await Promise.resolve()
    expect(el.shadowRoot).toBeNull()
  })
})
