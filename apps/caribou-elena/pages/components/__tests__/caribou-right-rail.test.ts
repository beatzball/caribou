import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { activeUserKey, users } from '@beatzball/caribou-state'
import { toUserKey } from '@beatzball/caribou-auth'

beforeAll(async () => {
  await import('../caribou-right-rail.js')
})

beforeEach(() => {
  users.value = new Map()
  activeUserKey.value = null
  document.body.innerHTML = ''
})

describe('<caribou-right-rail>', () => {
  it('renders about card + privacy/about links wrapped in <litro-link>', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-right-rail')
    document.body.appendChild(el)
    await Promise.resolve()
    expect(el.shadowRoot!.textContent).toContain('Caribou')
    const privacy = el.shadowRoot!.querySelector('a[href="/privacy"]')
    const about = el.shadowRoot!.querySelector('a[href="/about"]')
    expect(privacy).toBeTruthy()
    expect(privacy?.closest('litro-link')).toBeTruthy()
    expect(about).toBeTruthy()
    expect(about?.closest('litro-link')).toBeTruthy()
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

  it('reflects [signed-out] attribute based on activeUserKey signal', async () => {
    const el = document.createElement('caribou-right-rail') as HTMLElement & { instance: string }
    document.body.appendChild(el)
    el.instance = 'mastodon.social'
    await Promise.resolve()
    // Default (no active session): signed-out attribute present.
    expect(el.hasAttribute('signed-out')).toBe(true)

    // Set an active session: signed-out attribute is removed.
    activeUserKey.value = toUserKey('alice', 'mastodon.social')
    await Promise.resolve()
    expect(el.hasAttribute('signed-out')).toBe(false)

    // Clear the session: signed-out attribute returns.
    activeUserKey.value = null
    await Promise.resolve()
    expect(el.hasAttribute('signed-out')).toBe(true)
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
