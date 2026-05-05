import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(async () => {
  await import('../caribou-nav-rail.js')
})

describe('<caribou-nav-rail>', () => {
  it('renders five nav anchors with aria-current on the active route', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-nav-rail')
    el.setAttribute('current', '/local')
    document.body.appendChild(el)
    await Promise.resolve()
    const anchors = el.shadowRoot!.querySelectorAll('a')
    expect(anchors.length).toBe(5)
    const active = el.shadowRoot!.querySelector('a[aria-current="page"]')
    expect(active?.getAttribute('href')).toBe('/local')
  })

  it('renders a /home anchor', async () => {
    const el = document.createElement('caribou-nav-rail')
    document.body.appendChild(el)
    await Promise.resolve()
    expect(el.shadowRoot!.querySelector('a[href="/home"]')).toBeTruthy()
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
})
