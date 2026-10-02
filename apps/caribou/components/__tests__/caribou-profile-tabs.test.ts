import { afterEach, describe, expect, it } from 'vitest'
import '../caribou-profile-tabs.js'
import type { CaribouProfileTabs, ProfileTabName } from '../caribou-profile-tabs.js'

async function mount(handle: string, tab?: ProfileTabName): Promise<CaribouProfileTabs> {
  const el = document.createElement('caribou-profile-tabs') as CaribouProfileTabs
  el.handle = handle
  if (tab) el.tab = tab
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('<caribou-profile-tabs>', () => {
  afterEach(() => { document.body.replaceChildren() })

  it('renders three anchors with proper href + aria-current on active tab', async () => {
    const el = await mount('@alice@example.social', 'replies')
    const anchors = [...el.shadowRoot!.querySelectorAll('a')]
    expect(anchors.map((a) => a.textContent)).toEqual(['posts', 'replies', 'media'])
    const active = el.shadowRoot!.querySelectorAll('a[aria-current="page"]')
    expect(active.length).toBe(1)
    expect(active[0]!.getAttribute('href')).toContain('tab=replies')
  })

  it('defaults to the posts tab', async () => {
    const el = await mount('alice@example.social')
    expect(el.shadowRoot!.querySelector('a[aria-current="page"]')?.textContent).toBe('posts')
  })

  // The route is `/@:handle`, so the page hands over the handle without its
  // `@`. A link without the `@` matches no route.
  it('links to the profile route whether or not the handle carries its @', async () => {
    const want = ['posts', 'replies', 'media'].map((t) => `/@alice@example.social?tab=${t}`)
    for (const handle of ['alice@example.social', '@alice@example.social']) {
      const el = await mount(handle)
      const hrefs = [...el.shadowRoot!.querySelectorAll('a')].map((a) => a.getAttribute('href'))
      expect(hrefs).toEqual(want)
    }
  })

  it('keeps the own-profile route for /@me', async () => {
    const el = await mount('me', 'media')
    expect(el.shadowRoot!.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe('/@me?tab=media')
  })
})
