import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(async () => {
  await import('../caribou-nav-rail.js')
})

describe('<caribou-nav-rail>', () => {
  it('renders four nav <litro-link> wrappers each containing an <a>; active route has aria-current="page"', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-nav-rail')
    el.setAttribute('current', '/local')
    document.body.appendChild(el)
    await Promise.resolve()
    const wrappers = el.shadowRoot!.querySelectorAll('litro-link')
    expect(wrappers.length).toBe(4)
    for (const w of wrappers) {
      expect(w.querySelector('a'), '<litro-link> should wrap an <a>').toBeTruthy()
    }
    const activeAnchor = el.shadowRoot!.querySelector('a[aria-current="page"]')
    expect(activeAnchor?.getAttribute('href')).toBe('/local')
  })

  it('renders a /home <a> inside a <litro-link>', async () => {
    const el = document.createElement('caribou-nav-rail')
    document.body.appendChild(el)
    await Promise.resolve()
    const a = el.shadowRoot!.querySelector('a[href="/home"]')
    expect(a).toBeTruthy()
    expect(a?.closest('litro-link')).toBeTruthy()
  })

  it('treats /@me/* as active for the Profile anchor', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-nav-rail')
    el.setAttribute('current', '/@me/posts')
    document.body.appendChild(el)
    await Promise.resolve()
    const active = el.shadowRoot!.querySelector('a[aria-current="page"]')
    expect(active?.getAttribute('href')).toBe('/@me')
  })

  it('renders sign-out as a POST form to /api/signout (not a link)', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-nav-rail')
    document.body.appendChild(el)
    await Promise.resolve()
    expect(el.shadowRoot!.querySelector('a[href="/api/signout"]')).toBeFalsy()
    expect(el.shadowRoot!.querySelector('litro-link[href="/api/signout"]')).toBeFalsy()
    const form = el.shadowRoot!.querySelector('form[action="/api/signout"]')
    expect(form).toBeTruthy()
    expect(form?.getAttribute('method')?.toLowerCase()).toBe('post')
    expect(form?.querySelector('button[type="submit"]')).toBeTruthy()
  })
})
