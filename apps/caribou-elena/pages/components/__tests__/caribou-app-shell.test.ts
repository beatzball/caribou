import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(async () => {
  await import('../caribou-app-shell.js')
})

describe('<caribou-app-shell> (full)', () => {
  it('renders <caribou-nav-rail>, <main><slot>, <caribou-right-rail> in shadow', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-app-shell')
    document.body.appendChild(el)
    await Promise.resolve()
    expect(el.shadowRoot!.querySelector('caribou-nav-rail')).toBeTruthy()
    expect(el.shadowRoot!.querySelector('main slot')).toBeTruthy()
    expect(el.shadowRoot!.querySelector('caribou-right-rail')).toBeTruthy()
  })

  it('forwards instance prop to <caribou-right-rail>', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-app-shell') as HTMLElement & { instance: string }
    document.body.appendChild(el)
    el.instance = 'mastodon.social'
    await Promise.resolve()
    const rail = el.shadowRoot!.querySelector('caribou-right-rail') as HTMLElement & { instance: string }
    expect(rail.getAttribute('instance') === 'mastodon.social' || rail.instance === 'mastodon.social').toBe(true)
  })
})
