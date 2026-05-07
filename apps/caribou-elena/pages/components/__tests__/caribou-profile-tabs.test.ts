import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(async () => { await import('../caribou-profile-tabs.js') })

describe('<caribou-profile-tabs>', () => {
  it('renders three anchors with proper href + aria-current on active tab', async () => {
    const el = document.createElement('caribou-profile-tabs') as HTMLElement & { handle: string; tab: string }
    el.handle = '@alice@example.social'; el.tab = 'replies'
    document.body.appendChild(el)
    await Promise.resolve()
    const anchors = el.shadowRoot!.querySelectorAll('a')
    expect(anchors.length).toBe(3)
    const active = el.shadowRoot!.querySelector('a[aria-current="page"]')
    expect(active?.getAttribute('href')).toContain('tab=replies')
  })
})
